/**
 * Tiny observable store over one plain state object, persisted to
 * localStorage (best-effort — private windows just start fresh) and kept in
 * sync across open tabs via the `storage` event.
 */
import { CANADA, CANADA_HOURS, GLOBAL_TEAM, sampleEvents } from '../data/presets';
import { cityIndex } from './cities';
import { distanceKm } from './geo';
import { migrate, uid, type AppState } from './migrate';
import type { Group, Place } from './types';
import { offsetMinutes, viewerTimeZone } from './tz';

export { uid, type AppState };

const KEY = 'timeboard3d.v2';
const LEGACY_KEY = 'timeboard3d.v1';
type Listener = (state: AppState, prev: AppState) => void;

export function makeGroup(name: string, places: Omit<Place, 'id'>[], shifts: Group['shifts'] = []): Group {
  return { id: uid('g'), name, places: places.map((p) => ({ ...p, id: uid('p') })), shifts };
}

/** Best guess for the NSOC from the browser's time zone: the biggest city in it. */
export function detectNsoc(tz = viewerTimeZone()): Place {
  const match = cityIndex().find((c) => c.tz === tz);
  if (match) return { id: 'nsoc', name: match.name, region: match.regionCode, lat: match.lat, lon: match.lon, tz };
  // No indexed city in this zone: keep the viewer's zone, place the pin on its meridian.
  const name = tz.split('/').pop()?.replace(/_/g, ' ') || 'NSOC';
  return { id: 'nsoc', name, region: '', lat: 20, lon: Math.max(-180, Math.min(180, offsetMinutes(tz, Date.now()) / 4)), tz };
}

export function defaults(now = Date.now()): AppState {
  const canada = makeGroup('Canada — all sites', CANADA, CANADA_HOURS);
  const global = makeGroup('Global team (sample)', GLOBAL_TEAM, [{ start: 9 * 60, end: 17 * 60 }]);
  const nsoc = detectNsoc();
  return {
    version: 2,
    groups: [canada, global],
    activeGroupId: canada.id,
    nsoc,
    nsocConfirmed: false,
    theme: 'dark',
    events: sampleEvents(nsoc.tz, now, canada.id),
    axis: 'rolling',
  };
}

function read(): AppState {
  const fresh = defaults();
  try {
    const raw = localStorage.getItem(KEY) ?? localStorage.getItem(LEGACY_KEY);
    return raw ? migrate(JSON.parse(raw), fresh) : fresh;
  } catch {
    return fresh;
  }
}

class Store {
  private state: AppState = read();
  private listeners = new Set<Listener>();

  constructor() {
    try {
      window.addEventListener('storage', (e: StorageEvent) => {
        if (e.key !== KEY || !e.newValue) return;
        const prev = this.state;
        try {
          this.state = migrate(JSON.parse(e.newValue), prev);
        } catch {
          return;
        }
        for (const l of this.listeners) l(this.state, prev);
      });
    } catch {
      /* no window (tests) */
    }
  }

  get(): AppState {
    return this.state;
  }

  update(fn: (draft: AppState) => void): void {
    const prev = this.state;
    const next = structuredClone(prev);
    fn(next);
    this.state = next;
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable — keep working in memory */
    }
    for (const l of this.listeners) l(next, prev);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  activeGroup(): Group {
    return this.state.groups.find((g) => g.id === this.state.activeGroupId) ?? this.state.groups[0];
  }

  /** Every place across groups, de-duplicated by proximity (for the NSOC picker). */
  allPlaces(): Place[] {
    const out: Place[] = [];
    for (const g of this.state.groups) {
      for (const p of g.places) {
        if (!out.some((o) => o.tz === p.tz && distanceKm(o.lat, o.lon, p.lat, p.lon) < 5)) out.push(p);
      }
    }
    return out;
  }
}

export const store = new Store();
