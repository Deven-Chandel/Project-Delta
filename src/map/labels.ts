/**
 * Map label placement shared by the globe and the flat map, so both follow
 * the same rules: which sites earn a label, priority, and greedy collision
 * avoidance with labels flipping left at the right edge.
 */
export interface LabelCandidate {
  label: HTMLElement;
  name: string;
  x: number;
  y: number;
  isNsoc: boolean;
  hovered: boolean;
  focused: boolean;
  lead: boolean;
  /** 0–1 fade for labels near the globe's limb; 1 on the flat map. */
  opacity?: number;
}

/** Should this site have a label at all? */
export function wantsLabel(c: Pick<LabelCandidate, 'isNsoc' | 'hovered' | 'focused' | 'lead'>, anyFocus: boolean, zoomedIn: boolean): boolean {
  return c.isNsoc || c.hovered || c.focused || (!anyFocus && (c.lead || zoomedIn));
}

/** Hovered > NSOC > focused clock > one per clock > everything else. */
function priority(c: LabelCandidate): number {
  return c.hovered ? 0 : c.isNsoc ? 1 : c.focused ? 2 : c.lead ? 3 : 4;
}

/** Show, position and hide labels; higher-priority labels claim space first. */
export function placeLabels(cands: LabelCandidate[], hidden: HTMLElement[], maxX: number): void {
  for (const el of hidden) el.classList.remove('show');
  const sorted = cands.map((c) => ({ c, prio: priority(c) })).sort((a, b) => a.prio - b.prio);
  const placed: [number, number, number, number][] = [];
  for (const { c, prio } of sorted) {
    c.label.classList.toggle('hot', c.hovered || c.focused);
    const w = c.name.length * 7 + (c.isNsoc ? 112 : 58);
    const flip = c.x + 10 + w > maxX - 8;
    const left = flip ? c.x - w - 10 : c.x + 10;
    const box: [number, number, number, number] = [left, c.y - 31, left + w, c.y - 9];
    if (prio > 1 && placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) {
      c.label.classList.remove('show');
      continue;
    }
    placed.push(box);
    c.label.classList.add('show');
    c.label.classList.toggle('flip', flip);
    c.label.style.transform = `translate3d(${(flip ? c.x - w - 20 : c.x).toFixed(1)}px, ${c.y.toFixed(1)}px, 0)`;
    c.label.style.opacity = String(c.opacity ?? 1);
    c.label.style.zIndex = String(10 - prio);
  }
}
