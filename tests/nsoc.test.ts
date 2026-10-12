import { describe, expect, it } from 'vitest';
import { zoneAbbr } from '../src/core/abbr';
import { mergeBackup, exportState } from '../src/core/backup';
import { dayShift, parseClock, resolveLocal, toLocalString } from '../src/core/convert';
import { countdownLabel, nextOccurrence, schedule } from '../src/core/countdown';
import { migrate, type AppState } from '../src/core/migrate';
import { assignSlots, familyKey } from '../src/core/palette';
import { reportBlock, reportLine, reportRows } from '../src/core/report';
import { decodeGroup, encodeGroup } from '../src/core/share';
import { coverageAt, formatShift, parseShift, shiftIntervals } from '../src/core/shifts';
import { axisWindow, fracToTime, localTicks } from '../src/core/timeline';
import { CANADA } from '../src/data/presets';
import type { Group, TBEvent } from '../src/core/types';

const H = 3_600_000;
const TOR = 'America/Toronto';
const toronto = { name: 'Toronto', tz: TOR };

describe('resolveLocal (DST-aware event entry)', () => {
  it('resolves an ordinary time', () => {
    expect(resolveLocal(TOR, '2026-07-01T14:00')).toEqual({ utc: Date.UTC(2026, 6, 1, 18), status: 'ok' });
  });
  it('flags a time skipped by spring-forward and moves it past the gap', () => {
    const r = resolveLocal(TOR, '2026-03-08T02:30')!;
    expect(r.status).toBe('gap');
    expect(toLocalString(TOR, r.utc)).toBe('2026-03-08T03:30');
  });
  it('flags a time repeated by fall-back and picks the first (EDT) occurrence', () => {
    const r = resolveLocal(TOR, '2026-11-01T01:30')!;
    expect(r.status).toBe('ambiguous');
    expect(r.utc).toBe(Date.UTC(2026, 10, 1, 5, 30));
  });
  it('rejects malformed input', () => {
    expect(resolveLocal(TOR, '2026-13-01T10:00')).toBeNull();
    expect(resolveLocal(TOR, 'tomorrow')).toBeNull();
  });
});

describe('parsing what controllers type', () => {
  it('reads common clock formats', () => {
    expect(parseClock('1400')).toBe(840);
    expect(parseClock('14:00')).toBe(840);
    expect(parseClock('930')).toBe(570);
    expect(parseClock('2pm')).toBe(840);
    expect(parseClock('12am')).toBe(0);
    expect(parseClock('12:30 pm')).toBe(750);
    expect(parseClock('25:00')).toBeNull();
    expect(parseClock('13pm')).toBeNull();
  });
  it('reads shift ranges', () => {
    expect(parseShift('22:00-06:00')).toEqual({ start: 1320, end: 360 });
    expect(parseShift('0700–2300')).toEqual({ start: 420, end: 1380 });
    expect(parseShift('24h')).toEqual({ start: 0, end: 0 });
    expect(parseShift('nonsense')).toBeNull();
    expect(formatShift({ start: 1320, end: 360 })).toBe('22:00–06:00');
    expect(formatShift({ start: 0, end: 0 })).toBe('24 h');
  });
});

describe('shift coverage', () => {
  const night = [{ start: 22 * 60, end: 6 * 60 }];
  const at = (local: string) => resolveLocal(TOR, local)!.utc;
  const hours = ([a, b]: [number, number]) => (b - a) / H;

  it('handles DST day lengths: a 22–06 shift is 7 h in spring, 9 h in autumn', () => {
    const spring = shiftIntervals(TOR, night, at('2026-03-07T12:00'), at('2026-03-08T12:00'));
    expect(spring.map(hours)).toEqual([7]);
    const autumn = shiftIntervals(TOR, night, at('2026-10-31T12:00'), at('2026-11-01T12:00'));
    expect(autumn.map(hours)).toEqual([9]);
    const day = shiftIntervals(TOR, [{ start: 360, end: 1080 }], at('2026-03-08T00:00'), at('2026-03-08T23:00'));
    expect(day.map(hours)).toEqual([12]);
  });

  it('covers overnight shifts across midnight, with an exclusive end', () => {
    expect(coverageAt(TOR, night, at('2026-07-01T23:30')).state).toBe('on');
    expect(coverageAt(TOR, night, at('2026-07-02T05:59')).state).toBe('ending');
    expect(coverageAt(TOR, night, at('2026-07-02T06:00')).state).toBe('off');
    expect(coverageAt(TOR, night, at('2026-07-02T21:59')).state).toBe('off');
    expect(coverageAt(TOR, night, at('2026-07-02T21:59')).until).toBe(at('2026-07-02T22:00'));
  });

  it('treats start === end as staffed around the clock', () => {
    expect(coverageAt(TOR, [{ start: 0, end: 0 }], at('2026-07-01T03:00'))).toEqual({ state: 'on', until: null });
  });

  it('says "none" when no hours are set', () => {
    expect(coverageAt(TOR, [], Date.now()).state).toBe('none');
  });
});

