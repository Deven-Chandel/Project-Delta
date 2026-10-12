/**
 * Timeline geometry. The axis is linear in UTC milliseconds — it never
 * assumes 24 equal local hours, so DST days and half-hour zones stay exact.
 */
import { dayPhase, sunElevation, type DayPhase } from './sun';
import { zonedParts, zonedToUtc, type Interval } from './tz';

export type AxisMode = 'rolling' | 'day';
const HOUR = 3_600_000;

/** Rolling: 4 h back to 20 h ahead. Day: the NSOC's calendar day. */
export function axisWindow(now: number, nsocTz: string, mode: AxisMode): Interval {
  if (mode === 'rolling') {
    const from = Math.floor(now / HOUR) * HOUR - 4 * HOUR;
    return [from, from + 24 * HOUR];
  }
  const z = zonedParts(nsocTz, now);
  const from = zonedToUtc(nsocTz, z.year, z.month, z.day, 0, 0);
  const n = new Date(Date.UTC(z.year, z.month - 1, z.day + 1));
  return [from, zonedToUtc(nsocTz, n.getUTCFullYear(), n.getUTCMonth() + 1, n.getUTCDate(), 0, 0)];
}

export function timeToFrac(t: number, [from, to]: Interval): number {
  return (t - from) / (to - from);
}

/** Fraction → instant, snapped to 15 min (every real zone offset is a multiple of 15). */
export function fracToTime(f: number, [from, to]: Interval, snapMin = 15): number {
  const t = from + Math.min(1, Math.max(0, f)) * (to - from);
  const snap = snapMin * 60_000;
  return Math.round(t / snap) * snap;
}

export interface Tick {
  t: number;
  hour: number;
}

/** Instants where the zone's local clock reads a whole hour divisible by `every`. */
export function localTicks(tz: string, [from, to]: Interval, every = 3): Tick[] {
  const out: Tick[] = [];
  const step = 15 * 60_000;
  for (let t = Math.ceil(from / step) * step; t <= to; t += step) {
    const z = zonedParts(tz, t);
    if (z.minute === 0 && z.hour % every === 0) out.push({ t, hour: z.hour });
  }
  return out;
}

export interface PhaseBand {
  from: number;
  to: number;
  phase: DayPhase;
}

/** Day / golden / twilight / night bands at a location, sampled every 10 min. */
export function lightBands(lat: number, lon: number, [from, to]: Interval, stepMin = 10): PhaseBand[] {
  const out: PhaseBand[] = [];
  const step = stepMin * 60_000;
  for (let t = from; t < to; t += step) {
    const phase = dayPhase(sunElevation(lat, lon, t + step / 2));
    const last = out[out.length - 1];
    if (last && last.phase === phase) last.to = Math.min(to, t + step);
    else out.push({ from: t, to: Math.min(to, t + step), phase });
  }
  return out;
}
