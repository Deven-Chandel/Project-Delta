/**
 * JSON backup files: everything a controller set up, portable between
 * browsers and colleagues.
 */
import { migrate, uid, type AppState } from './migrate';

export interface Backup {
  app: 'project-delta';
  schema: 2;
  exportedAt: string;
  state: Pick<AppState, 'nsoc' | 'groups' | 'events'>;
}

export function exportState(s: AppState): string {
  const b: Backup = {
    app: 'project-delta',
    schema: 2,
    exportedAt: new Date().toISOString(),
    state: { nsoc: s.nsoc, groups: s.groups, events: s.events },
  };
  return JSON.stringify(b, null, 2);
}

/**
 * Validate a backup and merge it into the current state: groups and events
 * are added, never silently overwritten (ids that already exist get new ids).
 */
export function mergeBackup(text: string, current: AppState): { state: AppState; groups: number; events: number } | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const b = raw as Partial<Backup>;
  if (!b || b.app !== 'project-delta' || !b.state) return null;
  const incoming = migrate({ ...b.state, version: 2, nsocConfirmed: true }, { ...current, groups: [] });
  if (incoming.groups.length === 0) return null;

  const ids = new Set(current.groups.map((g) => g.id));
  const groupIdMap = new Map<string, string>();
  const groups = incoming.groups.map((g) => {
    const id = ids.has(g.id) ? uid('g') : g.id;
    groupIdMap.set(g.id, id);
    return { ...g, id };
  });
  const evIds = new Set(current.events.map((e) => e.id));
  const events = incoming.events.map((e) => ({
    ...e,
    id: evIds.has(e.id) ? uid('e') : e.id,
    groupId: e.groupId ? (groupIdMap.get(e.groupId) ?? null) : null,
  }));
  return {
    state: { ...current, groups: [...current.groups, ...groups], events: [...current.events, ...events] },
    groups: groups.length,
    events: events.length,
  };
}
