/**
 * Event timing: countdown labels and the next occurrence of repeating events.
 */
import { resolveLocal, toLocalString } from './convert';
import { zonedParts } from './tz';
import type { TBEvent } from './types';

export function countdownLabel(target: number, now: number): string {
  const diff = target - now;
  const abs = Math.abs(diff);
  if (abs < 60_000) return 'now';
  const m = Math.round(abs / 60_000);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const mm = m % 60;
  const text = d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${pad(mm)}m` : `${mm}m`;
  return diff > 0 ? `in ${text}` : `started ${text} ago`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** UTC start of the event's stored wall time (no repeat applied). */
export function eventInstant(ev: TBEvent): number | null {
  return resolveLocal(ev.tz, ev.local)?.utc ?? null;
}

/**
 * The occurrence that is ongoing or next after `now`. Daily events keep their
 * wall-clock time in their own zone, so DST never shifts them.
 */
export function nextOccurrence(ev: TBEvent, now: number): number | null {
  const first = eventInstant(ev);
  if (first === null) return null;
  // Zero-length events (a handover at 07:00) stay "now" for one minute.
  const dur = Math.max(ev.durationMin * 60_000, 60_000);
  if (ev.repeat === 'none' || first + dur > now) return first;
  const time = ev.local.slice(11);
  const z = zonedParts(ev.tz, now - dur);
  for (let i = 0; i < 3; i++) {
    const d = new Date(Date.UTC(z.year, z.month - 1, z.day + i));
    const local = `${d.toISOString().slice(0, 10)}T${time}`;
    const t = resolveLocal(ev.tz, local)?.utc;
    if (t !== undefined && t + dur > now) return t;
  }
  return null;
}

export type EventPhase = 'upcoming' | 'live' | 'past';

export interface Scheduled {
  ev: TBEvent;
  start: number;
  end: number;
  phase: EventPhase;
}

export function schedule(events: TBEvent[], now: number): Scheduled[] {
  const out: Scheduled[] = [];
  for (const ev of events) {
    const start = nextOccurrence(ev, now);
    if (start === null) continue;
    const end = start + ev.durationMin * 60_000;
    const phase: EventPhase = now < start ? 'upcoming' : now < Math.max(end, start + 60_000) ? 'live' : 'past';
    out.push({ ev, start, end, phase });
  }
  const rank = { live: 0, upcoming: 1, past: 2 } as const;
  return out.sort((a, b) => rank[a.phase] - rank[b.phase] || (a.phase === 'past' ? b.start - a.start : a.start - b.start));
}

/** A fresh "YYYY-MM-DDTHH:mm" for a time later today (or tomorrow) in a zone. */
export function localAt(tz: string, now: number, minutesFromMidnight: number, dayOffset = 0): string {
  const z = zonedParts(tz, now);
  const d = new Date(Date.UTC(z.year, z.month - 1, z.day + dayOffset));
  return `${d.toISOString().slice(0, 10)}T${pad(Math.floor(minutesFromMidnight / 60))}:${pad(minutesFromMidnight % 60)}`;
}

export { toLocalString };
