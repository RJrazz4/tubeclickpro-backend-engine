import { readFile } from 'node:fs/promises';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Output sink for rendered clips. Phase 1 defaults to Supabase Storage
 * (already in the stack, free tier, no new dependency). The interface lets us
 * swap in Cloudflare R2 (zero-egress) later without touching the pipeline.
 */

export interface ClipStore {
  put(key: string, filePath: string, contentType: string): Promise<{ url: string }>;
}

export class SupabaseClipStore implements ClipStore {
  constructor(
    private readonly sb: SupabaseClient,
    private readonly bucket: string,
  ) {}

  async put(key: string, filePath: string, contentType: string): Promise<{ url: string }> {
    const body = await readFile(filePath);
    const { error } = await this.sb.storage.from(this.bucket).upload(key, body, { contentType, upsert: true });
    if (error) throw new Error(`clip_upload_failed: ${error.message}`);
    const { data } = this.sb.storage.from(this.bucket).getPublicUrl(key);
    return { url: data.publicUrl };
  }
}

/** Test/local sink — keeps bytes in memory, returns a deterministic fake URL. */
export class InMemoryClipStore implements ClipStore {
  readonly objects = new Map<string, { bytes: Buffer; contentType: string }>();

  async put(key: string, filePath: string, contentType: string): Promise<{ url: string }> {
    const bytes = await readFile(filePath);
    this.objects.set(key, { bytes, contentType });
    return { url: `https://clip.local/${key}` };
  }
}
