/**
 * Per-viewer layout conveniences (map type, panel sizes). Best-effort
 * localStorage: a private window just starts with the defaults.
 */
export interface Prefs {
  mapType?: 'globe' | 'flat';
  /** Side column width in px (desktop). */
  sideW?: number;
  /** Map height in px within the side column (desktop). */
  mapH?: number;
  expanded?: boolean;
}

const KEY = 'timeboard.layout';

export function readPrefs(): Prefs {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Prefs;
  } catch {
    return {};
  }
}

export function writePrefs(patch: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...readPrefs(), ...patch }));
  } catch {
    /* storage unavailable */
  }
}
