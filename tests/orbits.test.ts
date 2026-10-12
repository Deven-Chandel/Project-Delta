import { twoline2satrec } from 'satellite.js';
import { describe, expect, it } from 'vitest';
import { lookAt, orbitRing, predictPasses, satFacts } from '../src/orbits/passes';
import { checksumOk, parseTle } from '../src/orbits/tle';

// The classic ISS example element set (epoch 2008-09-20 12:25:40 UTC).
const ISS = `ISS (ZARYA)
1 25544U 98067A   08264.51782528 -.00002182  00000-0 -11606-4 0  2927
2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.72125391563537`;
const EPOCH = Date.UTC(2008, 8, 20, 12, 25, 40);

describe('TLE parsing', () => {
  it('validates the modulo-10 checksum', () => {
    const [, l1, l2] = ISS.split('\n');
    expect(checksumOk(l1)).toBe(true);
    expect(checksumOk(l2)).toBe(true);
    expect(checksumOk(l1.slice(0, 68) + '0')).toBe(false);
  });

  it('parses three-line and two-line sets and skips corrupt ones', () => {
    const [, l1, l2] = ISS.split('\n');
    const corrupt = l1.slice(0, 68) + '1';
    const tles = parseTle(`${ISS}\r\n\n${l1}\n${l2}\nBROKEN\n${corrupt}\n${l2}\n`);
    expect(tles).toHaveLength(2);
    expect(tles[0]).toMatchObject({ name: 'ISS (ZARYA)', norad: 25544 });
    expect(tles[1].name).toBe('NORAD 25544');
  });
});

describe('orbital mechanics', () => {
  const [, l1, l2] = ISS.split('\n');
  const rec = twoline2satrec(l1, l2);

  it('derives sensible facts for the ISS', () => {
    const f = satFacts(rec, EPOCH)!;
    expect(f.altitudeKm).toBeGreaterThan(330);
    expect(f.altitudeKm).toBeLessThan(380);
    expect(f.speedKms).toBeCloseTo(7.7, 1);
    expect(f.periodMin).toBeCloseTo(91.6, 0);
    expect(f.inclinationDeg).toBeCloseTo(51.64, 1);
    expect(f.epochAgeDays).toBeCloseTo(0, 3);
  });

  it('draws a closed orbit ring', () => {
    const ring = orbitRing(rec, EPOCH, 90);
    expect(ring.length).toBe(91);
    const [a, b] = [ring[0], ring[ring.length - 1]];
    expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeLessThan(150);
  });

  it('predicts passes whose peak really is above the horizon', () => {
    const toronto = { lat: 43.65, lon: -79.38 };
    const passes = predictPasses(rec, toronto, EPOCH, 24, 10);
    expect(passes.length).toBeGreaterThan(0);
    for (const p of passes) {
      expect(p.set).toBeGreaterThan(p.rise);
      expect(p.set - p.rise).toBeLessThan(15 * 60_000);
      expect(p.maxElevation).toBeGreaterThanOrEqual(10);
      expect(lookAt(rec, toronto, p.maxTime)!.el).toBeCloseTo(p.maxElevation, 5);
      expect(Math.abs(lookAt(rec, toronto, p.rise)!.el)).toBeLessThan(0.5);
    }
  });
});
