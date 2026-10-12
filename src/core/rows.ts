/**
 * The board's row model: one row per clock (places sharing a UTC offset at
 * the instant shown), each with its colour slot and staffing state. Shared by
 * the timeline, its tooltip, the map and the converter so they always agree.
 */
import { zoneAbbr } from './abbr';
import { assignSlots, familyKey } from './palette';
import { coverageAt, shiftsFor, type CoverageState } from './shifts';
import { groupByOffset, offsetMinutes } from './tz';
import type { Group, Place } from './types';

export interface SiteState {
  place: Place;
  coverage: CoverageState;
}

export interface BoardRow {
  /** UTC offset in minutes at the instant — the row's identity. */
  key: number;
  tz: string;
  abbr: string;
  slot: number | null;
  sites: SiteState[];
  isNsoc: boolean;
  /** Δ vs NSOC in minutes. */
  delta: number;
}

export type RowCoverage = 'all' | 'some' | 'none' | 'unset';

export function rowCoverage(row: BoardRow): { state: RowCoverage; on: number; total: number } {
  const set = row.sites.filter((s) => s.coverage.state !== 'none');
  const on = set.filter((s) => s.coverage.state === 'on' || s.coverage.state === 'ending').length;
  if (set.length === 0) return { state: 'unset', on: 0, total: 0 };
  return { state: on === set.length ? 'all' : on === 0 ? 'none' : 'some', on, total: set.length };
}

export function buildRows(group: Group, nsoc: Place, t: number): BoardRow[] {
  const slots = assignSlots([nsoc.tz, ...group.places.map((p) => p.tz)]);
  const nsocOff = offsetMinutes(nsoc.tz, t);
  const rows: BoardRow[] = groupByOffset(group.places, t).map((g) => ({
    key: g.offset,
    tz: g.tz,
    abbr: zoneAbbr(g.tz, t),
    slot: slots.get(familyKey(g.places[0].tz)) ?? null,
    sites: g.places.map((place) => ({ place, coverage: coverageAt(place.tz, shiftsFor(place, group), t) })),
    isNsoc: g.offset === nsocOff,
    delta: g.offset - nsocOff,
  }));
  if (!rows.some((r) => r.isNsoc)) {
    rows.push({
      key: nsocOff,
      tz: nsoc.tz,
      abbr: zoneAbbr(nsoc.tz, t),
      slot: slots.get(familyKey(nsoc.tz)) ?? null,
      sites: [],
      isNsoc: true,
      delta: 0,
    });
  }
  // NSOC pinned first, then west → east.
  return rows.sort((a, b) => (a.isNsoc ? -1 : b.isNsoc ? 1 : a.key - b.key));
}
