/**
 * Report-ready text: "14:00 ET / 13:00 CT / 11:00 PT / 15:30 NT".
 */
import { zoneAbbr } from './abbr';
import { dayShift } from './convert';
import { offsetMinutes, pad2, zonedParts } from './tz';
import type { Place } from './types';

export interface ReportRow {
  abbr: string;
  time: string;
  offset: number;
  /** Calendar days ahead of (+) or behind (−) the NSOC. */
  dayShift: number;
  weekday: string;
  names: string[];
  isNsoc: boolean;
}

/**
 * One row per distinct clock (abbreviation + offset) at an instant. Order:
 * NSOC first, then westward, then zones east of the NSOC nearest-first,
 * the way a Canadian ops report reads (ET / CT / MT / PT / AT / NT).
 */
export function reportRows(utc: number, places: Pick<Place, 'name' | 'tz'>[], nsoc: Pick<Place, 'name' | 'tz'>): ReportRow[] {
  const rows = new Map<string, ReportRow>();
  const nsocOff = offsetMinutes(nsoc.tz, utc);
  const add = (p: Pick<Place, 'name' | 'tz'>, isNsoc: boolean) => {
    const off = offsetMinutes(p.tz, utc);
    const abbr = zoneAbbr(p.tz, utc);
    const key = `${abbr}|${off}`;
    let r = rows.get(key);
    if (!r) {
      const z = zonedParts(p.tz, utc);
      r = {
        abbr,
        time: `${pad2(z.hour)}:${pad2(z.minute)}`,
        offset: off,
        dayShift: dayShift(p.tz, nsoc.tz, utc),
        weekday: z.weekday,
        names: [],
        isNsoc: false,
      };
      rows.set(key, r);
    }
    if (!r.names.includes(p.name)) r.names.push(p.name);
    r.isNsoc ||= isNsoc;
  };
  add(nsoc, true);
  for (const p of places) add(p, false);
  // West of the NSOC sorts by distance west; east of it comes after, nearest first.
  const key = (off: number) => (off <= nsocOff ? nsocOff - off : 10_000 + (off - nsocOff));
  return [...rows.values()].sort((a, b) =>
    a.isNsoc ? -1 : b.isNsoc ? 1 : key(a.offset) - key(b.offset) || a.abbr.localeCompare(b.abbr),
  );
}

export function reportLine(rows: ReportRow[]): string {
  return rows.map((r) => `${r.time} ${r.abbr}${r.dayShift !== 0 ? ` (${r.weekday})` : ''}`).join(' / ');
}

export function reportBlock(title: string, utc: number, rows: ReportRow[], nsocTz: string): string {
  const z = zonedParts(nsocTz, utc);
  const u = new Date(utc);
  const width = Math.max(...rows.map((r) => r.abbr.length));
  const lines = rows.map(
    (r) =>
      `${r.time} ${r.abbr.padEnd(width)}${r.dayShift !== 0 ? ` ${r.weekday}` : ''}  ${r.names.join(', ')}`,
  );
  return [
    `${title} — ${z.weekday} ${z.dateKey}`,
    ...lines,
    `(${pad2(u.getUTCHours())}:${pad2(u.getUTCMinutes())} UTC)`,
  ].join('\n');
}
