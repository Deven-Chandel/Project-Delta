/**
 * Desktop layout controls: drag the divider between board and side panel
 * (map width), drag the divider under the map (map height), or toggle the
 * expanded "big map" layout. Sizes are remembered per browser.
 */
import { h } from './dom';
import { readPrefs, writePrefs } from './prefs';

export class Layout {
  private expanded = false;
  private before: { sideW?: number; mapH?: number } = {};

  constructor(
    private readonly side: HTMLElement,
    private readonly mapPane: HTMLElement,
    private readonly onChange: (expanded: boolean) => void,
  ) {
    const p = readPrefs();
    this.apply(p.sideW ?? null, p.mapH ?? null);
    this.expanded = !!p.expanded;
    // Saved sideW/mapH are the pre-expansion sizes (expanding never overwrites them).
    this.before = { sideW: p.sideW, mapH: p.mapH };
    if (this.expanded) this.setExpanded(true, false);

    const v = h('div', { class: 'split split-v', role: 'separator', 'aria-orientation': 'vertical', 'aria-label': 'Drag to resize the map width', tabindex: 0 });
    const hz = h('div', { class: 'split split-h', role: 'separator', 'aria-orientation': 'horizontal', 'aria-label': 'Drag to resize the map height', tabindex: 0 });
    side.append(v);
    mapPane.append(hz);
    this.drag(v, (dx) => this.apply(this.sideW() - dx, undefined));
    this.drag(hz, (_dx, dy) => this.apply(undefined, this.mapH() + dy));
    v.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        this.apply(this.sideW() + (e.key === 'ArrowLeft' ? 40 : -40), undefined, true);
      }
    });
    hz.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        this.apply(undefined, this.mapH() + (e.key === 'ArrowDown' ? 40 : -40), true);
      }
    });
    v.addEventListener('dblclick', () => this.reset());
    hz.addEventListener('dblclick', () => this.reset());
    addEventListener('resize', () => {
      if (this.expanded) this.apply(...this.expandedSizes());
      else this.apply(readPrefs().sideW ?? null, readPrefs().mapH ?? null);
    });
  }

  get isExpanded(): boolean {
    return this.expanded;
  }

  toggleExpand(): void {
    this.setExpanded(!this.expanded, true);
  }

  private setExpanded(on: boolean, save: boolean): void {
    if (on) {
      if (save) this.before = { sideW: readPrefs().sideW, mapH: readPrefs().mapH };
      this.apply(...this.expandedSizes());
    } else {
      this.apply(this.before.sideW ?? null, this.before.mapH ?? null, false);
    }
    this.expanded = on;
    document.body.classList.toggle('map-expanded', on);
    if (save) writePrefs({ expanded: on, ...(on ? {} : { sideW: this.before.sideW, mapH: this.before.mapH }) });
    this.onChange(on);
  }

  private expandedSizes(): [number, number] {
    const sideH = this.side.clientHeight || innerHeight - 60;
    return [Math.max(560, innerWidth * 0.64), Math.max(320, sideH * 0.72)];
  }

  private sideW(): number {
    return this.side.getBoundingClientRect().width;
  }

  private mapH(): number {
    return this.mapPane.getBoundingClientRect().height;
  }

  /** Set the given sizes (clamped so the board and side lists stay usable); `null` = back to default. */
  private apply(sideW: number | null | undefined, mapH: number | null | undefined, save = false): void {
    const s = document.body.style;
    if (sideW === null) s.removeProperty('--side-w');
    else if (sideW !== undefined) {
      const w = Math.round(Math.min(Math.max(320, sideW), innerWidth - 420));
      s.setProperty('--side-w', `${w}px`);
      if (save) writePrefs({ sideW: w });
    }
    if (mapH === null) s.removeProperty('--map-h');
    else if (mapH !== undefined) {
      const sideH = this.side.clientHeight || innerHeight - 60;
      const hgt = Math.round(Math.min(Math.max(180, mapH), sideH - 140));
      s.setProperty('--map-h', `${hgt}px`);
      if (save) writePrefs({ mapH: hgt });
    }
  }

  private reset(): void {
    this.expanded = false;
    document.body.classList.remove('map-expanded');
    this.apply(null, null);
    writePrefs({ sideW: undefined, mapH: undefined, expanded: false });
    this.onChange(false);
  }

  private drag(el: HTMLElement, move: (dx: number, dy: number) => void): void {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      document.body.classList.add('resizing');
      let last = { x: e.clientX, y: e.clientY };
      const onMove = (ev: PointerEvent) => {
        move(ev.clientX - last.x, ev.clientY - last.y);
        last = { x: ev.clientX, y: ev.clientY };
      };
      const onUp = () => {
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', onUp);
        el.removeEventListener('pointercancel', onUp);
        document.body.classList.remove('resizing');
        // Persist the final sizes; a manual drag leaves expanded mode.
        writePrefs({ sideW: Math.round(this.sideW()), mapH: Math.round(this.mapH()), expanded: false });
        if (this.expanded) {
          this.expanded = false;
          document.body.classList.remove('map-expanded');
          this.onChange(false);
        }
      };
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onUp);
      el.addEventListener('pointercancel', onUp);
    });
  }
}
