import { describe, expect, it } from 'vitest';
import {
  buildCalendar,
  dropAvailableAtIso,
  dropTopic,
  isValidTimezone,
  localDateIn,
  milestonesFor,
  type ChallengeRpcState,
} from '../src/challenge/challenge-core.js';

function stateFixture(over: Partial<ChallengeRpcState> = {}): ChallengeRpcState {
  return {
    status: 'active',
    timezone: 'Asia/Kolkata',
    start_date: '2026-08-01',
    today_local: '2026-08-05',
    elapsed_days: 5,
    streak: 4,
    best_streak: 4,
    freezes_used: 0,
    freezes_earned: 0,
    total_script_days: 4,
    total_publish_days: 0,
    calendar: [
      { date: '2026-08-01', action: 'script', script_package_id: null },
      { date: '2026-08-02', action: 'script', script_package_id: null },
      { date: '2026-08-03', action: 'freeze', script_package_id: null },
      { date: '2026-08-03', action: 'publish', script_package_id: null },
      { date: '2026-08-04', action: 'script', script_package_id: null },
    ],
    ...over,
  };
}

describe('timezone handling (the server-side day boundary)', () => {
  it('accepts valid IANA zones and rejects junk', () => {
    expect(isValidTimezone('Asia/Kolkata')).toBe(true);
    expect(isValidTimezone('America/New_York')).toBe(true);
    expect(isValidTimezone('Not/AZone')).toBe(false);
    expect(isValidTimezone('')).toBe(false);
  });

  it('computes the local date at a fixed instant across zones', () => {
    const instant = new Date('2026-08-24T20:30:00Z'); // 02:00 IST next day, 16:30 NY previous day
    expect(localDateIn('Asia/Kolkata', instant)).toBe('2026-08-25');
    expect(localDateIn('America/New_York', instant)).toBe('2026-08-24');
  });

  it('IST day boundary: 18:29:59Z vs 18:30:00Z flip the local date', () => {
    expect(localDateIn('Asia/Kolkata', new Date('2026-08-24T18:29:59Z'))).toBe('2026-08-24');
    expect(localDateIn('Asia/Kolkata', new Date('2026-08-24T18:30:00Z'))).toBe('2026-08-25');
  });

  it('drop time lands at 05:00 user-local (IST = 23:30Z previous day)', () => {
    const iso = dropAvailableAtIso('Asia/Kolkata', '2026-08-25');
    expect(iso).toBe('2026-08-24T23:30:00.000Z');
    const ny = dropAvailableAtIso('America/New_York', '2026-08-25');
    expect(ny).toBe('2026-08-25T09:00:00.000Z');
  });
});

describe('daily drop rotation (deterministic curation)', () => {
  const hungers = [{ topic: 'camera review' }, { topic: 'editing tips' }, { topic: 'vlog' }];
  it('rotates through hunger cards and repeats', () => {
    expect(dropTopic(hungers, 1)?.topic).toBe('camera review');
    expect(dropTopic(hungers, 2)?.topic).toBe('editing tips');
    expect(dropTopic(hungers, 3)?.topic).toBe('vlog');
    expect(dropTopic(hungers, 4)?.topic).toBe('camera review');
  });
  it('same day always resolves identically', () => {
    expect(dropTopic(hungers, 9)).toEqual(dropTopic(hungers, 9));
  });
  it('returns null with no hunger cards (cold start)', () => {
    expect(dropTopic([], 1)).toBeNull();
  });
});

describe('milestones', () => {
  it('lights up in order at total script-day thresholds', () => {
    const m0 = milestonesFor(6);
    expect(m0.every((m) => !m.achieved)).toBe(true);
    const m7 = milestonesFor(7);
    expect(m7.find((m) => m.id === 'rising')?.achieved).toBe(true);
    expect(m7.find((m) => m.id === 'momentum')?.achieved).toBe(false);
    const m30 = milestonesFor(30);
    expect(m30.every((m) => m.achieved)).toBe(true);
  });
});

describe('30-cell calendar construction', () => {
  it('renders done/star/freeze/missed/today/locked from the RPC calendar', () => {
    const cells = buildCalendar(stateFixture());
    expect(cells).toHaveLength(30);
    expect(cells[0]).toEqual({ kind: 'done', date: '2026-08-01', star: false });
    expect(cells[2]).toEqual({ kind: 'freeze', date: '2026-08-03' }); // freeze + script same day -> script wins
    expect(cells[3]).toEqual({ kind: 'done', date: '2026-08-04', star: false });
    expect(cells[4]).toEqual({ kind: 'today', date: '2026-08-05', done: false, star: false });
    expect(cells[5]).toEqual({ kind: 'locked', date: null, dayNumber: 6 });
    // a script day with a publish row renders starred
    const starred = buildCalendar(stateFixture({
      calendar: [
        { date: '2026-08-01', action: 'script', script_package_id: null },
        { date: '2026-08-01', action: 'publish', script_package_id: null },
      ],
    }));
    expect(starred[0]).toEqual({ kind: 'done', date: '2026-08-01', star: true });
  });
  it('a missed unshielded past day renders missed', () => {
    const cells = buildCalendar(stateFixture({ calendar: [] }));
    expect(cells[0]).toEqual({ kind: 'missed', date: '2026-08-01' });
  });
});
