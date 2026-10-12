/**
 * Staffed / on-air hours. Windows are local wall-clock minutes and may wrap
 * past midnight; every boundary goes through zonedToUtc so DST days (23 h /
 * 25 h) come out right.
 */
import type { Group, Place, ShiftWindow } from './types';
import { zonedParts, zonedToUtc, type Interval } from './tz';

const DAY = 86_400_000;

export function parseShift(text: string): ShiftWindow | null {
  const t = text.trim().toLowerCase();
  if (t === '24h' || t === '24/7' || t === '00:00-24:00') return { start: 0, end: 0 };
  const m = t.match(/^(\d{1,2}):?(\d{2})\s*[-–to]+\s*(\d{1,2}):?(\d{2})$/);
  if (!m) return null;
  const [sh, sm, eh, em] = m.slice(1).map(Number);
  if (sh > 24 || eh > 24 || sm > 59 || em > 59) return null;
  const start = (sh % 24) * 60 + sm;
  const end = (eh % 24) * 60 + em;
  return { start, end };
}

export function formatMinutes(min: number): string {
  return `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

export function formatShift(w: ShiftWindow): string {
  if (w.start === w.end) return '24 h';
  return `${formatMinutes(w.start)}–${formatMinutes(w.end)}`;
}

export function isValidShift(w: unknown): w is ShiftWindow {
  const s = w as ShiftWindow;
  return (
    !!s &&
    Number.isInteger(s.start) &&
    Number.isInteger(s.end) &&
    s.start >= 0 &&
    s.start < 1440 &&
    s.end >= 0 &&
    s.end < 1440
  );
}

/** A site's effective hours: its own, else its group's. */
export function shiftsFor(place: Place, group: Group | null): ShiftWindow[] {
  return place.shifts ?? group?.shifts ?? [];
}

/** UTC intervals in [from, to) during which the windows are staffed. */
export function shiftIntervals(tz: string, windows: ShiftWindow[], from: number, to: number): Interval[] {
  const out: Interval[] = [];
  if (windows.length === 0) return out;
  const first = zonedParts(tz, from - DAY);
  let cursor = Date.UTC(first.year, first.month - 1, first.day);
  const stop = to + DAY;
  while (cursor < stop) {
    const d = new Date(cursor);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    for (const w of windows) {
      const s = zonedToUtc(tz, y, m, day, Math.floor(w.start / 60), w.start % 60);
      // Wrapping (or 24 h) windows end on the next local day.
      const next = new Date(Date.UTC(y, m - 1, day + (w.end <= w.start ? 1 : 0)));
      const e = zonedToUtc(tz, next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), Math.floor(w.end / 60), w.end % 60);
      const a = Math.max(s, from);
      const b = Math.min(e, to);
      if (b > a) out.push([a, b]);
    }
    cursor += DAY;
  }
  return mergeIntervals(out);
}

export function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = [...list].sort((a, b) => a[0] - b[0]);
  const out: Interval[] = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
    else out.push([iv[0], iv[1]]);
  }
  return out;
}

/** Overlap of two sorted, non-overlapping interval lists (linear two-pointer merge). */
export function intersectIntervals(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const lo = Math.max(a[i][0], b[j][0]);
    const hi = Math.min(a[i][1], b[j][1]);
    if (hi > lo) out.push([lo, hi]);
    if (a[i][1] < b[j][1]) i++;
    else j++;
  }
  return out;
}

export type Coverage = 'on' | 'ending' | 'off' | 'none';

export interface CoverageState {
  state: Coverage;
  /** When the current state ends (shift end, or next shift start); null if never in the next 48 h. */
  until: number | null;
}

/** Is a site staffed at time t, and until when? End is exclusive. */
export function coverageAt(tz: string, windows: ShiftWindow[], t: number, warnMin = 30): CoverageState {
  if (windows.length === 0) return { state: 'none', until: null };
  const ivs = shiftIntervals(tz, windows, t - 2 * DAY, t + 2 * DAY);
  const cur = ivs.find(([a, b]) => a <= t && t < b);
  if (cur) {
    const always = cur[0] <= t - DAY && cur[1] >= t + DAY;
    if (always) return { state: 'on', until: null };
    return { state: cur[1] - t <= warnMin * 60_000 ? 'ending' : 'on', until: cur[1] };
  }
  const next = ivs.find(([a]) => a > t);
  return { state: 'off', until: next ? next[0] : null };
}
