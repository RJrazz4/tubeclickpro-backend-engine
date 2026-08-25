import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Redis } from 'ioredis';
import type { AuthenticatedUser } from '../domain/tier.js';
import { AppError } from '../domain/errors.js';
import { getConfig } from '../config/env.js';
import { voiceGenerationRequestSchema } from '../voice/contracts.js';
import type { VoiceGenerationService } from '../voice/voice-generation-service.js';
import { YouTubeAnalyticsClient } from '../youtube/analytics-client.js';
import { TokenProvider } from '../youtube/token-provider.js';
import { rowsToObjects } from '../youtube/analytics-client.js';
import { logger } from '../observability/logger.js';

/**
 * Module P — publish tracker (manual paste v1) + Voice Studio handoff.
 *
 * The closed learning loop: script -> published -> measured -> the hunger
 * model gets smarter. Measurement happens in the nightly maintenance job;
 * this service owns record/lookup + the voiceover handoff.
 */

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/** Validate a YouTube watch/shorts/share URL and extract the 11-char video id. */
export function parseVideoId(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  const host = url.hostname.replace(/^www\.|^m\./, '');
  let id: string | null = null;
  if (host === 'youtu.be') {
    id = url.pathname.split('/').filter(Boolean)[0] ?? null;
  } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const v = url.searchParams.get('v');
    if (v) id = v;
    else {
      const parts = url.pathname.split('/').filter(Boolean);
      if (['shorts', 'embed', 'live', 'v'].includes(parts[0] ?? '')) id = parts[1] ?? null;
    }
  }
  return id && VIDEO_ID_RE.test(id) ? id : null;
}

export interface PublishInput {
  scriptId: string;
  videoUrl: string;
}

export class PublishService {
  constructor(
    private readonly sb: SupabaseClient,
    private readonly redis: Redis,
    private readonly voice: VoiceGenerationService,
    private readonly tokens: TokenProvider,
    private readonly analytics: YouTubeAnalyticsClient,
  ) {}

  /** Manual paste: link a published video to its script. */
  async recordPublish(user: AuthenticatedUser, input: PublishInput): Promise<Record<string, unknown>> {
    const videoId = parseVideoId(input.videoUrl);
    if (!videoId) {
      throw new AppError('Provide a valid HTTPS YouTube video URL', 400, 'INVALID_VIDEO_URL');
    }
    const { data: pkg } = await this.sb
      .from('script_packages')
      .select('id, user_id, status')
      .eq('id', input.scriptId)
      .maybeSingle();
    const row = pkg as { id: string; user_id: string; status: string } | null;
    if (!row) throw new AppError('Script not found', 404, 'NOT_FOUND');
    if (row.user_id !== user.id) throw new AppError('Not your script', 403, 'FORBIDDEN');
    if (!['draft', 'approved', 'in_production'].includes(row.status)) {
      throw new AppError(`Script already ${row.status}`, 409, 'INVALID_STATE');
    }

    const { data: outcome, error } = await this.sb
      .from('script_outcomes')
      .insert({
        script_package_id: input.scriptId,
        user_id: user.id,
        video_id: videoId,
        video_url: input.videoUrl.trim(),
        published_at: new Date().toISOString(),
      })
      .select('*')
      .single();
    if (error || !outcome) {
      if ((error as { code?: string } | null)?.code === '23505') {
        throw new AppError('This script already has a tracked video', 409, 'OUTCOME_EXISTS');
      }
      throw new AppError('Failed to record publish', 500, 'OUTCOME_FAILED');
    }
    logger.info({ userId: user.id, scriptId: input.scriptId, videoId }, 'publish tracked');

    await this.sb
      .from('script_packages')
      .update({ status: 'published', updated_at: new Date().toISOString() })
      .eq('id', input.scriptId);

    return outcome as Record<string, unknown>;
  }

  async getOutcome(user: AuthenticatedUser, scriptId: string): Promise<Record<string, unknown>> {
    const { data } = await this.sb
      .from('script_outcomes')
      .select('*')
      .eq('script_package_id', scriptId)
      .maybeSingle();
    const row = data as (Record<string, unknown> & { user_id: string }) | null;
    if (!row) throw new AppError('No tracked video for this script', 404, 'NO_OUTCOME');
    if (row.user_id !== user.id) throw new AppError('Not your outcome', 403, 'FORBIDDEN');
    return row;
  }