describe('report lines', () => {
  const summer = Date.UTC(2026, 6, 15, 18, 0); // 14:00 EDT

  it('writes the Canadian line NSOC-first, west, then east', () => {
    const rows = reportRows(summer, CANADA, toronto);
    expect(reportLine(rows)).toBe('14:00 ET / 13:00 CT / 12:00 CST / 12:00 MT / 11:00 MST / 11:00 PT / 15:00 AT / 15:30 NT');
  });

  it('merges sites on the same clock and the NSOC itself', () => {
    const rows = reportRows(summer, CANADA, toronto);
    const et = rows.find((r) => r.abbr === 'ET')!;
    expect(et.isNsoc).toBe(true);
    expect(et.names).toEqual(expect.arrayContaining(['Toronto', 'Iqaluit', 'Thunder Bay']));
    expect(et.names.filter((n) => n === 'Toronto')).toHaveLength(1);
  });

  it('marks the weekday when a site is on a different date (date line)', () => {
    const mon9 = Date.UTC(2026, 9, 12, 13, 0); // Mon 09:00 EDT
    const rows = reportRows(mon9, [{ name: 'Auckland', tz: 'Pacific/Auckland' }, { name: 'Pago Pago', tz: 'Pacific/Pago_Pago' }], toronto);
    const line = reportLine(rows);
    expect(line).toContain('02:00 NZDT (Tue)');
    expect(dayShift('Pacific/Pago_Pago', TOR, mon9)).toBe(0);
    expect(dayShift('Pacific/Kiritimati', TOR, mon9)).toBe(1);
  });

  it('builds a multi-line block for emails', () => {
    const block = reportBlock('Maintenance', summer, reportRows(summer, CANADA.slice(0, 2), toronto), TOR);
    expect(block.split('\n')[0]).toBe('Maintenance — Wed 2026-07-15');
    expect(block).toContain('(18:00 UTC)');
  });

  it('pins abbreviations Intl gets wrong or leaves long', () => {
    expect(zoneAbbr('America/Whitehorse', summer)).toBe('MST');
    expect(zoneAbbr('America/Regina', summer)).toBe('CST');
    expect(zoneAbbr('America/St_Johns', summer)).toBe('NT');
    expect(zoneAbbr('America/St_Johns', summer, 'specific')).toBe('NDT');
  });
});

describe('events and countdowns', () => {
  const ev = (over: Partial<TBEvent>): TBEvent => ({
    id: 'e',
    title: 'Shift change',
    kind: 'shift',
    local: '2026-03-07T07:00',
    tz: TOR,
    sourceLabel: 'NSOC',
    durationMin: 0,
    repeat: 'daily',
    groupId: null,
    ...over,
  });

  it('formats countdowns', () => {
    expect(countdownLabel(72 * 60_000, 0)).toBe('in 1h 12m');
    expect(countdownLabel(0, 5 * 60_000)).toBe('started 5m ago');
    expect(countdownLabel(30_000, 0)).toBe('now');
    expect(countdownLabel(26 * H, 0)).toBe('in 1d 2h');
  });

  it('keeps a daily event at the same local time across DST', () => {
    const now = Date.UTC(2026, 2, 9, 12, 0); // Mon 08:00 EDT, after the change
    const next = nextOccurrence(ev({}), now)!;
    expect(toLocalString(TOR, next)).toBe('2026-03-10T07:00');
    expect(next).toBe(Date.UTC(2026, 2, 10, 11, 0));
  });

  it('orders live, then upcoming, then past', () => {
    const now = Date.UTC(2026, 6, 1, 18, 30);
    const list = schedule(
      [
        ev({ id: 'past', local: '2026-07-01T09:00', repeat: 'none' }),
        ev({ id: 'live', local: '2026-07-01T14:00', repeat: 'none', durationMin: 60 }),
        ev({ id: 'soon', local: '2026-07-01T16:00', repeat: 'none' }),
      ],
      now,
    );
    expect(list.map((s) => `${s.ev.id}:${s.phase}`)).toEqual(['live:live', 'soon:upcoming', 'past:past']);
  });
});

