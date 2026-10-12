/**
 * Share a group as a URL fragment. No server: the whole group is serialized,
 * UTF-8 encoded and base64url'd into `#g=…`, and validated on the way back in.
 */
import type { Group, Place } from './types';
import { isValidTimeZone } from './tz';

type PackedPlace = [name: string, region: string, lat: number, lon: number, tz: string];
interface Packed {
  v: 1;
  n: string;
  s: PackedPlace[];
}

export function encodeGroup(group: Group): string {
  const packed: Packed = {
    v: 1,
    n: group.name,
    s: group.places.map((p) => [p.name, p.region, round(p.lat), round(p.lon), p.tz]),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(packed));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeGroup(token: string): { name: string; places: Omit<Place, 'id'>[] } | null {
  try {
    const b64 = token.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const data = JSON.parse(new TextDecoder().decode(bytes)) as Packed;
    if (data?.v !== 1 || typeof data.n !== 'string' || !Array.isArray(data.s)) return null;
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
      .map(([name, region, lat, lon, tz]) => ({
        name: name.slice(0, 80),
        region: String(region ?? '').slice(0, 40),
        lat,
        lon,
        tz,
      }));
    if (places.length === 0) return null;
    return { name: data.n.slice(0, 80) || 'Shared group', places };
  } catch {
    return null;
  }
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