  /**
   * One-click Voice Studio handoff: compose the voiceover text from the
   * package's sections (voice_map lines first as a performance table), then
   * generate via the existing Neural VoiceRouter (premium-gated inside).
   */
  async generateVoiceover(
    user: AuthenticatedUser,
    scriptId: string,
    voiceAlias?: string,
  ): Promise<{ audio: Buffer; contentType: string; provider: string; characters: number }> {
    const { data: pkg } = await this.sb
      .from('script_packages')
      .select('id, user_id, kind, status, package')
      .eq('id', scriptId)
      .maybeSingle();
    const row = pkg as
      | { id: string; user_id: string; kind: string; status: string; package: Record<string, unknown> | null }
      | null;
    if (!row) throw new AppError('Script not found', 404, 'NOT_FOUND');
    if (row.user_id !== user.id) throw new AppError('Not your script', 403, 'FORBIDDEN');
    if (row.kind !== 'package' || !row.package) {
      throw new AppError('Voiceover requires a full ScriptPackage (premium generation)', 409, 'NOT_A_PACKAGE');
    }

    const sections = (row.package.sections ?? []) as Array<{ heading?: string; voiceover?: string }>;
    const text = sections
      .map((s) => `${s.heading ?? ''}. ${s.voiceover ?? ''}`.trim())
      .join('\n\n')
      .trim();
    if (!text) throw new AppError('Package has no voiceover sections', 409, 'EMPTY_SCRIPT');

    const config = getConfig();
    const clipped = text.length > config.VOICE_MAX_CHARACTERS
      ? clipAtSentence(text, config.VOICE_MAX_CHARACTERS)
      : text;

    const request = voiceGenerationRequestSchema.parse({
      text: clipped,
      voiceAlias: voiceAlias ?? 'george',
      stability: 0.5,
      speed: 1,
      outputFormat: 'mp3',
    });
    const result = await this.voice.generate(user, request, randomUUID());

    if (row.status === 'draft') {
      await this.sb
        .from('script_packages')
        .update({ status: 'in_production', updated_at: new Date().toISOString() })
        .eq('id', scriptId);
    }
    return { audio: result.audio, contentType: result.contentType, provider: result.provider, characters: clipped.length };
  }

  /** Maintenance sweep: measure outcomes published >= 7 days ago. */
  async measurePending(limit = 20): Promise<number> {
    const cutoff = new Date(Date.now() - 7 * 86400 * 1000).toISOString();
    const { data: pending } = await this.sb
      .from('script_outcomes')
      .select('id, user_id, video_id, published_at, script_package_id')
      .is('measured_at', null)
      .lte('published_at', cutoff)
      .limit(limit);
    const rows = (pending ?? []) as Array<{
      id: string; user_id: string; video_id: string; published_at: string; script_package_id: string;
    }>;

    let measured = 0;
    for (const row of rows) {
      try {
        const accessToken = await this.tokens.getAccessToken(row.user_id);
        const since = row.published_at.slice(0, 10);
        const to = new Date(Date.now() - 86400 * 1000).toISOString().slice(0, 10);
        const report = rowsToObjects(
          await this.analytics.fetchReport(accessToken, {
            ids: `video==${row.video_id}`,
            startDate: since,
            endDate: to,
            metrics: ['views', 'estimatedMinutesWatched', 'averageViewPercentage', 'engagedViews'],
          }, { userId: row.user_id }),
        );
        const totals = report.reduce(
          (acc: { views: number; minutes: number; engaged: number }, r) => ({
            views: acc.views + Number(r.views ?? 0),
            minutes: acc.minutes + Number(r.estimatedMinutesWatched ?? 0),
            engaged: acc.engaged + Number(r.engagedViews ?? 0),
          }),
          { views: 0, minutes: 0, engaged: 0 } as { views: number; minutes: number; engaged: number },
        );
        const avp = report.length
          ? report.reduce((s, r) => s + Number(r.averageViewPercentage ?? 0), 0) / report.length
          : 0;
        await this.sb
          .from('script_outcomes')
          .update({
            measured_at: new Date().toISOString(),
            metrics: {
              views: totals.views,
              minutes_watched: totals.minutes,
              average_view_percentage: Math.round(avp * 100) / 100,
              engaged_ratio: totals.views > 0 ? Math.round((totals.engaged / totals.views) * 10000) / 10000 : 0,
              since,
              to,
            },
          })
          .eq('id', row.id);
        await this.sb
          .from('script_packages')
          .update({ status: 'measured', updated_at: new Date().toISOString() })
          .eq('id', row.script_package_id)
          .eq('status', 'published');
        measured += 1;
      } catch {
        // revoked connections / quota shed — retried next sweep
      }
    }
    return measured;
  }
}

/** Clip text at the last sentence end inside the limit. */
export function clipAtSentence(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const slice = text.slice(0, maxChars);
  const dot = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('। '), slice.lastIndexOf('!'), slice.lastIndexOf('?'));
  return dot > maxChars * 0.5 ? slice.slice(0, dot + 1) : slice;
}