describe('colour slots', () => {
  it('gives zones with identical clocks one colour', () => {
    expect(familyKey('America/Iqaluit')).toBe(familyKey(TOR));
    const slots = assignSlots([TOR, 'America/Iqaluit', 'America/Thunder_Bay', 'America/Winnipeg']);
    expect(slots.size).toBe(2);
  });
  it('never generates a 9th hue', () => {
    const tzs = ['UTC', 'Europe/Berlin', 'Europe/Athens', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Tokyo', 'Australia/Sydney', 'Pacific/Auckland', 'America/Toronto'];
    const slots = [...assignSlots(tzs).values()];
    expect(slots.slice(0, 8)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(slots[8]).toBeNull();
  });
});

describe('timeline axis', () => {
  it('uses the real length of the NSOC day (23 h on spring-forward)', () => {
    const [a, b] = axisWindow(Date.UTC(2026, 2, 8, 17), TOR, 'day');
    expect((b - a) / H).toBe(23);
  });
  it('places half-hour zone ticks on :30 UTC', () => {
    const ticks = localTicks('Asia/Kolkata', [Date.UTC(2026, 0, 1), Date.UTC(2026, 0, 2)], 3);
    expect(ticks.length).toBe(8);
    expect(ticks.every((t) => new Date(t.t).getUTCMinutes() === 30)).toBe(true);
  });
  it('snaps hover positions to 15 minutes', () => {
    const w: [number, number] = [0, 24 * H];
    expect(fracToTime(0.5 + 1 / 1440, w)).toBe(12 * H);
  });
});

describe('storage migration', () => {
  const fallback = (): AppState => ({
    version: 2,
    groups: [{ id: 'd', name: 'Default', places: [], shifts: [] }],
    activeGroupId: 'd',
    nsoc: { id: 'nsoc', name: 'Toronto', region: 'ON', lat: 43.65, lon: -79.38, tz: TOR },
    nsocConfirmed: false,
    theme: 'dark',
    events: [],
    axis: 'rolling',
  });
  const v1 = {
    groups: [{ id: 'g1', name: 'Bureaus', places: [{ id: 'p1', name: 'Halifax', region: 'NS', lat: 44.6, lon: -63.5, tz: 'America/Halifax' }] }],
    activeGroupId: 'g1',
    home: { id: 'home', name: 'Ottawa', region: 'ON', lat: 45.42, lon: -75.69, tz: TOR },
    homeAuto: false,
    theme: 'cream',
    mode: 'orbits',
    datasets: ['starlink'],
    workStart: 9,
    workEnd: 17,
  };

  it('keeps a v1 user’s groups, theme and pinned site', () => {
    const s = migrate(v1, fallback());
    expect(s.groups[0]).toMatchObject({ id: 'g1', name: 'Bureaus', shifts: [] });
    expect(s.groups[0].places[0].id).toBe('p1');
    expect(s.nsoc).toMatchObject({ id: 'nsoc', name: 'Ottawa' });
    expect(s.nsocConfirmed).toBe(true);
    expect(s.theme).toBe('cream');
    expect('mode' in s).toBe(false);
  });
  it('is idempotent and survives garbage', () => {
    const once = migrate(v1, fallback());
    expect(migrate(JSON.parse(JSON.stringify(once)), fallback())).toEqual(once);
    expect(migrate('nope', fallback())).toEqual(fallback());
    expect(migrate({ groups: [{ bad: true }] }, fallback())).toEqual(fallback());
  });
});

describe('share links and backups', () => {
  const group: Group = {
    id: 'g',
    name: 'Night desk',
    shifts: [{ start: 1320, end: 360 }],
    places: [{ id: 'a', name: "St. John's", region: 'NL', lat: 47.56, lon: -52.71, tz: 'America/St_Johns', shifts: [{ start: 0, end: 0 }] }],
  };

  it('still opens links made by the previous version', () => {
    const V1 =
      'eyJ2IjoxLCJuIjoiV2VzdCBDb2FzdCBCdXJlYXVzIiwicyI6W1siVmFuY291dmVyIiwiQkMiLDQ5LjI4MywtMTIzLjEyMSwiQW1lcmljYS9WYW5jb3V2ZXIiXSxbIldoaXRlaG9yc2UiLCJZVCIsNjAuNzIxLC0xMzUuMDU3LCJBbWVyaWNhL1doaXRlaG9yc2UiXV19';
    const g = decodeGroup(V1)!;
    expect(g.name).toBe('West Coast Bureaus');
    expect(g.places.map((p) => p.name)).toEqual(['Vancouver', 'Whitehorse']);
    expect(g.shifts).toEqual([]);
    expect(g.events).toEqual([]);
  });

  it('round-trips hours and events in v2 links', () => {
    const e: TBEvent = { id: 'x', title: 'Newscast', kind: 'broadcast', local: '2026-10-14T18:00', tz: TOR, sourceLabel: 'NSOC', durationMin: 60, repeat: 'daily', groupId: 'g' };
    const back = decodeGroup(encodeGroup(group, [e]))!;
    expect(back.shifts).toEqual([{ start: 1320, end: 360 }]);
    expect(back.places[0].shifts).toEqual([{ start: 0, end: 0 }]);
    expect(back.events[0]).toMatchObject({ title: 'Newscast', local: '2026-10-14T18:00', repeat: 'daily', durationMin: 60 });
  });

  it('merges a backup without overwriting existing ids', () => {
    const base: AppState = {
      version: 2,
      groups: [group],
      activeGroupId: 'g',
      nsoc: { id: 'nsoc', name: 'Toronto', region: 'ON', lat: 43.65, lon: -79.38, tz: TOR },
      nsocConfirmed: true,
      theme: 'dark',
      events: [],
      axis: 'rolling',
    };
    const merged = mergeBackup(exportState(base), base)!;
    expect(merged.groups).toBe(1);
    expect(merged.state.groups).toHaveLength(2);
    expect(merged.state.groups[1].id).not.toBe('g');
    expect(mergeBackup('{"app":"other"}', base)).toBeNull();
    expect(mergeBackup('not json', base)).toBeNull();
  });
});

describe('code-review regressions', () => {
  it('shows a zero-length daily event as NOW for its first minute', () => {
    const handover: TBEvent = { id: 'h', title: 'Handover', kind: 'shift', local: '2026-07-01T07:00', tz: TOR, sourceLabel: 'NSOC', durationMin: 0, repeat: 'daily', groupId: null };
    const at0720 = Date.UTC(2026, 6, 3, 11, 0, 20); // 07:00:20 EDT two days later
    const [s] = schedule([handover], at0720);
    expect(s.phase).toBe('live');
    expect(toLocalString(TOR, s.start)).toBe('2026-07-03T07:00');
    const [later] = schedule([handover], at0720 + 2 * 60_000);
    expect(later.phase).toBe('upcoming');
    expect(toLocalString(TOR, later.start)).toBe('2026-07-04T07:00');
  });

  it('rejects impossible calendar dates instead of calling them a DST gap', () => {
    expect(resolveLocal(TOR, '2026-02-31T14:00')).toBeNull();
    expect(resolveLocal(TOR, '2026-04-31T14:00')).toBeNull();
    expect(resolveLocal(TOR, '2028-02-29T14:00')?.status).toBe('ok');
  });

  it('intersects staffed intervals linearly', async () => {
    const { intersectIntervals } = await import('../src/core/shifts');
    expect(intersectIntervals([[0, 10], [20, 30]], [[5, 25]])).toEqual([[5, 10], [20, 25]]);
    expect(intersectIntervals([], [[0, 1]])).toEqual([]);
  });
});
