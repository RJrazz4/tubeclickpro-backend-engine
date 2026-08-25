/**
 * Challenge core — PURE functions (unit-tested). The service layer composes
 * these with Supabase; the RPC owns streak truth in Postgres.
 */

export const CHALLENGE_LENGTH_DAYS = 30;
export const DAILY_DROP_LOCAL_HOUR = 5; // the "appointment" — drops at 05:00 user-local

export interface CalendarEntry {
  date: string; // YYYY-MM-DD (user-local)
  action: 'script' | 'publish' | 'freeze';
  script_package_id: string | null;
}

export interface ChallengeRpcState {
  status: 'active' | 'completed' | 'abandoned' | 'not_enrolled';
  timezone: string;
  start_date: string;
  today_local: string;
  elapsed_days: number;
  streak: number;
  best_streak: number;
  freezes_used: number;
  freezes_earned: number;
  total_script_days: number;
  total_publish_days: number;
  calendar: CalendarEntry[];
}

export interface Milestone {
  day: 7 | 14 | 21 | 30;
  id: 'rising' | 'momentum' | 'algorithm' | 'champion';
  label: string;
  achieved: boolean;
}

export const MILESTONE_DEFS: ReadonlyArray<Omit<Milestone, 'achieved'>> = [
  { day: 7, id: 'rising', label: 'Rising Creator' },
  { day: 14, id: 'momentum', label: 'Momentum' },
  { day: 21, id: 'algorithm', label: "Algorithm's Friend" },
  { day: 30, id: 'champion', label: 'Viral Challenge Champion' },
];

/** Validate an IANA timezone the way the Intl runtime sees it. */
export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Today's date (YYYY-MM-DD) in the given zone — the server-side day boundary. */
export function localDateIn(tz: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return parts; // en-CA gives YYYY-MM-DD directly
}

/** Local date -> epoch ms at the drop hour, in the zone (for availability). */
export function dropAvailableAtIso(tz: string, localDate: string, now = new Date()): string {
  // Interpret localDate + DAILY_DROP_LOCAL_HOUR as wall-clock in tz.
  const guess = new Date(`${localDate}T${String(DAILY_DROP_LOCAL_HOUR).padStart(2, '0')}:00:00Z`);
  // Offset between tz and UTC at that instant, applied twice for convergence.
  for (let i = 0; i < 2; i += 1) {
    const offsetMin = tzOffsetMinutes(tz, guess);
    guess.setTime(Date.parse(`${localDate}T${String(DAILY_DROP_LOCAL_HOUR).padStart(2, '0')}:00:00Z`) - offsetMin * 60_000);
  }
  void now;
  return guess.toISOString();
}

function tzOffsetMinutes(tz: string, at: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = dtf.formatToParts(at).reduce<Record<string, string>>((acc, x) => {
    if (x.type !== 'literal') acc[x.type] = x.value;
    return acc;
  }, {});
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour === '24' ? '0' : p.hour), Number(p.minute), Number(p.second));
  return (asUtc - at.getTime()) / 60_000;
}

/**
 * Deterministic daily-drop topic rotation through the hunger cards.
 * Day index = elapsed days since start (1-based), so the same day always
 * resolves to the same topic — "curated", never random.
 */
export function dropTopic(
  hungers: Array<{ topic: string }>,
  elapsedDays: number,
): { topic: string; rotationIndex: number } | null {
  if (hungers.length === 0) return null;
  const idx = (elapsedDays - 1 + hungers.length) % hungers.length;
  const chosen = hungers[idx];
  return chosen ? { topic: chosen.topic, rotationIndex: idx } : null;
}

export function milestonesFor(totalScriptDays: number): Milestone[] {
  return MILESTONE_DEFS.map((m) => ({ ...m, achieved: totalScriptDays >= m.day }));
}

export type DayCell =
  | { kind: 'done'; date: string; star: boolean }
  | { kind: 'freeze'; date: string }
  | { kind: 'missed'; date: string }
  | { kind: 'today'; date: string; done: boolean; star: boolean }
  | { kind: 'locked'; date: null; dayNumber: number };

/** Build the 30-cell grid the UI renders directly. */
export function buildCalendar(state: ChallengeRpcState): DayCell[] {
  const byDate = new Map<string, { script: boolean; publish: boolean; freeze: boolean }>();
  for (const c of state.calendar) {
    const row = byDate.get(c.date) ?? { script: false, publish: false, freeze: false };
    if (c.action === 'script') row.script = true;
    if (c.action === 'publish') row.publish = true;
    if (c.action === 'freeze') row.freeze = true;
    byDate.set(c.date, row);
  }

  const cells: DayCell[] = [];
  const start = new Date(`${state.start_date}T00:00:00Z`);
  for (let i = 0; i < CHALLENGE_LENGTH_DAYS; i += 1) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const row = byDate.get(iso);
    if (iso > state.today_local) {
      cells.push({ kind: 'locked', date: null, dayNumber: i + 1 });
    } else if (iso === state.today_local) {
      cells.push({ kind: 'today', date: iso, done: row?.script ?? false, star: row?.publish ?? false });
    } else if (row?.script) {
      cells.push({ kind: 'done', date: iso, star: row.publish });
    } else if (row?.freeze) {
      cells.push({ kind: 'freeze', date: iso });
    } else {
      cells.push({ kind: 'missed', date: iso });
    }
  }
  return cells;
}
