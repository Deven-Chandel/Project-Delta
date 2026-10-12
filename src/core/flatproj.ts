/**
 * Equirectangular projection for the flat map, with horizontal wrap-around.
 * Pure maths, so pan / zoom / fit behaviour is unit-tested.
 */
export interface FlatView {
  /** Longitude at the centre of the viewport, −180..180. */
  lon: number;
  /** Latitude at the centre of the viewport. */
  lat: number;
  /** Pixels per degree. */
  k: number;
}

export interface Viewport {
  w: number;
  h: number;
}

export function wrapLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/** Smallest zoom where the world still fills the viewport height (no empty bands). */
export function minZoom(vp: Viewport): number {
  return vp.h / 180;
}

/** ~2.6× the NASA textures' native 11.4 px/° — still crisp enough to read a region. */
export const MAX_ZOOM = 30;

/** Keep the poles at the edges (no empty bands); longitude wraps freely. */
export function clampView(v: FlatView, vp: Viewport): FlatView {
  const k = Math.min(MAX_ZOOM, Math.max(minZoom(vp), v.k));
  const halfLat = vp.h / 2 / k;
  const lat = Math.min(90 - halfLat, Math.max(-90 + halfLat, v.lat));
  return { lon: wrapLon(v.lon), lat, k };
}

/**
 * Screen position of a lat/lon. Longitude is unwrapped to the copy nearest
 * the view centre, so pins near the date line still draw next to each other.
 */
export function project(lat: number, lon: number, v: FlatView, vp: Viewport): { x: number; y: number } {
  const dLon = wrapLon(lon - v.lon);
  return { x: vp.w / 2 + dLon * v.k, y: vp.h / 2 - (lat - v.lat) * v.k };
}

export function unproject(x: number, y: number, v: FlatView, vp: Viewport): { lat: number; lon: number } {
  return {
    lat: Math.max(-90, Math.min(90, v.lat + (vp.h / 2 - y) / v.k)),
    lon: wrapLon(v.lon + (x - vp.w / 2) / v.k),
  };
}

/** Zoom by `factor` keeping the point under (x, y) fixed. */
export function zoomAt(v: FlatView, vp: Viewport, x: number, y: number, factor: number): FlatView {
  const before = unproject(x, y, v, vp);
  const k = Math.min(MAX_ZOOM, Math.max(minZoom(vp), v.k * factor));
  const next = { ...v, k };
  const after = unproject(x, y, next, vp);
  return clampView({ lon: v.lon + wrapLon(before.lon - after.lon), lat: v.lat + (before.lat - after.lat), k }, vp);
}

/**
 * View that frames a set of places with padding. Picks the longitude centre
 * that minimises the span, so a Pacific group doesn't fit "the long way round".
 */
export function fitView(points: { lat: number; lon: number }[], vp: Viewport, pad = 48): FlatView {
  if (points.length === 0) return clampView({ lon: 0, lat: 20, k: minZoom(vp) }, vp);
  const lats = points.map((p) => p.lat);
  // Largest empty gap between sorted longitudes → the span is everything else.
  const lons = points.map((p) => wrapLon(p.lon)).sort((a, b) => a - b);
  let gap = 360 - (lons[lons.length - 1] - lons[0]);
  let start = lons[0];
  for (let i = 1; i < lons.length; i++) {
    const g = lons[i] - lons[i - 1];
    if (g > gap) {
      gap = g;
      start = lons[i];
    }
  }
  const realSpan = 360 - gap;
  const latMin = Math.min(...lats);
  const latMax = Math.max(...lats);
  // A minimum span keeps a single site from zooming in absurdly; centre on the real midpoint.
  const k = Math.min((vp.w - pad * 2) / Math.max(4, realSpan), (vp.h - pad * 2) / Math.max(4, latMax - latMin), 40);
  return clampView({ lon: wrapLon(start + realSpan / 2), lat: (latMin + latMax) / 2, k }, vp);
}
