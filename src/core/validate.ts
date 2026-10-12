/**
 * Validators for anything that arrives from outside: share links, backup
 * files, and old localStorage blobs. Unknown input in, well-formed data out.
 */
import { isValidShift } from './shifts';
import { isValidTimeZone } from './tz';
import type { EventKind, Place, ShiftWindow, TBEvent } from './types';

const KINDS: EventKind[] = ['broadcast', 'maintenance', 'shift', 'other'];

export function cleanShifts(raw: unknown): ShiftWindow[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isValidShift).slice(0, 6).map((w) => ({ start: w.start, end: w.end }));
}

export function cleanPlace(raw: unknown, id: string): Place | null {
  const p = raw as Partial<Place>;
  if (!p || typeof p.name !== 'string' || typeof p.tz !== 'string' || !isValidTimeZone(p.tz)) return null;
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon) || Math.abs(p.lat!) > 90 || Math.abs(p.lon!) > 180) return null;
  const place: Place = {
    id: typeof p.id === 'string' && p.id ? p.id : id,
    name: p.name.slice(0, 80),
    region: String(p.region ?? '').slice(0, 40),
    lat: p.lat!,
    lon: p.lon!,
    tz: p.tz,
  };
  if (p.shifts !== undefined) place.shifts = cleanShifts(p.shifts);
  return place;
}

export function cleanEvent(raw: unknown, id: string): TBEvent | null {
  const e = raw as Partial<TBEvent>;
  if (!e || typeof e.title !== 'string' || typeof e.local !== 'string' || typeof e.tz !== 'string') return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(e.local) || !isValidTimeZone(e.tz)) return null;
  return {
    id: typeof e.id === 'string' && e.id ? e.id : id,
    title: e.title.slice(0, 120) || 'Event',
    kind: KINDS.includes(e.kind as EventKind) ? (e.kind as EventKind) : 'other',
    local: e.local,
    tz: e.tz,
    sourceLabel: String(e.sourceLabel ?? '').slice(0, 80),
    durationMin: Number.isFinite(e.durationMin) ? Math.max(0, Math.min(7 * 1440, Math.round(e.durationMin!))) : 0,
    repeat: e.repeat === 'daily' ? 'daily' : 'none',
    groupId: typeof e.groupId === 'string' ? e.groupId : null,
  };
}
