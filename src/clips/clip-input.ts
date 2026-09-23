import { createHash } from 'node:crypto';
import { z } from 'zod';
import { extractVideoId } from '../trends/sources.js';

/**
 * Pure, dependency-free input layer for the Viral Shorts Clipper.
 * Everything here is deterministic and unit-testable — no I/O, no shell.
 *
 * Security contract: we NEVER trust the user's URL as a command argument.
 * We regex out the 11-char video id and rebuild a canonical watch URL ourselves,
 * so yt-dlp/ffmpeg only ever receive a host we constructed.
 */

export const CAPTION_STYLES = ['karaoke', 'bold', 'minimal'] as const;
export type CaptionStyle = (typeof CAPTION_STYLES)[number];

export const clipRequestSchema = z.object({
  url: z.string().min(1).max(2048),
  startSeconds: z.number().int().min(0).max(86_400).default(0),
  durationSeconds: z.number().int().min(5).max(60).default(30),
  captionStyle: z.enum(CAPTION_STYLES).default('karaoke'),
});

export type ClipRequest = z.infer<typeof clipRequestSchema>;

/** Resolve a YouTube URL/short/id to a bare 11-char video id, or null. */
export function resolveVideoId(url: string): string | null {
  return extractVideoId(url);
}

/** Canonical watch URL — the ONLY url form we hand to yt-dlp. */
export function canonicalWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/** Clamp the requested window to the platform-configured maximums. */
export function clampWindow(
  startSeconds: number,
  durationSeconds: number,
  maxDurationSeconds: number,
): { startSeconds: number; durationSeconds: number } {
  return {
    startSeconds: Math.max(0, Math.floor(startSeconds)),
    durationSeconds: Math.max(5, Math.min(Math.floor(durationSeconds), maxDurationSeconds)),
  };
}

/**
 * Deterministic idempotency key. Identical (user, video, window, style) map to
 * the same BullMQ job id, so repeat clicks reuse in-flight/completed work
 * instead of re-rendering — a core abuse + cost defence.
 */
export function clipIdempotencyKey(
  userId: string,
  videoId: string,
  startSeconds: number,
  durationSeconds: number,
  captionStyle: CaptionStyle,
): string {
  const raw = `${userId}|${videoId}|${startSeconds}|${durationSeconds}|${captionStyle}`;
  return `clip:${createHash('sha256').update(raw).digest('hex').slice(0, 40)}`;
}
