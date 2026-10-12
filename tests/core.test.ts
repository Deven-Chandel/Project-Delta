import { describe, expect, it } from 'vitest';
import { SimClock } from '../src/core/clock';
import { distanceKm, latLonToVec3, vec3ToLatLon } from '../src/core/geo';
import { decodeGroup, encodeGroup } from '../src/core/share';
import { dayPhase, subsolarPoint, sunElevation } from '../src/core/sun';

describe('SimClock', () => {
  it('runs, scales, pauses and resets against an injected real clock', () => {
    let real = 1_000_000;
    const c = new SimClock(() => real);
    expect(c.live).toBe(true);
    real += 1000;
    expect(c.now()).toBe(1_001_000);

    c.setRate(100);
    real += 1000;
    expect(c.now()).toBe(1_101_000);
    expect(c.live).toBe(false);

    c.setPaused(true);
    real += 5000;
    expect(c.now()).toBe(1_101_000);

    c.shift(-60_000);
    expect(c.now()).toBe(1_041_000);

    c.reset();
    expect(c.now()).toBe(real);
    expect(c.live).toBe(true);
  });

  it('notifies subscribers on discrete changes', () => {
    const c = new SimClock(() => 0);
    let n = 0;
    const off = c.subscribe(() => n++);
    c.setRate(10);
    c.set(5);
    off();
    c.reset();
    expect(n).toBe(2);
  });
});

describe('sun position', () => {
  it('puts the sun over the Tropic of Cancer at the June solstice', () => {
    expect(subsolarPoint(Date.UTC(2024, 5, 20, 20, 51)).lat).toBeCloseTo(23.44, 1);
  });
  it('puts the sun over the equator at the March equinox', () => {
    expect(Math.abs(subsolarPoint(Date.UTC(2024, 2, 20, 3, 6)).lat)).toBeLessThan(0.05);
  });
  it('puts the sun near Greenwich at noon UTC when the equation of time is ~0', () => {
    expect(Math.abs(subsolarPoint(Date.UTC(2024, 5, 13, 12, 0)).lon)).toBeLessThan(1);
  });
  it('knows day from night', () => {
    // Toronto, summer: 13:00 local is day, 01:00 local is night.
    expect(dayPhase(sunElevation(43.65, -79.38, Date.UTC(2024, 6, 10, 17)))).toBe('day');
    expect(dayPhase(sunElevation(43.65, -79.38, Date.UTC(2024, 6, 10, 5)))).toBe('night');
  });
});

describe('geo', () => {
  it('round-trips lat/lon through the globe frame', () => {
    for (const [lat, lon] of [
      [43.65, -79.38],
      [-33.87, 151.21],
      [0, 0],
      [63.75, -68.52],
    ]) {
      const back = vec3ToLatLon(latLonToVec3(lat, lon));
      expect(back.lat).toBeCloseTo(lat, 6);
      expect(back.lon).toBeCloseTo(lon, 6);
    }
  });
  it('measures great-circle distance', () => {
    // Toronto → Vancouver is about 3,360 km.
    expect(distanceKm(43.653, -79.383, 49.283, -123.121)).toBeGreaterThan(3300);
    expect(distanceKm(43.653, -79.383, 49.283, -123.121)).toBeLessThan(3400);
  });
});

describe('share links', () => {
  const group = {
    id: 'g1',
    name: 'Bureaus — São Paulo & Montréal',
    places: [
      { id: 'a', name: 'São Paulo', region: 'BR', lat: -23.5505, lon: -46.6333, tz: 'America/Sao_Paulo' },
      { id: 'b', name: 'Montréal', region: 'QC', lat: 45.5017, lon: -73.5673, tz: 'America/Toronto' },
    ],
  };

  it('round-trips a group with non-ASCII names', () => {
    const token = encodeGroup(group);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    const back = decodeGroup(token)!;
    expect(back.name).toBe(group.name);
    expect(back.places.map((p) => p.name)).toEqual(['São Paulo', 'Montréal']);
    expect(Math.abs(back.places[0].lat - group.places[0].lat)).toBeLessThan(0.001);
  });

  it('rejects garbage and drops invalid places', () => {
    expect(decodeGroup('not-a-token!!')).toBeNull();
    const evil = btoa(JSON.stringify({ v: 1, n: 'x', s: [['Bad', '', 999, 0, 'UTC'], ['Ok', '', 1, 2, 'Nowhere/Fake'], ['Good', '', 1, 2, 'UTC']] }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(decodeGroup(evil)!.places.map((p) => p.name)).toEqual(['Good']);
  });
});
