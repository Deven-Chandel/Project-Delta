/**
 * Tiny observable store. The whole app state is one plain object; components
 * subscribe and re-render the parts they own. Persisted to localStorage
 * (best-effort — private windows and blocked storage just start fresh).
 */
import { CANADA, GLOBAL_TEAM } from '../data/presets';
import { distanceKm } from './geo';
import { cityIndex } from './cities';
import type { Group, Mode, Place, Theme } from './types';
import { viewerTimeZone } from './tz';

export interface AppState {
  groups: Group[];
  activeGroupId: string;
  /** The reference "Your site" clock every Δ is measured against. */
  home: Place;
  /** True while `home` is still the auto-detected guess. */
  homeAuto: boolean;
  theme: Theme;
  mode: Mode;
  workStart: number;
  workEnd: number;
  datasets: string[];
}

const STORAGE_KEY = 'timeboard3d.v1';
type Listener = (state: AppState, prev: AppState) => void;

let seq = 0;
export function uid(prefix = 'id'): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function makeGroup(name: string, places: Omit<Place, 'id'>[]): Group {
  return { id: uid('g'), name, places: places.map((p) => ({ ...p, id: uid('p') })) };
}

/** Guess "Your site" from the browser's time zone: the biggest city in that zone. */
export function detectHome(tz = viewerTimeZone()): Place {
  const match = cityIndex().find((c) => c.tz === tz);
  if (match) {
    return { id: 'home', name: match.name, region: match.regionCode, lat: match.lat, lon: match.lon, tz };
  }
  const name = tz.split('/').pop()?.replace(/_/g, ' ') || 'Your site';
  return { id: 'home', name, region: '', lat: 43.653, lon: -79.383, tz };
}

function defaults(): AppState {
  const canada = makeGroup('Canada Coast to Coast', CANADA);
  const global = makeGroup('Global Team', GLOBAL_TEAM);
  return {
    groups: [canada, global],
    activeGroupId: canada.id,
    home: detectHome(),
    homeAuto: true,
    theme: 'dark',
    mode: 'board',
    workStart: 9,
    workEnd: 17,
    datasets: ['stations', 'starlink', 'gps-ops', 'geo', 'weather', 'science'],
  };
}

function load(): AppState {
  const base = defaults();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const saved = JSON.parse(raw) as Partial<AppState>;
    const state: AppState = { ...base, ...saved };
    if (!Array.isArray(state.groups) || state.groups.length === 0) state.groups = base.groups;
    if (!state.groups.some((g) => g.id === state.activeGroupId)) state.activeGroupId = state.groups[0].id;
    // A visitor who never pinned a site gets a fresh guess (they may have travelled).
    if (state.homeAuto !== false) state.home = base.home;
    return state;
  } catch {
    return base;
  }
}

class Store {
  private state: AppState = load();
  private listeners = new Set<Listener>();

  get(): AppState {
    return this.state;
  }

  update(fn: (draft: AppState) => void): void {
    const prev = this.state;
    const next = structuredClone(prev);
    fn(next);
    this.state = next;
    this.persist();
    for (const l of this.listeners) l(next, prev);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  activeGroup(): Group {
    return this.state.groups.find((g) => g.id === this.state.activeGroupId) ?? this.state.groups[0];
  }

  /** Every place across groups, de-duplicated by proximity (for pickers). */
  allPlaces(): Place[] {
    const out: Place[] = [];
    for (const g of this.state.groups) {
      for (const p of g.places) {
        if (!out.some((o) => o.tz === p.tz && distanceKm(o.lat, o.lon, p.lat, p.lon) < 5)) out.push(p);
      }
    }
    return out;
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      /* storage unavailable — keep working in memory */
    }
  }
}

export const store = new Store();
