/**
 * The map pane: Globe | Flat toggle (each loaded on first use, never fatal),
 * a toolbar (fit, expand, full screen), and the hover popup that lists every
 * site near the pointer, grouped by clock with local time and staffing.
 */
import type { SimClock } from '../core/clock';
import { slotColor } from '../core/palette';
import type { BoardRow } from '../core/rows';
import type { CoverageState } from '../core/shifts';
import { formatDelta, offsetMinutes, pad2, zonedParts } from '../core/tz';
import type { Place, Theme } from '../core/types';
import type { MapView, MarkerSpec, NearSite } from '../map/types';
import { coverageText } from './coverage';
import { h, icon } from './dom';
import { readPrefs, writePrefs } from './prefs';

export type MapType = 'globe' | 'flat';

interface SiteInfo {
  row: BoardRow;
  coverage: CoverageState | null;
}

interface Handlers {
  /** Click on empty map: propose a new site there. */
  onPropose(lat: number, lon: number): void;
  /** Click a clock group in the popup: focus that timeline row. */
  onFocusRow(key: number): void;
  onToggleExpand(): void;
}

const HOVER_R = 26;
const TAP_R = 34;
const MAX_LIST = 14;

export class MapPanel {
  private type: MapType = readPrefs().mapType === 'flat' ? 'flat' : 'globe';
  private maps: Partial<Record<MapType, MapView>> = {};
  private loading: Partial<Record<MapType, Promise<MapView | null>>> = {};
  private failed: Partial<Record<MapType, boolean>> = {};
  private hosts: Record<MapType, HTMLDivElement>;
  private pop = h('div', { class: 'map-pop', role: 'dialog', 'aria-label': 'Sites here', hidden: true });
  private pinned = false;
  private popSig = '';
  private typeBtns: HTMLButtonElement[] = [];
  private expandBtn: HTMLButtonElement;
  private fsBtn: HTMLButtonElement;
  private specs: MarkerSpec[] = [];
  private nsoc: Place | null = null;
  private info = new Map<string, SiteInfo>();
  private nsocRow: BoardRow | null = null;
  private theme: Theme = 'dark';
  private focusKey: number | null = null;
  private preview: number | null = null;
  private fitTo: { lat: number; lon: number }[] = [];
  private started = false;

