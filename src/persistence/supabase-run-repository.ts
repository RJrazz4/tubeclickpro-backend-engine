import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getConfig } from '../config/env.js';
import type { JobState } from '../domain/job.js';

export interface RunRepository {
  upsert(state: JobState): Promise<void>;
}

export class NoopRunRepository implements RunRepository {
  async upsert(_state: JobState): Promise<void> {}
}

export class SupabaseRunRepository implements RunRepository {
  private readonly client: SupabaseClient;

  constructor() {
    const config = getConfig();
    this.client = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async upsert(state: JobState): Promise<void> {
    const { error } = await this.client.from('viral_dna_runs').upsert(
      {
        id: state.jobId,
        user_id: state.userId,
        tier: state.tier,
        queue_class: state.queueClass,
        delivery: state.delivery,
        status: state.status,
        progress_percent: state.progressPercent,
        stage: state.stage,
        result: state.result ?? null,
        error: state.error ?? null,
        created_at: state.createdAt,
        updated_at: state.updatedAt,
      },
      { onConflict: 'id' },
    );
    if (error) throw new Error(`Supabase run persistence failed: ${error.message}`);
  }
}

export function createRunRepository(): RunRepository {
  return getConfig().AUTH_MODE === 'supabase'
    ? new SupabaseRunRepository()
    : new NoopRunRepository();
}
