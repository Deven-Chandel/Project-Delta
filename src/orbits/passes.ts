/**
 * Satellite pass prediction and orbital facts for the detail panel.
 */
import {
  degreesLat,
  degreesLong,
  degreesToRadians,
  ecfToLookAngles,
  eciToEcf,
  eciToGeodetic,
  gstime,
  propagate,
  type SatRec,
} from 'satellite.js';

export interface Observer {
  lat: number;
  lon: number;
}

export interface Pass {
  rise: number;
  set: number;
  maxTime: number;
  maxElevation: number;
  riseAzimuth: number;
  setAzimuth: number;
}

const RAD = 180 / Math.PI;

export function lookAt(rec: SatRec, obs: Observer, time: number): { az: number; el: number; range: number } | null {
  const date = new Date(time);
  const pv = propagate(rec, date);
  if (!pv || !Number.isFinite(pv.position.x)) return null;
  const look = ecfToLookAngles(
    { latitude: degreesToRadians(obs.lat), longitude: degreesToRadians(obs.lon), height: 0.1 },
    eciToEcf(pv.position, gstime(date)),
  );
  return { az: look.azimuth * RAD, el: look.elevation * RAD, range: look.rangeSat };
}

/** Find passes above `minElevation`° in the next `hours`, coarse-stepping then bisecting edges. */
export function predictPasses(rec: SatRec, obs: Observer, start: number, hours = 24, minElevation = 10): Pass[] {
  const step = 30_000;
  const end = start + hours * 3_600_000;
  const passes: Pass[] = [];
  const el = (t: number) => lookAt(rec, obs, t)?.el ?? -90;

  let prev = el(start);
  let riseT: number | null = prev > 0 ? start : null;
  let maxEl = prev;
  let maxT = start;

  for (let t = start + step; t <= end; t += step) {
    const cur = el(t);
    if (riseT === null && cur > 0 && prev <= 0) {
      riseT = bisect(el, t - step, t);
      maxEl = cur;
      maxT = t;
    }
    if (riseT !== null) {
      if (cur > maxEl) {
        maxEl = cur;
        maxT = t;
      }
      if (cur <= 0 && prev > 0) {
        const setT = bisect(el, t - step, t);
        if (maxEl >= minElevation) {
          passes.push({
            rise: riseT,
            set: setT,
            maxTime: maxT,
            maxElevation: maxEl,
            riseAzimuth: lookAt(rec, obs, riseT)?.az ?? 0,
            setAzimuth: lookAt(rec, obs, setT)?.az ?? 0,
          });
        }
        riseT = null;
        maxEl = -90;
      }
    }
    prev = cur;
    if (passes.length >= 6) break;
  }
  return passes;
}

/** Time where `f` crosses zero between lo (≤0) and hi (>0) or the reverse. */
function bisect(f: (t: number) => number, lo: number, hi: number): number {
  const rising = f(hi) > f(lo);
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0 === rising) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

export interface SatFacts {
  altitudeKm: number;
  speedKms: number;
  lat: number;
  lon: number;
  periodMin: number;
  inclinationDeg: number;
  epochAgeDays: number;
}

export function satFacts(rec: SatRec, time: number): SatFacts | null {
  const date = new Date(time);
  const pv = propagate(rec, date);
  if (!pv || !Number.isFinite(pv.position.x)) return null;
  const geo = eciToGeodetic(pv.position, gstime(date));
  const v = pv.velocity;
  const epochMs = (rec.jdsatepoch - 2440587.5) * 86_400_000;
  return {
    altitudeKm: geo.height,
    speedKms: Math.hypot(v.x, v.y, v.z),
    lat: degreesLat(geo.latitude),
    lon: degreesLong(geo.longitude),
    periodMin: (2 * Math.PI) / rec.no,
    inclinationDeg: rec.inclo * RAD,
    epochAgeDays: (time - epochMs) / 86_400_000,
  };
}

/** One orbit of ECI positions (km) starting at `time`, for drawing the orbit ring. */
export function orbitRing(rec: SatRec, time: number, samples = 180): [number, number, number][] {
  const periodMs = ((2 * Math.PI) / rec.no) * 60_000;
  const pts: [number, number, number][] = [];
  for (let i = 0; i <= samples; i++) {
    const pv = propagate(rec, new Date(time + (periodMs * i) / samples));
    if (!pv || !Number.isFinite(pv.position.x)) continue;
    pts.push([pv.position.x, pv.position.y, pv.position.z]);
  }
  return pts;
}
