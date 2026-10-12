/**
 * Time zone helpers built entirely on the browser's Intl API and IANA zone
 * names, so DST rules always come from the platform's tz database and never
 * from hand-maintained offset tables.
 */
export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: string;
  /** YYYY-MM-DD in the zone, handy for day comparisons. */
  dateKey: string;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(key: string, make: () => Intl.DateTimeFormat): Intl.DateTimeFormat {
  let f = formatterCache.get(key);
  if (!f) {
    f = make();
    formatterCache.set(key, f);
  }
  return f;
}

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((p) => p.type === type)?.value ?? '';
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function viewerTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

/** UTC offset of a zone at an instant, in minutes (e.g. Toronto in summer → −240). */
export function offsetMinutes(tz: string, time: number): number {
  const f = formatter(`off|${tz}`, () =>
    new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }),
  );
  const raw = part(f.formatToParts(time), 'timeZoneName');
  const m = raw.match(/GMT([+-])(\d{1,2}):?(\d{2})?/);
  if (!m) return 0;
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (parseInt(m[2], 10) * 60 + (m[3] ? parseInt(m[3], 10) : 0));
}

export function zonedParts(tz: string, time: number): ZonedParts {
  const f = formatter(`parts|${tz}`, () =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    }),
  );
  const parts = f.formatToParts(time);
  const year = parseInt(part(parts, 'year'), 10);
  const month = parseInt(part(parts, 'month'), 10);
  const day = parseInt(part(parts, 'day'), 10);
  return {
    year,
    month,
    day,
    hour: parseInt(part(parts, 'hour'), 10) % 24,
    minute: parseInt(part(parts, 'minute'), 10),
    second: parseInt(part(parts, 'second'), 10),
    weekday: part(parts, 'weekday').replace('.', ''),
    dateKey: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  };
}

/** Short zone abbreviation such as "EDT", or "" when the platform only knows "GMT+x". */
export function tzAbbr(tz: string, time: number): string {
  for (const locale of ['en-CA', 'en-US', 'en-GB', 'en-AU', 'en-IN']) {
    const f = formatter(`abbr|${locale}|${tz}`, () =>
      new Intl.DateTimeFormat(locale, { timeZone: tz, timeZoneName: 'short' }),
    );
    const abbr = part(f.formatToParts(time), 'timeZoneName');
    if (abbr && !/^(GMT|UTC)[+-]/.test(abbr)) return abbr;
  }
  return '';
}

/** Long zone name such as "Eastern Daylight Time". */
export function tzLongName(tz: string, time: number): string {
  const f = formatter(`long|${tz}`, () =>
    new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'long' }),
  );
  return part(f.formatToParts(time), 'timeZoneName');
}

/** "EDT — Eastern Daylight Time", falling back gracefully when there is no abbreviation. */
export function tzLabel(tz: string, time: number): string {
  const abbr = tzAbbr(tz, time);
  const long = tzLongName(tz, time);
  if (abbr && long && !long.startsWith('GMT')) return `${abbr} — ${long}`;
  return long || abbr || tz;
}

export function formatOffset(mins: number): string {
  const sign = mins < 0 ? '−' : '+';
  const abs = Math.abs(mins);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `UTC${sign}${h}${m ? ':' + String(m).padStart(2, '0') : ''}`;
}

/** Difference vs the reference site: "+3h", "−1h30m", or "same time". */
export function formatDelta(mins: number): string {
  if (mins === 0) return 'same time';
  const sign = mins > 0 ? '+' : '−';
  const abs = Math.abs(mins);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${h}h${m ? m + 'm' : ''}`;
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** "Today", "Tomorrow" or "Yesterday" relative to a reference zone's date. */
export function relativeDay(tz: string, refTz: string, time: number): string {
  const a = zonedParts(tz, time).dateKey;
  const b = zonedParts(refTz, time).dateKey;
  if (a === b) return 'Today';
  return a > b ? 'Tomorrow' : 'Yesterday';
}

/** Convert a wall-clock time in a zone to a UTC instant (DST-aware). */
export function zonedToUtc(
  tz: string,
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = guess - offsetMinutes(tz, guess) * 60_000;
  const second = guess - offsetMinutes(tz, first) * 60_000;
  return second;
}

export interface OffsetGroup<T> {
  offset: number;
  tz: string;
  places: T[];
}

/**
 * Cluster places that currently share a clock time into one card — the core
 * idea of the original Canada Time Board.
 */
export function groupByOffset<T extends { tz: string }>(places: T[], time: number): OffsetGroup<T>[] {
  const map = new Map<number, OffsetGroup<T>>();
  for (const p of places) {
    const off = offsetMinutes(p.tz, time);
    let g = map.get(off);
    if (!g) {
      g = { offset: off, tz: p.tz, places: [] };
      map.set(off, g);
    }
    g.places.push(p);
  }
  return [...map.values()].sort((a, b) => a.offset - b.offset);
}

export type Interval = [number, number];
