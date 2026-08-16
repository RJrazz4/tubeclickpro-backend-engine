// BullMQ queue names cannot contain ':'. QUEUE_BASE remains the documented
// Redis namespace; concrete queue names use hyphens and dedicated tier queues.
export const QUEUE_BASE = 'viral-dna:extract';
export const FREE_QUEUE_NAME = 'viral-dna-extract-free';
export const PREMIUM_QUEUE_NAME = 'viral-dna-extract-premium';

export const JOB_NAMES = {
  free: 'conveyor-extract',
  premium: 'vip-extract',
} as const;
