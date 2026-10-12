/**
 * Geographic helpers. The globe uses an Earth-fixed frame that matches
 * three.js SphereGeometry's UV layout, so an equirectangular texture lines up:
 *   +X → (0°, 0°)   +Y → North Pole   −Z → (0°, 90°E)
 */
const DEG = Math.PI / 180;
export const EARTH_RADIUS_KM = 6371;

export type Vec3 = [number, number, number];

export function latLonToVec3(lat: number, lon: number, radius = 1): Vec3 {
  const phi = lat * DEG;
  const lambda = lon * DEG;
  return [
    radius * Math.cos(phi) * Math.cos(lambda),
    radius * Math.sin(phi),
    -radius * Math.cos(phi) * Math.sin(lambda),
  ];
}

export function vec3ToLatLon([x, y, z]: Vec3): { lat: number; lon: number } {
  const r = Math.hypot(x, y, z);
  return { lat: Math.asin(y / r) / DEG, lon: Math.atan2(-z, x) / DEG };
}

/** Great-circle distance in kilometres. */
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * DEG;
  const dLon = (lon2 - lon1) * DEG;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Points along the great circle between two places, lifted off the surface
 * in an arc whose height scales with distance.
 */
export function arcPoints(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
  segments = 64,
): Vec3[] {
  const va = latLonToVec3(a.lat, a.lon);
  const vb = latLonToVec3(b.lat, b.lon);
  const dot = Math.min(1, Math.max(-1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]));
  const omega = Math.acos(dot);
  const lift = 0.04 + omega * 0.18;
  const pts: Vec3[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    let v: Vec3;
    if (omega < 1e-6) {
      v = va;
    } else {
      const s = Math.sin(omega);
      const k1 = Math.sin((1 - t) * omega) / s;
      const k2 = Math.sin(t * omega) / s;
      v = [k1 * va[0] + k2 * vb[0], k1 * va[1] + k2 * vb[1], k1 * va[2] + k2 * vb[2]];
    }
    const h = 1.004 + lift * Math.sin(Math.PI * t);
    const len = Math.hypot(...v);
    pts.push([(v[0] / len) * h, (v[1] / len) * h, (v[2] / len) * h]);
  }
  return pts;
}
