/**
 * A staffed / on-air window in a site's local wall-clock time, in minutes
 * from midnight (0–1439). `end <= start` wraps past midnight (22:00–06:00);
 * `start === end` means staffed around the clock.
 */
export interface ShiftWindow {
  start: number;
  end: number;
}

export interface Place {
  id: string;
  name: string;
  /** Province / state / country code shown on the chip, e.g. "ON". */
  region: string;
  lat: number;
  lon: number;
  tz: string;
  /** Overrides the group's hours for this site; undefined = inherit. */
  shifts?: ShiftWindow[];
}

export interface Group {
  id: string;
  name: string;
  places: Place[];
  /** Default staffed hours for every site in the group (local to each site). */
  shifts: ShiftWindow[];
}

export type EventKind = 'broadcast' | 'maintenance' | 'shift' | 'other';

/**
 * A scheduled event. Its source of truth is wall-clock time in a zone, so a
 * daily 07:00 shift change stays at 07:00 local across DST.
 */
export interface TBEvent {
  id: string;
  title: string;
  kind: EventKind;
  /** Local wall time, "YYYY-MM-DDTHH:mm". */
  local: string;
  tz: string;
  /** Where the time was entered, e.g. "NSOC · Toronto". */
  sourceLabel: string;
  durationMin: number;
  repeat: 'none' | 'daily';
  /** Group the event concerns; null = whichever group is active. */
  groupId: string | null;
}

export type Theme = 'dark' | 'cream';
