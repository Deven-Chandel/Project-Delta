/**
 * Low-precision solar position (accurate to ~0.01°, plenty for a terminator).
 * Based on the Astronomical Almanac's approximate algorithm.
 */
const DEG = Math.PI / 180;

export interface LatLon {
  lat: number;
  lon: number;
}

/** Days since J2000.0 (2000-01-01 12:00 TT, ignoring the ~69 s TT/UTC gap). */
export function daysSinceJ2000(time: number): number {
  return time / 86_400_000 + 2440587.5 - 2451545.0;
}

/** Greenwich mean sidereal time in degrees, 0–360. */
export function gmstDegrees(time: number): number {
  const n = daysSinceJ2000(time);
  return mod(280.46061837 + 360.98564736629 * n, 360);
}

/** The point on Earth where the sun is directly overhead. */
export function subsolarPoint(time: number): LatLon {
  const n = daysSinceJ2000(time);
  const L = mod(280.46 + 0.9856474 * n, 360);
  const g = mod(357.528 + 0.9856003 * n, 360) * DEG;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG;
  const epsilon = (23.439 - 0.0000004 * n) * DEG;

  const declination = Math.asin(Math.sin(epsilon) * Math.sin(lambda));
  const rightAscension = Math.atan2(Math.cos(epsilon) * Math.sin(lambda), Math.cos(lambda));

  return {
    lat: declination / DEG,
    lon: normalizeLon(rightAscension / DEG - gmstDegrees(time)),
  };
}

/** Elevation of the sun above the horizon at a place, in degrees. */
export function sunElevation(lat: number, lon: number, time: number): number {
  const s = subsolarPoint(time);
  const cosZenith =
    Math.sin(lat * DEG) * Math.sin(s.lat * DEG) +
    Math.cos(lat * DEG) * Math.cos(s.lat * DEG) * Math.cos((lon - s.lon) * DEG);
  return 90 - Math.acos(clamp(cosZenith, -1, 1)) / DEG;
}

export type DayPhase = 'day' | 'golden' | 'twilight' | 'night';

export function dayPhase(elevation: number): DayPhase {
  if (elevation > 6) return 'day';
  if (elevation > -0.833) return 'golden';
  if (elevation > -12) return 'twilight';
  return 'night';
}

export function normalizeLon(lon: number): number {
  return mod(lon + 180, 360) - 180;
}

function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
