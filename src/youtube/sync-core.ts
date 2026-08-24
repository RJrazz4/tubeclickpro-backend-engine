/**
 * Pure backfill math — unit-tested, no I/O.
 *
 * Windows are INCLUSIVE [start, end] date ranges, oldest first, sized
 * YOUTUBE_SYNC_CHUNK_DAYS, ending at YESTERDAY (Analytics API data is
 * finalized with a 24–72h lag; today is never requested).
 */

export interface DateWindow {
  start: string; // YYYY-MM-DD inclusive
  end: string;   // YYYY-MM-DD inclusive
}

function toUtcDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return toUtcDate(d);
}

export function utcToday(now = new Date()): string {
  return toUtcDate(now);
}

/** The last date with (potentially) finalized analytics data. */
export function lastFinalDate(now = new Date()): string {
  return addDays(toUtcDate(now), -1);
}

/**
 * Build the backfill window list covering [today - backfillDays, yesterday].
 * Example (chunk 28, backfill 90): 4 windows — 28+28+28+6 days.
 */
export function backfillWindows(
  now: Date,
  backfillDays = 90,
  chunkDays = 28,
): DateWindow[] {
  const end = lastFinalDate(now); // yesterday
  const start = addDays(end, -(backfillDays - 1));
  const windows: DateWindow[] = [];
  let cursor = start;
  while (cursor <= end) {
    let windowEnd = addDays(cursor, chunkDays - 1);
    if (windowEnd > end) windowEnd = end;
    windows.push({ start: cursor, end: windowEnd });
    cursor = addDays(windowEnd, 1);
  }
  return windows;
}

/**
 * Resume logic: skip windows fully covered by completedThrough (the last
 * fully-synced stat_date). A window is done iff window.end <= completedThrough.
 */
export function remainingWindows(
  windows: DateWindow[],
  completedThrough: string | null,
): DateWindow[] {
  if (!completedThrough) return windows;
  return windows.filter((w) => w.end > completedThrough);
}

/** One window for the nightly refresh: just yesterday. */
export function dailyRefreshWindow(now = new Date()): DateWindow {
  const d = lastFinalDate(now);
  return { start: d, end: d };
}

/** Chunk an array into batches (supabase upserts cap at ~500 rows). */
export function chunk<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/**
 * Parse ISO-8601 durations (PT1M2S, PT1H3M4S, PT45S) to seconds.
 * Data API contentDetails.duration format; Shorts <= 60s.
 */
export function parseIso8601Duration(iso: string): number {
  const m = /^P(?:([0-9]+)D)?T?(?:([0-9]+)H)?(?:([0-9]+)M)?(?:([0-9]+)S)?$/.exec(iso ?? '');
  if (!m) return 0;
  const [, d, h, min, s] = m;
  return (
    (d ? Number(d) * 86400 : 0) + (h ? Number(h) * 3600 : 0) +
    (min ? Number(min) * 60 : 0) + (s ? Number(s) : 0)
  );
}
