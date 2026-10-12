/**
 * Time Board panel: the original Canada Time Board, reimagined around a globe.
 * Places that share a clock time are clustered into one card; every card shows
 * its Δ against "Your site", and every interaction is mirrored on the globe.
 */
import type { SimClock } from '../core/clock';
import { nearestCity, searchCities, type City } from '../core/cities';
import { encodeGroup } from '../core/share';
import { makeGroup, store, uid } from '../core/store';
import { dayPhase, sunElevation } from '../core/sun';
import {
  commonWorkWindow,
  formatDelta,
  formatOffset,
  groupByOffset,
  offsetMinutes,
  pad2,
  relativeDay,
  tzLabel,
  workIntervals,
  zonedParts,
  zonedToUtc,
  type OffsetGroup,
} from '../core/tz';
import type { Place } from '../core/types';
import type { Globe } from '../globe/Globe';
import type { MarkerSpec, PlacesLayer } from '../globe/places';
import { AnalogClock } from './analog';
import { h, icon, toast } from './dom';

export const CARD_COLORS = ['#4fd1c5', '#7aa2ff', '#c792ea', '#ff7b9c', '#3ddc97', '#f78c6c', '#89ddff', '#ffcb6b', '#f07178', '#a3e635'];
const HOME_COLOR = '#f5a623';

interface ClockView {
  tz: string;
  analog?: AnalogClock;
  time: HTMLElement;
  offset?: HTMLElement;
  delta?: HTMLElement;
  date?: HTMLElement;
  phase?: HTMLElement;
  lat: number;
  lon: number;
}

type Pending = { name: string; region: string; lat: number; lon: number; tz: string };

export class BoardPanel {
  private homeEl = h('section', { class: 'master card-like', 'aria-label': 'Your site' });
  private groupBar = h('div', { class: 'groupbar' });
  private searchWrap = h('div', { class: 'search' });
  private focusEl = h('div', { class: 'focus-strip' });
  private legend = h('p', { class: 'legend' });
  private cardsEl = h('div', { class: 'cards' });
  private plannerEl = h('section', { class: 'planner' });
  private searchInput: HTMLInputElement;
  private results = h('ul', { class: 'results', role: 'listbox' });
  private searchMode: 'add' | 'home' = 'add';
  private views: ClockView[] = [];
  private signature = '';
  private lastSecond = -1;
  private focusKey: number | null = null;
  private focusPlace: Place | null = null;
  private pending: Pending | null = null;
  private groups: OffsetGroup<Place>[] = [];
  private editing: 'new' | 'rename' | null = null;
  private plannerSig = '';

