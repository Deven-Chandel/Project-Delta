/**
 * Share a group as a URL fragment. No server: the group (with its hours and
 * events) is serialized, UTF-8 encoded and base64url'd into `#g=…`, and
 * validated on the way back in. v1 links (no hours/events) still decode.
 */
import { cleanEvent, cleanShifts } from './validate';
import type { Group, Place, ShiftWindow, TBEvent } from './types';
import { isValidTimeZone } from './tz';

type PackedPlace = [name: string, region: string, lat: number, lon: number, tz: string, shifts?: [number, number][]];
type PackedEvent = [title: string, kind: string, local: string, tz: string, durationMin: number, repeat: string, source: string];
interface Packed {
  v: 1 | 2;
  n: string;
  s: PackedPlace[];
  h?: [number, number][];
  e?: PackedEvent[];
}

export interface SharedGroup {
  name: string;
  places: Omit<Place, 'id'>[];
  shifts: ShiftWindow[];
  events: Omit<TBEvent, 'id' | 'groupId'>[];
}

const packShifts = (w: ShiftWindow[]) => w.map((x) => [x.start, x.end] as [number, number]);
const unpackShifts = (raw: unknown) =>
  cleanShifts(Array.isArray(raw) ? raw.map((p) => (Array.isArray(p) ? { start: p[0], end: p[1] } : null)) : []);

export function encodeGroup(group: Group, events: TBEvent[] = []): string {
  const packed: Packed = {
    v: 2,
    n: group.name,
    s: group.places.map((p) => {
      const row: PackedPlace = [p.name, p.region, round(p.lat), round(p.lon), p.tz];
      if (p.shifts) row.push(packShifts(p.shifts));
      return row;
    }),
  };
  if (group.shifts.length) packed.h = packShifts(group.shifts);
  const evs = events.slice(0, 50);
  if (evs.length) packed.e = evs.map((e) => [e.title, e.kind, e.local, e.tz, e.durationMin, e.repeat, e.sourceLabel]);
  const bytes = new TextEncoder().encode(JSON.stringify(packed));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeGroup(token: string): SharedGroup | null {
  try {
    const b64 = token.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const data = JSON.parse(new TextDecoder().decode(bytes)) as Packed;
    if ((data?.v !== 1 && data?.v !== 2) || typeof data.n !== 'string' || !Array.isArray(data.s)) return null;
    const places = data.s
      .filter(
        (s) =>
          Array.isArray(s) &&
          typeof s[0] === 'string' &&
          Number.isFinite(s[2]) &&
          Number.isFinite(s[3]) &&
          Math.abs(s[2]) <= 90 &&
          Math.abs(s[3]) <= 180 &&
          typeof s[4] === 'string' &&
          isValidTimeZone(s[4]),
      )
      .slice(0, 200)
      .map(([name, region, lat, lon, tz, sh]) => {
        const p: Omit<Place, 'id'> = { name: name.slice(0, 80), region: String(region ?? '').slice(0, 40), lat, lon, tz };
        if (sh !== undefined) p.shifts = unpackShifts(sh);
        return p;
      });
    if (places.length === 0) return null;
    const events = (Array.isArray(data.e) ? data.e : [])
      .slice(0, 50)
      .map((e) =>
        Array.isArray(e)
          ? cleanEvent({ title: e[0], kind: e[1], local: e[2], tz: e[3], durationMin: e[4], repeat: e[5], sourceLabel: e[6] }, 'x')
          : null,
      )
      .filter((e): e is TBEvent => e !== null)
      .map(({ id: _id, groupId: _g, ...rest }) => rest);
    return { name: data.n.slice(0, 80) || 'Shared group', places, shifts: unpackShifts(data.h), events };
  } catch {
    return null;
  }
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