  constructor(
    private readonly pane: HTMLElement,
    private readonly clock: SimClock,
    private readonly handlers: Handlers,
  ) {
    this.hosts = {
      globe: h('div', { class: 'map-host', 'data-map': 'globe' }),
      flat: h('div', { class: 'map-host', 'data-map': 'flat' }),
    };
    const seg = h(
      'div',
      { class: 'seg map-type', role: 'group', 'aria-label': 'Map type' },
      ...(['globe', 'flat'] as const).map((m) => {
        const b = h('button', { type: 'button', 'data-map-type': m, onclick: () => this.setType(m) }, m === 'globe' ? 'Globe' : 'Flat');
        this.typeBtns.push(b);
        return b;
      }),
    );
    this.expandBtn = h('button', { type: 'button', class: 'map-btn', title: 'Bigger map (M)', 'aria-label': 'Make the map bigger', onclick: () => handlers.onToggleExpand() }, icon('expand', 15));
    this.fsBtn = h('button', { type: 'button', class: 'map-btn', title: 'Full screen (F)', 'aria-label': 'Full-screen map', onclick: () => this.toggleFullscreen() }, icon('fullscreen', 15));
    const fit = h('button', { type: 'button', class: 'map-btn', title: 'Fit all sites', 'aria-label': 'Fit all sites', onclick: () => this.fit(this.fitTo) }, icon('target', 15));
    this.pane.append(
      this.hosts.globe,
      this.hosts.flat,
      h('div', { class: 'map-toolbar' }, seg, h('span', { class: 'map-tools' }, fit, this.expandBtn, this.fsBtn)),
      h('p', { class: 'map-hint' }, 'Hover for every site in an area · drag to pan · scroll to zoom · click to add a site'),
      this.pop,
    );
    document.addEventListener('fullscreenchange', () => this.syncFullscreen());
    addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.pinned) this.hidePop();
    });
  }

  /** Create the current map on first need (desktop: at start; phone: on the Map tab). */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.renderType();
    const type = this.type;
    void this.ensure(type).then((m) => {
      if (m && this.type === type) m.setActive(true);
    });
  }

  setType(type: MapType): void {
    if (type === this.type && this.maps[type]) return;
    this.maps[this.type]?.setActive(false);
    this.type = type;
    writePrefs({ mapType: type });
    this.hidePop();
    this.renderType();
    if (!this.started) return;
    void this.ensure(type).then((m) => {
      if (!m || this.type !== type) return;
      m.setActive(true);
      m.fit(this.fitTo, 1);
    });
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
    for (const m of Object.values(this.maps)) m?.setTheme(theme);
  }

  /** Rows describe the active group at the instant shown; specs/colours derive from them. */
  update(rows: BoardRow[], nsoc: Place, theme: Theme): void {

    this.nsoc = nsoc;
    this.theme = theme;
    this.info.clear();
    this.nsocRow = rows.find((r) => r.isNsoc) ?? null;
    const isNsoc = (p: Place) => p.tz === nsoc.tz && Math.abs(p.lat - nsoc.lat) < 0.05 && Math.abs(p.lon - nsoc.lon) < 0.05;
    this.specs = [];
    for (const r of rows) {
      const color = slotColor(r.slot, theme);
      for (const s of r.sites) this.info.set(s.place.id, { row: r, coverage: s.coverage });
      // The NSOC has its own marker; don't draw a second pin for it as a site.
      r.sites
        .filter((s) => !isNsoc(s.place))
        .forEach((s, i) => this.specs.push({ place: s.place, color, key: r.key, lead: i === 0 }));
    }
    for (const m of Object.values(this.maps)) {
      m?.setPlaces(this.specs, nsoc);
      m?.focus(this.focusKey);
    }
  }

  focus(key: number | null): void {
    this.focusKey = key;
    for (const m of Object.values(this.maps)) m?.focus(key);
  }

  setPreviewTime(t: number | null): void {
    this.preview = t;
    for (const m of Object.values(this.maps)) m?.setPreviewTime(t);
  }

  /** Remember the default framing (the whole group) and move the visible map to it. */
  setFitTarget(points: { lat: number; lon: number }[]): void {
    this.fitTo = points;
  }

  fit(points: { lat: number; lon: number }[], duration?: number): void {
    this.maps[this.type]?.fit(points.length ? points : this.fitTo, duration);
  }

  setExpanded(expanded: boolean): void {
    this.expandBtn.replaceChildren(icon(expanded ? 'shrink' : 'expand', 15));
    this.expandBtn.setAttribute('aria-pressed', String(expanded));
    this.expandBtn.title = expanded ? 'Smaller map (M)' : 'Bigger map (M)';
  }

  toggleFullscreen(): void {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void this.pane.requestFullscreen?.().catch(() => this.handlers.onToggleExpand());
  }

  private syncFullscreen(): void {
    const fs = document.fullscreenElement === this.pane;
    this.fsBtn.replaceChildren(icon(fs ? 'shrink' : 'fullscreen', 15));
    this.fsBtn.setAttribute('aria-pressed', String(fs));
  }

  private renderType(): void {
    this.typeBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mapType === this.type)));
    this.pane.dataset.mapType = this.type;
  }

  private ensure(type: MapType): Promise<MapView | null> {
    if (this.maps[type]) return Promise.resolve(this.maps[type]!);
    if (this.failed[type]) return Promise.resolve(null);
    this.loading[type] ??= this.create(type);
    return this.loading[type]!;
  }

  private async create(type: MapType): Promise<MapView | null> {
    try {
      const host = this.hosts[type];
      const map: MapView =
        type === 'globe'
          ? new (await import('../map/globe-map')).GlobeMap(host, this.clock)
          : new (await import('../map/flat')).FlatMap(host);
      map.setTheme(this.theme);
      if (this.nsoc) map.setPlaces(this.specs, this.nsoc);
      map.focus(this.focusKey);
      map.setPreviewTime(this.preview);
      this.bind(map);
      this.maps[type] = map;
      void map.ready.then(() => map.fit(this.fitTo, 1));
      if (this.type !== type) map.setActive(false);
      return map;
    } catch (err) {
      console.error(err);
      this.failed[type] = true;
      this.hosts[type].replaceChildren(
        h(
          'div',
          { class: 'no-webgl' },
          h('b', {}, 'Map unavailable'),
          h('span', {}, type === 'globe' ? 'This browser has WebGL turned off — try the Flat map. The board, converter and events all still work.' : 'The flat map could not load. The board still works.'),
        ),
      );
      return null;
    }
  }

  private bind(map: MapView): void {
    map.onPointerMove((x, y) => {
      if (this.pinned) return;
      const near = map.sitesNear(x, y, HOVER_R);
      map.hover(near[0]?.place.id ?? null);
      map.surface.style.cursor = near.length ? 'pointer' : '';
      if (near.length) this.showPop(near, x, y);
      else this.hidePop();
    });
    map.onPointerLeave(() => {
      if (this.pinned) return;
      map.hover(null);
      this.hidePop();
    });
    map.onClick((e) => {
      const near = map.sitesNear(e.x, e.y, TAP_R);
      if (near.length) {
        this.showPop(near, e.x, e.y, true);
        return;
      }
      if (this.pinned) {
        this.hidePop();
        return;
      }
      if (e.lat !== null && e.lon !== null) this.handlers.onPropose(e.lat, e.lon);
    });
  }

  private hidePop(): void {
    this.pinned = false;
    this.pop.hidden = true;
    this.popSig = '';
  }

  /** Keep the popup inside the pane, on the side of the pointer with more room. */
  private placePop(x: number, y: number): void {
    const pw = this.pane.clientWidth;
    const ph = this.pane.clientHeight;
    const w = this.pop.offsetWidth;
    const hgt = this.pop.offsetHeight;
    const left = x + 16 + w > pw - 8 ? Math.max(8, x - 16 - w) : x + 16;
    const top = Math.min(Math.max(8, y - 20), Math.max(8, ph - hgt - 8));
    this.pop.style.transform = `translate(${left}px, ${top}px)`;
  }

  /** List every site near the pointer, grouped by clock row (west → east). */
  private showPop(near: NearSite[], x: number, y: number, pin = false): void {
    const t = this.preview ?? Date.now();
    const sig = `${pin}|${Math.floor(t / 60_000)}|${near.map((n) => n.place.id).sort().join(',')}`;
    this.pinned = pin;
    if (sig === this.popSig && !this.pop.hidden) {
      this.placePop(x, y);
      return;
    }
    this.popSig = sig;
    const groups = new Map<number, { row: BoardRow | null; sites: NearSite[] }>();
    for (const n of near) {
      const row = n.isNsoc ? this.nsocRow : (this.info.get(n.place.id)?.row ?? null);
      const key = row?.key ?? offsetMinutes(n.place.tz, t);
      const g = groups.get(key) ?? { row, sites: [] };
      if (!g.sites.some((s) => s.place.id === n.place.id)) g.sites.push(n);
      groups.set(key, g);
    }
    const ordered = [...groups.entries()].sort((a, b) => (a[1].row?.isNsoc ? -1 : b[1].row?.isNsoc ? 1 : a[0] - b[0]));
    const total = near.length;
    let shown = 0;
    const blocks = ordered.map(([, g]) => {
      const tz = g.row?.tz ?? g.sites[0].place.tz;
      const z = zonedParts(tz, t);
      const color = g.sites[0].color;
      const items = g.sites.slice(0, Math.max(1, MAX_LIST - shown)).map((s) => {
        shown++;
        const cov = s.isNsoc ? null : this.info.get(s.place.id)?.coverage ?? null;
        return h(
          'li',
          {},
          h('span', { class: 'pop-name' }, s.place.name, s.place.region ? h('small', {}, ` ${s.place.region}`) : null, s.isNsoc ? h('span', { class: 'badge' }, 'NSOC') : null),
          cov ? coverageText(cov.state, cov.until, s.place.tz, true) : null,
        );
      });
      return h(
        'section',
        { class: 'pop-group' },
        h(
          'button',
          { type: 'button', class: 'pop-head', title: 'Highlight this clock on the timeline', onclick: () => g.row && this.handlers.onFocusRow(g.row.key) },
          h('i', { class: 'pop-swatch', style: `--c:${color}` }),
          h('b', { class: 'mono' }, g.row?.abbr ?? ''),
          h('span', { class: 'pop-time mono' }, `${pad2(z.hour)}:${pad2(z.minute)}`),
          h('span', { class: 'pop-delta' }, g.row ? (g.row.isNsoc ? 'NSOC time' : `Δ ${formatDelta(g.row.delta)}`) : ''),
        ),
        h('ul', {}, ...items),
      );
    });
    const more = total - shown;
    this.pop.replaceChildren(
      h(
        'div',
        { class: 'pop-top' },
        h('b', {}, `${total} site${total === 1 ? '' : 's'} here`),
        pin ? h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', onclick: () => this.hidePop() }, icon('x', 14)) : h('span', { class: 'muted' }, 'click to pin'),
      ),
      ...blocks,
      ...(more > 0 ? [h('p', { class: 'pop-more' }, `+${more} more — zoom in to separate them`)] : []),
    );
    this.pop.hidden = false;
    this.placePop(x, y);
  }
}
