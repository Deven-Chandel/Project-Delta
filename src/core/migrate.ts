/**
 * Turns whatever is in localStorage (v2, the earlier v1 "Time Board 3D"
 * shape, or garbage) into a valid v2 state. Pure, so it is unit-tested.
 */
import { cleanEvent, cleanPlace, cleanShifts } from './validate';
import type { Group, Place, TBEvent, Theme } from './types';
import type { AxisMode } from './timeline';

export interface AppState {
  version: 2;
  groups: Group[];
  activeGroupId: string;
  /** The NSOC: the reference clock every Δ is measured from. */
  nsoc: Place;
  /** False until the controller confirms where the NSOC is. */
  nsocConfirmed: boolean;
  theme: Theme;
  events: TBEvent[];
  axis: AxisMode;
}

let seq = 0;
export function uid(prefix = 'id'): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function cleanGroup(raw: unknown): Group | null {
  const g = raw as Partial<Group>;
  if (!g || typeof g.name !== 'string' || !Array.isArray(g.places)) return null;
  return {
    id: typeof g.id === 'string' && g.id ? g.id : uid('g'),
    name: g.name.slice(0, 80) || 'Group',
    places: g.places.map((p) => cleanPlace(p, uid('p'))).filter((p): p is Place => p !== null),
    shifts: cleanShifts(g.shifts),
  };
}

/**
 * @param raw     parsed JSON from storage (v2 or v1), or null
 * @param fallback a fresh default state, used for anything missing or invalid
 */
export function migrate(raw: unknown, fallback: AppState): AppState {
  if (!raw || typeof raw !== 'object') return fallback;
  const r = raw as Record<string, unknown>;
  const groups = Array.isArray(r.groups) ? r.groups.map(cleanGroup).filter((g): g is Group => g !== null) : [];
  if (groups.length === 0) return fallback;

  // v1 called the reference clock "home"; v2 calls it the NSOC.
  const nsocRaw = r.version === 2 ? r.nsoc : r.home;
  const nsoc = cleanPlace(nsocRaw, 'nsoc') ?? fallback.nsoc;
  const nsocConfirmed = r.version === 2 ? r.nsocConfirmed === true : r.homeAuto === false;

  const events = Array.isArray(r.events)
    ? r.events.map((e) => cleanEvent(e, uid('e'))).filter((e): e is TBEvent => e !== null)
    : r.version === 2
      ? []
      : fallback.events;

  const activeGroupId =
    typeof r.activeGroupId === 'string' && groups.some((g) => g.id === r.activeGroupId) ? r.activeGroupId : groups[0].id;

  return {
    version: 2,
    groups,
    activeGroupId,
    nsoc: { ...nsoc, id: 'nsoc' },
    nsocConfirmed,
    theme: r.theme === 'cream' ? 'cream' : 'dark',
    events,
    axis: r.axis === 'day' ? 'day' : 'rolling',
  };
}