  constructor(
    readonly el: HTMLElement,
    private readonly clock: SimClock,
    private readonly globe: Globe,
    private readonly places: PlacesLayer,
  ) {
    this.searchInput = h('input', {
      type: 'search',
      placeholder: 'Add a city — try “Iqaluit” or “Tokyo”',
      'aria-label': 'Search cities',
      autocomplete: 'off',
      spellcheck: 'false',
    });
    this.searchInput.addEventListener('input', () => this.renderResults());
    this.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const first = this.results.querySelector('button');
        first?.click();
      } else if (e.key === 'Escape') {
        this.setSearchMode('add');
        this.searchInput.blur();
      } else if (e.key === 'ArrowDown') {
        (this.results.querySelector('button') as HTMLButtonElement | null)?.focus();
        e.preventDefault();
      }
    });
    this.searchWrap.append(
      h('label', { class: 'search-box' }, icon('search'), this.searchInput),
      this.results,
      h('p', { class: 'hint' }, icon('pin', 13), 'Or click anywhere on the globe to drop a pin.'),
    );

    el.append(
      this.homeEl,
      this.groupBar,
      this.searchWrap,
      this.focusEl,
      this.legend,
      this.cardsEl,
      this.plannerEl,
      h(
        'p',
        { class: 'panel-foot' },
        'Times are computed live from IANA time zones in your browser · ',
        h('button', { class: 'link', type: 'button', onclick: () => this.resetDemo() }, 'Restore demo groups'),
      ),
    );

    store.subscribe(() => this.render(true));
    globe.onClick((e) => this.onGlobeClick(e));
    globe.onPointerMove((x, y) => {
      if (store.get().mode !== 'board') return;
      const p = places.pick(x, y);
      places.hover(p?.id ?? null);
      globe.renderer.domElement.style.cursor = p ? 'pointer' : '';
    });
    this.render(true);
  }

  /** Called every animation frame. */
  tick(sim: number): void {
    const second = Math.floor(sim / 1000);
    if (second === this.lastSecond) return;
    this.lastSecond = second;
    // DST boundaries (or scrubbing across them) can regroup cards.
    if (this.computeSignature(sim) !== this.signature) this.render(false);
    const home = store.get().home;
    const homeOff = offsetMinutes(home.tz, sim);
    for (const v of this.views) {
      const z = zonedParts(v.tz, sim);
      v.analog?.set(z.hour, z.minute, z.second);
      v.time.innerHTML = `${pad2(z.hour)}:${pad2(z.minute)}<span class="sec">:${pad2(z.second)}</span>`;
      const off = offsetMinutes(v.tz, sim);
      if (v.offset) v.offset.textContent = `${formatOffset(off)} · ${tzLabel(v.tz, sim)}`;
      if (v.delta) v.delta.textContent = `Δ ${formatDelta(off - homeOff)} vs ${home.name}`;
      if (v.date) {
        const rel = relativeDay(v.tz, home.tz, sim);
        v.date.textContent = `${z.weekday}, ${z.dateKey}${rel !== 'Today' ? ` · ${rel}` : ''}`;
      }
      if (v.phase) {
        const ph = dayPhase(sunElevation(v.lat, v.lon, sim));
        if (v.phase.dataset.phase !== ph) {
          v.phase.dataset.phase = ph;
          v.phase.replaceChildren(icon(ph === 'day' ? 'sun' : ph === 'night' ? 'moon' : 'sunset', 14));
          v.phase.title = { day: 'Daylight', golden: 'Sun near the horizon', twilight: 'Twilight', night: 'Night' }[ph];
        }
      }
    }
    if (second % 30 === 0 || this.plannerSig === '') this.renderPlanner(sim);
    this.updatePlayhead(sim);
  }

  /** Focus a place: fly to it and show its action strip. */
  focus(place: Place): void {
    this.pending = null;
    this.focusPlace = place;
    const g = this.groups.find((g) => g.places.some((p) => p.id === place.id));
    this.focusKey = g ? g.offset : null;
    this.places.focus(this.focusKey);
    this.globe.flyTo(place.lat - 6, place.lon, Math.min(this.globe.distance, 2.1));
    this.renderFocus();
    this.markCards();
  }

  fitGroup(): void {
    const g = store.activeGroup();
    this.globe.fitPlaces(g.places.length ? [...g.places, store.get().home] : [store.get().home]);
  }

  private computeSignature(sim: number): string {
    const s = store.get();
    const g = store.activeGroup();
    return [
      g.id,
      g.places.map((p) => `${p.id}:${offsetMinutes(p.tz, sim)}`).join(','),
      s.home.id + s.home.tz + s.home.lat + s.home.lon,
      offsetMinutes(s.home.tz, sim),
    ].join('|');
  }

  private render(storeChanged: boolean): void {
    const sim = this.clock.now();
    this.signature = this.computeSignature(sim);
    this.views = [];
    const state = store.get();
    const group = store.activeGroup();
    this.groups = groupByOffset(group.places, sim);
    if (this.focusPlace && !group.places.some((p) => p.id === this.focusPlace!.id)) {
      this.focusPlace = null;
      this.focusKey = null;
    }

    this.renderHome();
    this.renderGroupBar();
    this.renderFocus();

    const homeOff = offsetMinutes(state.home.tz, sim);
    this.legend.replaceChildren(
      h('span', {}, h('b', {}, 'Δ'), ` = offset vs ${state.home.name} right now`),
      h('span', {}, 'Cards cluster places that share the same clock time'),
    );

    // Cards
    const colors = new Map<number, string>();
    let ci = 0;
    for (const g of this.groups) colors.set(g.offset, g.offset === homeOff ? HOME_COLOR : CARD_COLORS[ci++ % CARD_COLORS.length]);
    const sorted = [...this.groups].sort((a, b) => (a.offset === homeOff ? -1 : b.offset === homeOff ? 1 : a.offset - b.offset));

    this.cardsEl.replaceChildren(
      ...(sorted.length
        ? sorted.map((g) => this.card(g, colors.get(g.offset)!, g.offset === homeOff))
        : [
            h(
              'div',
              { class: 'empty' },
              h('b', {}, 'This group is empty.'),
              h('span', {}, 'Search for a city above, or click the globe to drop a pin.'),
            ),
          ]),
    );
    this.markCards();

    // Globe markers
    const specs: MarkerSpec[] = [];
    for (const g of this.groups) {
      g.places.forEach((p, i) => specs.push({ place: p, color: colors.get(g.offset)!, key: g.offset, lead: i === 0 }));
    }
    this.places.setPlaces(specs, state.home);
    this.places.focus(this.focusKey);

    this.plannerSig = '';
    this.lastSecond = -1;
    if (storeChanged) this.tick(sim);
  }

  private renderHome(): void {
    const { home, homeAuto } = store.get();
    const analog = new AnalogClock(84);
    const time = h('div', { class: 'time' });
    const offset = h('div', { class: 'offset' });
    const date = h('div', { class: 'date' });
    this.views.push({ tz: home.tz, analog, time, offset, date, lat: home.lat, lon: home.lon });
    this.homeEl.replaceChildren(
      h(
        'div',
        { class: 'master-brand' },
        h('div', { class: 'eyebrow' }, 'Reference clock · your site'),
        h(
          'div',
          { class: 'master-name' },
          h('h2', {}, home.name),
          home.region ? h('small', {}, home.region) : null,
        ),
        h(
          'div',
          { class: 'master-actions' },
          h('span', { class: 'muted' }, homeAuto ? 'Detected from your browser' : 'Pinned by you'),
          h(
            'button',
            { class: 'link', type: 'button', onclick: () => this.setSearchMode('home') },
            'Change',
          ),
          h(
            'button',
            {
              class: 'link',
              type: 'button',
              onclick: () => this.globe.flyTo(home.lat - 6, home.lon, 2.1),
            },
            'Show',
          ),
        ),
      ),
      h(
        'div',
        { class: 'master-clock' },
        analog.el,
        h('div', { class: 'master-info' }, h('div', { class: 'badge' }, 'Your site'), offset, time, date),
      ),
    );
  }

  private renderGroupBar(): void {
    const s = store.get();
    const active = store.activeGroup();
    if (this.editing) {
      const input = h('input', {
        type: 'text',
        value: this.editing === 'rename' ? active.name : '',
        placeholder: 'Group name, e.g. “West Coast Bureaus”',
        'aria-label': 'Group name',
        maxlength: 60,
      });
      const commit = () => {
        const name = input.value.trim();
        const mode = this.editing;
        this.editing = null;
        if (!name) return this.renderGroupBar();
        if (mode === 'new') {
          const g = makeGroup(name, []);
          store.update((d) => {
            d.groups.push(g);
            d.activeGroupId = g.id;
          });
          this.searchInput.focus();
        } else {
          store.update((d) => {
            d.groups.find((g) => g.id === active.id)!.name = name;
          });
        }
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') {
          this.editing = null;
          this.renderGroupBar();
        }
      });
      this.groupBar.replaceChildren(
        input,
        h('button', { class: 'btn primary', type: 'button', onclick: commit }, 'Save'),
        h('button', { class: 'btn', type: 'button', onclick: () => ((this.editing = null), this.renderGroupBar()) }, 'Cancel'),
      );
      requestAnimationFrame(() => input.focus());
      return;
    }

    const select = h(
      'select',
      { 'aria-label': 'Active group' },
      ...s.groups.map((g) => {
        const o = h('option', { value: g.id }, `${g.name} · ${g.places.length}`);
        o.selected = g.id === s.activeGroupId;
        return o;
      }),
    );
    select.addEventListener('change', () => {
      this.focusPlace = null;
      this.focusKey = null;
      store.update((d) => (d.activeGroupId = select.value));
      this.fitGroup();
    });
    const btn = (label: string, ic: Parameters<typeof icon>[0], fn: () => void) =>
      h('button', { class: 'icon-btn', type: 'button', title: label, 'aria-label': label, onclick: fn }, icon(ic));
    this.groupBar.replaceChildren(
      h('label', { class: 'select' }, select, icon('chevron', 14)),
      btn('New group', 'plus', () => ((this.editing = 'new'), this.renderGroupBar())),
      btn('Rename group', 'edit', () => ((this.editing = 'rename'), this.renderGroupBar())),
      btn('Copy share link', 'share', () => this.share()),
      btn('Delete group', 'trash', () => this.deleteGroup()),
    );
  }

  private card(g: OffsetGroup<Place>, color: string, isHome: boolean): HTMLElement {
    const analog = new AnalogClock(64);
    const time = h('div', { class: 'digital' });
    const offset = h('div', { class: 'offset' });
    const delta = h('div', { class: 'delta' });
    const date = h('div', { class: 'dateline' });
    const phase = h('span', { class: 'phase' });
    const lead = g.places[0];
    this.views.push({ tz: g.tz, analog, time, offset, delta, date, phase, lat: lead.lat, lon: lead.lon });

    const chips = g.places.map((p) => {
      const chip = h(
        'span',
        { class: 'chip', 'data-place': p.id },
        h(
          'button',
          { class: 'chip-main', type: 'button', title: `Fly to ${p.name}`, onclick: (e: Event) => (e.stopPropagation(), this.focus(p)) },
          p.name,
          p.region ? h('small', {}, p.region) : null,
        ),
        h(
          'button',
          {
            class: 'chip-x',
            type: 'button',
            title: `Remove ${p.name}`,
            'aria-label': `Remove ${p.name}`,
            onclick: (e: Event) => (e.stopPropagation(), this.removePlace(p)),
          },
          icon('x', 11),
        ),
      );
      chip.addEventListener('mouseenter', () => this.places.hover(p.id));
      chip.addEventListener('mouseleave', () => this.places.hover(null));
      return chip;
    });

    const card = h(
      'article',
      {
        class: `card${isHome ? ' is-now' : ''}`,
        'data-key': g.offset,
        tabindex: 0,
        style: `--c:${color}`,
        'aria-label': `${formatOffset(g.offset)}: ${g.places.map((p) => p.name).join(', ')}`,
      },
      h(
        'div',
        { class: 'card-top' },
        h('div', { class: 'clock-wrap' }, analog.el),
        h(
          'div',
          { class: 'info' },
          isHome ? h('div', { class: 'badge' }, 'Your time') : null,
          offset,
          isHome ? null : delta,
          h('div', { class: 'digital-row' }, phase, time),
          date,
        ),
      ),
      h('div', { class: 'cities' }, chips),
    );
    const activate = () => {
      this.pending = null;
      this.focusPlace = null;
      this.focusKey = this.focusKey === g.offset ? null : g.offset;
      this.places.focus(this.focusKey);
      this.markCards();
      this.renderFocus();
      if (this.focusKey !== null) this.globe.fitPlaces(g.places);
    };
    card.addEventListener('click', activate);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        activate();
      }
    });
    card.addEventListener('mouseenter', () => {
      if (this.focusKey === null) this.places.focus(g.offset);
    });
    card.addEventListener('mouseleave', () => this.places.focus(this.focusKey));
    return card;
  }

  private markCards(): void {
    for (const c of this.cardsEl.querySelectorAll<HTMLElement>('.card')) {
      c.classList.toggle('focused', this.focusKey !== null && Number(c.dataset.key) === this.focusKey);
    }
    for (const c of this.cardsEl.querySelectorAll<HTMLElement>('.chip')) {
      c.classList.toggle('active', c.dataset.place === this.focusPlace?.id);
    }
  }

  private renderFocus(): void {
    const s = store.get();
    if (this.pending) {
      const p = this.pending;
      const z = zonedParts(p.tz, this.clock.now());
      this.focusEl.className = 'focus-strip show pending';
      this.focusEl.replaceChildren(
        h(
          'div',
          { class: 'focus-info' },
          h('b', {}, p.name),
          h('span', {}, `${p.region ? p.region + ' · ' : ''}${p.tz.replace(/_/g, ' ')} · ${pad2(z.hour)}:${pad2(z.minute)}`),
        ),
        h(
          'div',
          { class: 'focus-actions' },
          h('button', { class: 'btn primary', type: 'button', onclick: () => this.addPlace(p) }, icon('plus', 14), `Add to ${store.activeGroup().name}`),
          h('button', { class: 'btn', type: 'button', onclick: () => this.setHome(p) }, icon('home', 14), 'Set as your site'),
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Dismiss', onclick: () => ((this.pending = null), this.renderFocus()) }, icon('x')),
        ),
      );
      return;
    }
    const p = this.focusPlace;
    if (!p) {
      this.focusEl.className = 'focus-strip';
      this.focusEl.replaceChildren();
      return;
    }
    const isHome = Math.abs(p.lat - s.home.lat) < 0.01 && Math.abs(p.lon - s.home.lon) < 0.01;
    this.focusEl.className = 'focus-strip show';
    this.focusEl.replaceChildren(
      h(
        'div',
        { class: 'focus-info' },
        h('b', {}, p.name),
        h('span', {}, `${p.region ? p.region + ' · ' : ''}${p.tz.replace(/_/g, ' ')} · ${p.lat.toFixed(2)}°, ${p.lon.toFixed(2)}°`),
      ),
      h(
        'div',
        { class: 'focus-actions' },
        isHome
          ? h('span', { class: 'muted' }, 'This is your site')
          : h('button', { class: 'btn', type: 'button', onclick: () => this.setHome(p) }, icon('home', 14), 'Set as your site'),
        h('button', { class: 'btn', type: 'button', onclick: () => this.removePlace(p) }, icon('trash', 14), 'Remove'),
        h(
          'button',
          {
            class: 'icon-btn',
            type: 'button',
            'aria-label': 'Clear focus',
            onclick: () => {
              this.focusPlace = null;
              this.focusKey = null;
              this.places.focus(null);
              this.markCards();
              this.renderFocus();
            },
          },
          icon('x'),
        ),
      ),
    );
  }

  private setSearchMode(mode: 'add' | 'home'): void {
    this.searchMode = mode;
    this.searchWrap.classList.toggle('home-mode', mode === 'home');
    this.searchInput.placeholder = mode === 'home' ? 'Search for your site…' : 'Add a city — try “Iqaluit” or “Tokyo”';
    if (mode === 'home') {
      this.searchInput.focus();
      this.searchWrap.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    this.renderResults();
  }

  private renderResults(): void {
    const q = this.searchInput.value;
    const list = searchCities(q, 7);
    const s = store.get();
    const active = store.activeGroup();
    this.results.replaceChildren(
      ...list.map((c) => {
        const already = active.places.some((p) => p.tz === c.tz && Math.abs(p.lat - c.lat) < 0.05 && Math.abs(p.lon - c.lon) < 0.05);
        const z = zonedParts(c.tz, this.clock.now());
        const b = h(
          'button',
          {
            type: 'button',
            role: 'option',
            class: already && this.searchMode === 'add' ? 'dim' : '',
            onclick: () => this.pickCity(c),
          },
          h('span', { class: 'r-name' }, c.name, h('small', {}, `${c.province ? c.province + ', ' : ''}${c.country}`)),
          h('span', { class: 'r-time' }, `${pad2(z.hour)}:${pad2(z.minute)}`, h('small', {}, formatOffset(offsetMinutes(c.tz, this.clock.now())))),
        );
        b.addEventListener('keydown', (e) => {
          if (e.key === 'ArrowDown') ((b.parentElement?.nextElementSibling?.firstElementChild as HTMLElement) ?? b).focus();
          if (e.key === 'ArrowUp') ((b.parentElement?.previousElementSibling?.firstElementChild as HTMLElement) ?? this.searchInput).focus();
        });
        return h('li', {}, b);
      }),
    );
    if (q && list.length === 0) this.results.append(h('li', { class: 'none' }, 'No matching city. Try clicking the globe instead.'));
    if (this.searchMode === 'home' && !q) {
      this.results.append(
        h(
          'li',
          { class: 'none' },
          `Pick your reference site. Currently ${s.home.name}. `,
          h('button', { class: 'link', type: 'button', onclick: () => this.setSearchMode('add') }, 'Cancel'),
        ),
      );
    }
  }

  private pickCity(c: City): void {
    const place = { name: c.name, region: c.regionCode, lat: c.lat, lon: c.lon, tz: c.tz };
    this.searchInput.value = '';
    if (this.searchMode === 'home') {
      this.setHome(place);
      this.setSearchMode('add');
    } else {
      this.addPlace(place);
    }
    this.renderResults();
  }

  private addPlace(p: Pending): void {
    const active = store.activeGroup();
    const existing = active.places.find((q) => q.tz === p.tz && Math.abs(q.lat - p.lat) < 0.05 && Math.abs(q.lon - p.lon) < 0.05);
    this.pending = null;
    if (existing) {
      toast(`${p.name} is already in ${active.name}`);
      this.focus(existing);
      return;
    }
    const place: Place = { ...p, id: uid('p') };
    store.update((d) => d.groups.find((g) => g.id === active.id)!.places.push(place));
    toast(`Added ${p.name} to ${active.name}`);
    this.focus(place);
  }

  private removePlace(p: Place): void {
    const active = store.activeGroup();
    if (this.focusPlace?.id === p.id) {
      this.focusPlace = null;
      this.focusKey = null;
    }
    store.update((d) => {
      const g = d.groups.find((g) => g.id === active.id)!;
      g.places = g.places.filter((q) => q.id !== p.id);
    });
    this.places.hover(null);
    toast(`Removed ${p.name}`);
  }

  private setHome(p: Pending | Place): void {
    this.pending = null;
    store.update((d) => {
      d.home = { id: 'home', name: p.name, region: p.region, lat: p.lat, lon: p.lon, tz: p.tz };
      d.homeAuto = false;
    });
    toast(`${p.name} is now your site — every Δ is measured from here`);
    this.globe.flyTo(p.lat - 6, p.lon, Math.min(this.globe.distance, 2.3));
  }

  private async onGlobeClick(e: { x: number; y: number; lat: number | null; lon: number | null }): Promise<void> {
    if (store.get().mode !== 'board') return;
    const hit = this.places.pick(e.x, e.y);
    if (hit) {
      if (hit.id === 'home') this.globe.flyTo(hit.lat - 6, hit.lon, Math.min(this.globe.distance, 2.1));
      else this.focus(hit);
      return;
    }
    if (e.lat === null || e.lon === null) return;
    const { lat, lon } = e;
    const city = nearestCity(lat, lon, 60);
    let pending: Pending;
    if (city) {
      pending = { name: city.name, region: city.regionCode, lat: city.lat, lon: city.lon, tz: city.tz };
    } else {
      const { default: tzlookup } = await import('@photostructure/tz-lookup');
      let tz = 'UTC';
      try {
        tz = tzlookup(lat, lon);
      } catch {
        /* open ocean edge cases fall back to UTC */
      }
      const ns = `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'}`;
      const ew = `${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`;
      pending = { name: `Pin ${ns} ${ew}`, region: '', lat, lon, tz };
    }
    this.pending = pending;
    this.focusPlace = null;
    this.renderFocus();
    this.focusEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  private async share(): Promise<void> {
    const g = store.activeGroup();
    if (g.places.length === 0) return toast('Add some places before sharing');
    const url = `${location.origin}${location.pathname}#g=${encodeGroup(g)}`;
    try {
      await navigator.clipboard.writeText(url);
      toast(`Share link for “${g.name}” copied`);
    } catch {
      window.prompt('Copy this link to share the group:', url);
    }
  }

  private deleteGroup(): void {
    const s = store.get();
    const g = store.activeGroup();
    if (!confirm(`Delete “${g.name}” and its ${g.places.length} places?`)) return;
    store.update((d) => {
      d.groups = d.groups.filter((x) => x.id !== g.id);
      if (d.groups.length === 0) d.groups.push(makeGroup('My group', []));
      d.activeGroupId = d.groups[0].id;
    });
    if (s.groups.length > 1) this.fitGroup();
  }

  private resetDemo(): void {
    if (!confirm('Replace your groups with the demo groups?')) return;
    try {
      localStorage.removeItem('timeboard3d.v1');
    } catch {
      /* ignore */
    }
    location.hash = '';
    location.reload();
  }

  // ── Meeting planner ──────────────────────────────────────────────────

  private dayWindow(sim: number): [number, number] {
    const tz = store.get().home.tz;
    const z = zonedParts(tz, sim);
    const from = zonedToUtc(tz, z.year, z.month, z.day, 0, 0);
    const n = new Date(Date.UTC(z.year, z.month - 1, z.day + 1));
    const to = zonedToUtc(tz, n.getUTCFullYear(), n.getUTCMonth() + 1, n.getUTCDate(), 0, 0);
    return [from, to];
  }

  private renderPlanner(sim: number): void {
    const s = store.get();
    const [from, to] = this.dayWindow(sim);
    const sig = `${from}|${s.workStart}|${s.workEnd}|${this.signature}`;
    if (sig === this.plannerSig) return;
    this.plannerSig = sig;
    const span = to - from;
    const pct = (t: number) => (((t - from) / span) * 100).toFixed(3) + '%';

    const homeOff = offsetMinutes(s.home.tz, sim);
    const rows = [...this.groups].sort((a, b) => a.offset - b.offset);
    const zones = rows.map((g) => g.tz);
    if (!zones.includes(s.home.tz)) zones.push(s.home.tz);
    const overlap = commonWorkWindow(zones, from, to, s.workStart, s.workEnd);

    const fmt = (t: number) => {
      const z = zonedParts(s.home.tz, t);
      return `${pad2(z.hour)}:${pad2(z.minute)}`;
    };
    let summary: string;
    if (rows.length === 0) summary = 'Add places to find a time that works for everyone.';
    else if (overlap.length) {
      const mins = overlap.reduce((a, [x, y]) => a + (y - x), 0) / 60_000;
      summary = `Everyone is inside ${s.workStart}:00–${s.workEnd}:00 from ${overlap.map(([a, b]) => `${fmt(a)}–${fmt(b)}`).join(', ')} your time (${Math.floor(mins / 60)}h${mins % 60 ? ` ${Math.round(mins % 60)}m` : ''}).`;
    } else {
      // Find the 30-minute slot that covers the most zones.
      let best = 0;
      let bestT = from;
      for (let t = from; t < to; t += 30 * 60_000) {
        const c = zones.filter((tz) => workIntervals(tz, t, t + 30 * 60_000, s.workStart, s.workEnd).length).length;
        if (c > best) {
          best = c;
          bestT = t;
        }
      }
      summary = `No common ${s.workStart}–${s.workEnd} window. Best slot: ${fmt(bestT)} your time covers ${best} of ${zones.length} time zones.`;
    }

    const hourOpts = (sel: number, lo: number, hi: number) =>
      Array.from({ length: hi - lo + 1 }, (_, i) => {
        const o = h('option', { value: lo + i }, `${pad2(lo + i)}:00`);
        o.selected = lo + i === sel;
        return o;
      });
    const startSel = h('select', { 'aria-label': 'Work day starts' }, ...hourOpts(s.workStart, 5, 12));
    const endSel = h('select', { 'aria-label': 'Work day ends' }, ...hourOpts(s.workEnd, 13, 22));
    startSel.addEventListener('change', () => store.update((d) => (d.workStart = Number(startSel.value))));
    endSel.addEventListener('change', () => store.update((d) => (d.workEnd = Number(endSel.value))));

    const track = (tz: string, color: string) =>
      h(
        'div',
        { class: 'track' },
        ...workIntervals(tz, from, to, s.workStart, s.workEnd).map(([a, b]) =>
          h('span', { class: 'work', style: `left:${pct(a)};width:calc(${pct(b)} - ${pct(a)});--c:${color}` }),
        ),
      );

    const colorOf = (key: number) =>
      (this.cardsEl.querySelector(`.card[data-key="${key}"]`) as HTMLElement | null)?.style.getPropertyValue('--c') || CARD_COLORS[0];

    const grid = h(
      'div',
      { class: 'plan-grid' },
      ...rows.map((g) =>
        h(
          'div',
          { class: 'plan-row' },
          h(
            'span',
            { class: 'plan-label', title: g.places.map((p) => p.name).join(', ') },
            h('b', {}, g.places[0].name),
            g.places.length > 1 ? h('small', { class: 'plan-count' }, `+${g.places.length - 1}`) : null,
            h('small', { class: 'plan-delta' }, g.offset === homeOff ? 'you' : formatDelta(g.offset - homeOff)),
          ),
          track(g.tz, colorOf(g.offset)),
        ),
      ),
      h(
        'div',
        { class: 'plan-overlay' },
        ...overlap.map(([a, b]) => h('span', { class: 'overlap', style: `left:${pct(a)};width:calc(${pct(b)} - ${pct(a)})` })),
        h('span', { class: 'playhead' }),
      ),
      h(
        'div',
        { class: 'plan-axis' },
        ...[0, 3, 6, 9, 12, 15, 18, 21, 24].map((hr) => h('span', { style: `left:${((hr / 24) * 100).toFixed(2)}%` }, pad2(hr % 24 === 0 && hr ? 24 : hr))),
      ),
    );
    grid.addEventListener('click', (e) => {
      const tracks = grid.querySelector('.plan-overlay') as HTMLElement;
      const r = tracks.getBoundingClientRect();
      const f = (e.clientX - r.left) / r.width;
      if (f < 0 || f > 1) return;
      const t = from + f * span;
      this.clock.set(Math.round(t / 900_000) * 900_000);
      toast(`Jumped to ${fmt(t)} your time — press “Now” to return`);
    });

    const parts: (Node | null)[] = [
      h(
        'div',
        { class: 'section-head' },
        h('h3', {}, 'Meeting planner'),
        h('div', { class: 'work-hours' }, 'Work day', startSel, '–', endSel),
      ),
      h('p', { class: 'plan-summary' + (overlap.length ? ' ok' : '') }, summary),
      rows.length ? grid : null,
      rows.length ? h('p', { class: 'hint' }, `Hours shown in ${s.home.name} time · click a column to jump the globe there`) : null,
    ];
    this.plannerEl.replaceChildren(...parts.filter((p): p is Node => p !== null));
    this.updatePlayhead(sim);
  }

  private updatePlayhead(sim: number): void {
    const ph = this.plannerEl.querySelector('.playhead') as HTMLElement | null;
    if (!ph) return;
    const [from, to] = this.dayWindow(sim);
    ph.style.left = `${(((sim - from) / (to - from)) * 100).toFixed(3)}%`;
  }
}
