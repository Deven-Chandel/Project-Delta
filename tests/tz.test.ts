import { describe, expect, it } from 'vitest';
import { CANADA } from '../src/data/presets';
import {
  formatDelta,
  formatOffset,
  groupByOffset,
  offsetMinutes,
  relativeDay,
  zonedParts,
  zonedToUtc,
} from '../src/core/tz';

const JULY = Date.UTC(2024, 6, 10, 16, 0);
const JANUARY = Date.UTC(2024, 0, 10, 16, 0);

describe('offsetMinutes', () => {
  it('follows DST from the platform tz database', () => {
    expect(offsetMinutes('America/Toronto', JULY)).toBe(-240);
    expect(offsetMinutes('America/Toronto', JANUARY)).toBe(-300);
  });
  it('handles half-hour zones and zones without DST', () => {
    expect(offsetMinutes('America/St_Johns', JULY)).toBe(-150);
    expect(offsetMinutes('Asia/Kolkata', JULY)).toBe(330);
    expect(offsetMinutes('America/Regina', JULY)).toBe(-360);
    expect(offsetMinutes('America/Regina', JANUARY)).toBe(-360);
  });
});

describe('formatting', () => {
  it('formats offsets and deltas like the original board', () => {
    expect(formatOffset(-150)).toBe('UTC−2:30');
    expect(formatOffset(330)).toBe('UTC+5:30');
    expect(formatOffset(0)).toBe('UTC+0');
    expect(formatDelta(0)).toBe('same time');
    expect(formatDelta(90)).toBe('+1h30m');
    expect(formatDelta(-180)).toBe('−3h');
  });

  it('reports the relative day against the reference zone', () => {
    // 02:00 UTC: still yesterday in Toronto, already today in Tokyo.
    const t = Date.UTC(2024, 6, 10, 2, 0);
    expect(relativeDay('Asia/Tokyo', 'America/Toronto', t)).toBe('Tomorrow');
    expect(relativeDay('America/Toronto', 'Asia/Tokyo', t)).toBe('Yesterday');
    expect(relativeDay('America/Toronto', 'America/New_York', t)).toBe('Today');
  });
});

describe('zonedToUtc', () => {
  it('round-trips wall-clock time on both sides of a DST change', () => {
    // DST began 2024-03-10 at 02:00 in Toronto.
    expect(zonedToUtc('America/Toronto', 2024, 3, 10, 1, 0)).toBe(Date.UTC(2024, 2, 10, 6, 0));
    expect(zonedToUtc('America/Toronto', 2024, 3, 10, 12, 0)).toBe(Date.UTC(2024, 2, 10, 16, 0));
    const p = zonedParts('Asia/Kolkata', zonedToUtc('Asia/Kolkata', 2024, 7, 1, 9, 30));
    expect([p.hour, p.minute, p.day]).toEqual([9, 30, 1]);
  });
});

describe('groupByOffset (the v1 card logic)', () => {
  const offsets = (t: number) =>
    groupByOffset(CANADA, t).map((g) => [g.offset, g.places.map((p) => p.name).sort()] as const);

  it('clusters Canadian places into six summer clock times', () => {
    const groups = offsets(JULY);
    expect(groups.map(([o]) => o)).toEqual([-420, -360, -300, -240, -180, -150]);
    const pacific = groups.find(([o]) => o === -420)![1];
    // Yukon stays on UTC−7 all year, so in summer it shares a card with BC.
    expect(pacific).toContain('Whitehorse');
    expect(pacific).toContain('Vancouver');
  });

  it('regroups in winter when DST ends but Saskatchewan and Yukon don’t change', () => {
    const groups = offsets(JANUARY);
    const at = (o: number) => groups.find(([x]) => x === o)?.[1] ?? [];
    expect(at(-480)).toContain('Vancouver');
    expect(at(-420)).toEqual(expect.arrayContaining(['Whitehorse', 'Calgary', 'Edmonton']));
    expect(at(-360)).toEqual(expect.arrayContaining(['Regina', 'Saskatoon', 'Winnipeg']));
    expect(at(-210)).toEqual(["Corner Brook", "St. John's"]);
  });
});
