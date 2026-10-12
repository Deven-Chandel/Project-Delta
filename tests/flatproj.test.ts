import { describe, expect, it } from 'vitest';
import { clampView, fitView, minZoom, project, unproject, wrapLon, zoomAt } from '../src/core/flatproj';

const vp = { w: 1000, h: 500 };

describe('flat map projection', () => {
  it('wraps longitudes', () => {
    expect(wrapLon(190)).toBe(-170);
    expect(wrapLon(-190)).toBe(170);
    expect(wrapLon(180)).toBe(-180);
  });

  it('round-trips screen ↔ lat/lon', () => {
    const v = { lon: -80, lat: 45, k: 10 };
    for (const [lat, lon] of [[43.65, -79.38], [49.28, -123.12], [47.56, -52.71]]) {
      const p = project(lat, lon, v, vp);
      const back = unproject(p.x, p.y, v, vp);
      expect(back.lat).toBeCloseTo(lat, 6);
      expect(back.lon).toBeCloseTo(lon, 6);
    }
  });

  it('draws points across the date line next to each other', () => {
    const v = { lon: 179, lat: 0, k: 10 };
    const fiji = project(-17.7, 178.1, v, vp);
    const samoa = project(-13.8, -172.1, v, vp);
    expect(samoa.x - fiji.x).toBeCloseTo((360 - 178.1 - 172.1) * 10, 3);
  });

  it('never zooms out past the world height, so there are no empty bands', () => {
    const v = clampView({ lon: 0, lat: 89, k: 0.1 }, vp);
    expect(v.k).toBe(minZoom(vp));
    expect(v.lat).toBe(0);
    const z = clampView({ lon: 0, lat: 89, k: 20 }, vp);
    expect(z.lat).toBeCloseTo(90 - vp.h / 2 / 20, 6);
  });

  it('keeps all of Canada visible on a portrait phone', () => {
    const phone = { w: 390, h: 700 };
    const pts = [{ lat: 48.4, lon: -123.4 }, { lat: 47.6, lon: -52.7 }, { lat: 63.7, lon: -68.5 }];
    const v = fitView(pts, phone);
    for (const p of pts) {
      const s = project(p.lat, p.lon, v, phone);
      expect(s.x).toBeGreaterThan(0);
      expect(s.x).toBeLessThan(phone.w);
      expect(s.y).toBeGreaterThan(0);
    }
  });

  it('zooms around the cursor', () => {
    const v = { lon: -80, lat: 45, k: 10 };
    const anchor = unproject(700, 300, v, vp);
    const z = zoomAt(v, vp, 700, 300, 2);
    const after = unproject(700, 300, z, vp);
    expect(z.k).toBe(20);
    expect(after.lat).toBeCloseTo(anchor.lat, 6);
    expect(after.lon).toBeCloseTo(anchor.lon, 6);
  });

  it('fits Canada, and a Pacific group the short way round', () => {
    const canada = fitView([{ lat: 48.4, lon: -123.4 }, { lat: 47.6, lon: -52.7 }, { lat: 63.7, lon: -68.5 }, { lat: 60.7, lon: -135.1 }], vp);
    expect(canada.lon).toBeCloseTo(-93.9, 0);
    const pacific = fitView([{ lat: -17.7, lon: 178.1 }, { lat: -13.8, lon: -172.1 }], vp);
    expect(Math.abs(pacific.lon)).toBeGreaterThan(170);
  });
});

describe('fitView centring', () => {
  it('centres a single site exactly', () => {
    const v = fitView([{ lat: 51.5, lon: -0.1 }], { w: 1000, h: 500 });
    expect(v.lon).toBeCloseTo(-0.1, 6);
  });
});
