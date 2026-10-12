/**
 * Live Orbits panel: dataset toggles, satellite search and details, next
 * passes over "Your site", and a live sky plot of what's overhead.
 */
import type { SimClock } from '../core/clock';
import { vec3ToLatLon } from '../core/geo';
import { store } from '../core/store';
import { pad2, zonedParts } from '../core/tz';
import type { Globe } from '../globe/Globe';
import type { SatelliteLayer, SkyItem } from '../globe/satellites';
import { predictPasses, satFacts } from '../orbits/passes';
import { DATASETS } from '../orbits/tle';
import { h, icon, toast } from './dom';

const FEATURED = [
  { norad: 25544, label: 'ISS' },
  { norad: 48274, label: 'Tiangong' },
  { norad: 20580, label: 'Hubble' },
];

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compass = (az: number) => COMPASS[Math.round(((az % 360) + 360) % 360 / 45) % 8];

export class OrbitsPanel {
  private statusEl = h('p', { class: 'data-status' });
  private datasetsEl = h('ul', { class: 'datasets' });
  private searchInput: HTMLInputElement;
  private results = h('ul', { class: 'results' });
  private detailEl = h('section', { class: 'sat-detail' });
  private skyEl = h('section', { class: 'sky' });
  private factsEls: Record<string, HTMLElement> = {};
  private follow = false;
  private lastFacts = 0;
  private lastSky = 0;
  private skyBusy = false;
  private active = false;
  private pendingNorad: number | null = null;

  constructor(
    readonly el: HTMLElement,
    private readonly clock: SimClock,
    private readonly globe: Globe,
    private readonly sats: SatelliteLayer,
  ) {
    this.searchInput = h('input', {
      type: 'search',
      placeholder: 'Search satellites — “ISS”, “NOAA 19”…',
      'aria-label': 'Search satellites',
      autocomplete: 'off',
      spellcheck: 'false',
    });
    this.searchInput.addEventListener('input', () => this.renderResults());
    this.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') (this.results.querySelector('button') as HTMLButtonElement | null)?.click();
    });

    el.append(
      h(
        'section',
        { class: 'orbits-intro' },
        h('div', { class: 'eyebrow' }, 'Bonus mode · live orbits'),
        h('h2', {}, 'What’s flying over your site?'),
        h(
          'p',
          { class: 'muted' },
          'Every dot is a real satellite, propagated with the SGP4 model from public CelesTrak orbital elements. It shares the Time Board clock, so scrubbing time moves them too.',
        ),
        this.statusEl,
      ),
      h('div', { class: 'section-head' }, h('h3', {}, 'Layers')),
      this.datasetsEl,
      h(
        'div',
        { class: 'search' },
        h('label', { class: 'search-box' }, icon('search'), this.searchInput),
        this.results,
        h(
          'div',
          { class: 'featured' },
          ...FEATURED.map((f) =>
            h('button', { class: 'chip-btn', type: 'button', onclick: () => this.selectNorad(f.norad, true) }, icon('satellite', 13), f.label),
          ),
        ),
      ),
      this.detailEl,
      this.skyEl,
    );

    sats.onChange(() => this.renderAll());
    globe.onClick((e) => {
      if (store.get().mode !== 'orbits') return;
      const i = sats.pick(e.x, e.y);
      if (i !== null) this.select(i, false);
    });
    globe.onPointerMove((x, y) => {
      if (store.get().mode === 'orbits') sats.hover(x, y);
    });
    globe.controls.addEventListener('start', () => {
      if (this.follow) {
        this.follow = false;
        this.renderDetail();
      }
    });
    this.renderAll();
  }

  setActive(active: boolean): void {
    this.active = active;
    if (active) {
      this.lastSky = 0;
      void this.sats.setEnabled(store.get().datasets);
    }
  }

  /** Deep links may name a satellite before its dataset has loaded. */
  selectNorad(norad: number, fly: boolean): void {
    const i = this.sats.findByNorad(norad);
    if (i >= 0) {
      this.select(i, fly);
      this.pendingNorad = null;
    } else {
      this.pendingNorad = norad;
      toast('Loading satellites…');
      if (!store.get().datasets.includes('stations') && [25544, 48274].includes(norad)) {
        store.update((d) => d.datasets.unshift('stations'));
        void this.sats.setEnabled(store.get().datasets);
      }
      if (!store.get().datasets.includes('science') && norad === 20580) {
        store.update((d) => d.datasets.push('science'));
        void this.sats.setEnabled(store.get().datasets);
      }
    }
  }

  tick(sim: number): void {
    if (!this.active) return;
    const now = performance.now();
    if (this.sats.selectedRec && now - this.lastFacts > 500) {
      this.lastFacts = now;
      this.updateFacts(sim);
    }
    if (this.follow && this.sats.selected !== null) {
      const p = this.sats.worldPosition(this.sats.selected, sim);
      if (p) {
        const dist = Math.max(this.globe.distance, p.length() + 0.9);
        this.globe.camera.position.copy(p.clone().normalize().multiplyScalar(dist));
      }
    }
    if (now - this.lastSky > 3000 && !this.skyBusy) {
      this.lastSky = now;
      this.skyBusy = true;
      const home = store.get().home;
      void this.sats.sky(home.lat, home.lon).then((items) => {
        this.skyBusy = false;
        this.renderSky(items);
      });
    }
  }

  private renderAll(): void {
    this.renderStatus();
    this.renderDatasets();
    if (this.pendingNorad !== null) {
      const i = this.sats.findByNorad(this.pendingNorad);
      if (i >= 0) {
        this.pendingNorad = null;
        this.select(i, true);
        return;
      }
    }
    this.renderDetail();
  }

  private renderStatus(): void {
    const states = [...this.sats.datasets.values()].filter((s) => s.status === 'ready');
    const loading = [...this.sats.datasets.values()].some((s) => s.status === 'loading');
    const errors = [...this.sats.datasets.entries()].filter(([id, s]) => s.status === 'error' && store.get().datasets.includes(id));
    const snap = states.find((s) => s.source === 'snapshot');
    const parts: (string | Node)[] = [];
    if (loading) parts.push(h('span', { class: 'spinner' }), 'Loading orbital elements… ');
    if (states.length) {
      const total = this.sats.sats.length;
      const when = snap?.fetchedAt ? ago(Date.parse(snap.fetchedAt)) : 'just now';
      parts.push(
        h('b', {}, total.toLocaleString()),
        ` satellites · ${snap ? `CelesTrak snapshot from ${when}` : 'fetched live from CelesTrak'}`,
      );
    }
    if (errors.length && !loading) {
      parts.push(
        h('span', { class: 'warn' }, ` Couldn’t reach CelesTrak for ${errors.map(([id]) => DATASETS.find((d) => d.id === id)?.label).join(', ')}.`),
      );
    }
    this.statusEl.replaceChildren(...parts);
  }

  private renderDatasets(): void {
    const enabled = new Set(store.get().datasets);
    this.datasetsEl.replaceChildren(
      ...DATASETS.map((d) => {
        const st = this.sats.datasets.get(d.id)!;
        const input = h('input', { type: 'checkbox', 'aria-label': d.label });
        input.checked = enabled.has(d.id);
        input.addEventListener('change', () => {
          store.update((s) => {
            s.datasets = input.checked ? [...new Set([...s.datasets, d.id])] : s.datasets.filter((x) => x !== d.id);
          });
          void this.sats.setEnabled(store.get().datasets);
        });
        return h(
          'li',
          {},
          h(
            'label',
            { class: 'dataset', style: `--c:${d.color}` },
            input,
            h('span', { class: 'swatch' }),
            h('span', { class: 'ds-text' }, h('b', {}, d.label), h('small', {}, d.blurb)),
            h(
              'span',
              { class: 'ds-count' },
              st.status === 'loading' ? '…' : st.status === 'error' ? '!' : st.count ? st.count.toLocaleString() : '',
            ),
          ),
        );
      }),
    );
  }

  private renderResults(): void {
    const q = this.searchInput.value.trim().toLowerCase();
    if (!q) return this.results.replaceChildren();
    const out: { i: number; score: number }[] = [];
    this.sats.sats.forEach((s, i) => {
      const n = s.name.toLowerCase();
      const idx = n.indexOf(q);
      if (idx >= 0 || String(s.norad) === q) out.push({ i, score: idx === 0 ? 0 : 1 });
    });
    out.sort((a, b) => a.score - b.score || this.sats.sats[a.i].name.length - this.sats.sats[b.i].name.length);
    this.results.replaceChildren(
      ...out.slice(0, 7).map(({ i }) => {
        const s = this.sats.sats[i];
        return h(
          'li',
          {},
          h(
            'button',
            { type: 'button', onclick: () => ((this.searchInput.value = ''), this.results.replaceChildren(), this.select(i, true)) },
            h('span', { class: 'r-name' }, h('i', { class: 'dot', style: `--c:${s.color}` }), s.name, h('small', {}, `NORAD ${s.norad}`)),
            h('span', { class: 'r-time' }, DATASETS.find((d) => d.id === s.dataset)?.label ?? ''),
          ),
        );
      }),
    );
    if (out.length === 0) this.results.append(h('li', { class: 'none' }, 'No satellite by that name in the enabled layers.'));
  }

  private select(i: number, fly: boolean): void {
    this.sats.select(i);
    this.lastFacts = 0;
    if (fly) {
      const p = this.sats.worldPosition(i, this.clock.now());
      if (p) {
        // Look from above the orbital plane (tilted ~40°) so the ring reads as an ellipse.
        const n = this.sats.orbitNormal(i);
        const dir = p.clone().normalize();
        if (n) dir.add(n.multiplyScalar(dir.y >= 0 ? 0.85 : -0.85)).normalize();
        const { lat, lon } = vec3ToLatLon([dir.x, dir.y, dir.z]);
        this.globe.flyTo(lat, lon, Math.max(3.2, p.length() * 2.2));
      }
    }
  }

  private renderDetail(): void {
    const i = this.sats.selected;
    if (i === null || !this.sats.sats[i]) {
      this.detailEl.className = 'sat-detail';
      this.detailEl.replaceChildren(h('p', { class: 'hint' }, icon('target', 13), 'Click any dot on the globe, or pick a featured satellite, to see its orbit.'));
      return;
    }
    const s = this.sats.sats[i];
    const ds = DATASETS.find((d) => d.id === s.dataset);
    this.factsEls = {};
    const fact = (key: string, label: string) => {
      const v = h('b', {}, '—');
      this.factsEls[key] = v;
      return h('div', { class: 'fact' }, h('small', {}, label), v);
    };
    this.detailEl.className = 'sat-detail show';
    this.detailEl.style.setProperty('--c', s.color);
    this.detailEl.replaceChildren(
      h(
        'div',
        { class: 'sat-head' },
        h('div', {}, h('div', { class: 'eyebrow' }, `${ds?.label ?? ''} · NORAD ${s.norad}`), h('h3', {}, s.name)),
        h(
          'div',
          { class: 'focus-actions' },
          h(
            'button',
            {
              class: `btn${this.follow ? ' primary' : ''}`,
              type: 'button',
              'aria-pressed': String(this.follow),
              onclick: () => {
                this.follow = !this.follow;
                this.renderDetail();
              },
            },
            icon('target', 14),
            this.follow ? 'Following' : 'Follow',
          ),
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Clear selection', onclick: () => ((this.follow = false), this.sats.select(null)) }, icon('x')),
        ),
      ),
      h(
        'div',
        { class: 'facts' },
        fact('alt', 'Altitude'),
        fact('speed', 'Speed'),
        fact('pos', 'Over'),
        fact('period', 'Orbit period'),
        fact('inc', 'Inclination'),
        fact('age', 'Data age'),
      ),
      this.passesEl(),
    );
    this.updateFacts(this.clock.now());
  }

  private updateFacts(sim: number): void {
    const rec = this.sats.selectedRec;
    if (!rec || !this.factsEls.alt) return;
    const f = satFacts(rec, sim);
    if (!f) {
      this.factsEls.alt.textContent = 'decayed?';
      return;
    }
    this.factsEls.alt.textContent = `${Math.round(f.altitudeKm).toLocaleString()} km`;
    this.factsEls.speed.textContent = `${f.speedKms.toFixed(2)} km/s`;
    this.factsEls.pos.textContent = `${Math.abs(f.lat).toFixed(1)}°${f.lat >= 0 ? 'N' : 'S'} ${Math.abs(f.lon).toFixed(1)}°${f.lon >= 0 ? 'E' : 'W'}`;
    this.factsEls.period.textContent = f.periodMin > 600 ? `${(f.periodMin / 60).toFixed(1)} h` : `${f.periodMin.toFixed(1)} min`;
    this.factsEls.inc.textContent = `${f.inclinationDeg.toFixed(1)}°`;
    this.factsEls.age.textContent = f.epochAgeDays < 1 ? `${Math.round(f.epochAgeDays * 24)} h` : `${f.epochAgeDays.toFixed(1)} d`;
  }

  private passesEl(): HTMLElement {
    const rec = this.sats.selectedRec;
    const home = store.get().home;
    const wrap = h('div', { class: 'passes' }, h('h4', {}, `Next passes over ${home.name}`));
    if (!rec) return wrap;
    const passes = predictPasses(rec, home, this.clock.now(), 36, 10);
    if (passes.length === 0) {
      const f = satFacts(rec, this.clock.now());
      wrap.append(
        h(
          'p',
          { class: 'muted' },
          f && f.periodMin > 1300
            ? 'Geosynchronous — it hangs in the same patch of sky instead of passing over.'
            : 'No passes above 10° in the next 36 hours from here.',
        ),
      );
      return wrap;
    }
    const fmt = (t: number) => {
      const z = zonedParts(home.tz, t);
      return `${z.weekday} ${pad2(z.hour)}:${pad2(z.minute)}`;
    };
    wrap.append(
      h(
        'ol',
        {},
        ...passes.map((p) =>
          h(
            'li',
            {},
            h(
              'button',
              {
                type: 'button',
                title: 'Jump the clock to this pass',
                onclick: () => {
                  this.clock.set(p.maxTime);
                  this.lastSky = 0;
                  toast(`Jumped to the ${fmt(p.maxTime)} pass — press “Now” to return`);
                },
              },
              h('span', {}, fmt(p.rise)),
              h('span', { class: 'muted' }, `${compass(p.riseAzimuth)} → ${compass(p.setAzimuth)}`),
              h('b', {}, `${Math.round(p.maxElevation)}°`),
              h('span', { class: 'muted' }, `${Math.max(1, Math.round((p.set - p.rise) / 60_000))} min`),
            ),
          ),
        ),
      ),
    );
    return wrap;
  }

  private renderSky(items: SkyItem[]): void {
    const home = store.get().home;
    const R = 92;
    const C = 100;
    const pt = (az: number, el: number) => {
      const r = ((90 - el) / 90) * R;
      const a = (az * Math.PI) / 180;
      return [C + r * Math.sin(a), C - r * Math.cos(a)];
    };
    const above10 = items.filter((i) => i.el >= 10).sort((a, b) => b.el - a.el);
    const sel = this.sats.selected;
    const dots = items
      .map((it) => {
        const [x, y] = pt(it.az, it.el);
        const big = it.sat.dataset === 'stations' || it.index === sel;
        return `<circle data-i="${it.index}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${big ? 4 : 2}" fill="${it.sat.color}" ${it.index === sel ? 'stroke="#fff" stroke-width="1.5"' : ''} opacity="${it.el < 10 ? 0.45 : 0.95}"><title>${escapeHtml(it.sat.name)} · ${Math.round(it.el)}° ${compass(it.az)}</title></circle>`;
      })
      .join('');
    const svg = `<svg viewBox="0 0 200 200" class="skyplot" role="img" aria-label="Sky plot of satellites above ${escapeHtml(home.name)}">
      <circle cx="100" cy="100" r="${R}" class="ring"/>
      <circle cx="100" cy="100" r="${(R * 2) / 3}" class="ring faint"/>
      <circle cx="100" cy="100" r="${R / 3}" class="ring faint"/>
      <path d="M100 8V192M8 100H192" class="ring faint"/>
      <text x="100" y="5" class="cardinal">N</text><text x="197" y="103" class="cardinal">E</text>
      <text x="100" y="200" class="cardinal">S</text><text x="3" y="103" class="cardinal">W</text>
      ${dots}
    </svg>`;
    const plot = h('div', { class: 'skyplot-wrap', html: svg });
    plot.addEventListener('click', (e) => {
      const c = (e.target as Element).closest('circle[data-i]');
      if (c) this.select(Number(c.getAttribute('data-i')), true);
    });
    this.skyEl.replaceChildren(
      h(
        'div',
        { class: 'section-head' },
        h('h3', {}, `Over ${home.name} now`),
        h('span', { class: 'muted' }, `${items.length.toLocaleString()} above horizon`),
      ),
      plot,
      h(
        'ol',
        { class: 'sky-list' },
        ...above10.slice(0, 6).map((it) =>
          h(
            'li',
            {},
            h(
              'button',
              { type: 'button', onclick: () => this.select(it.index, true) },
              h('i', { class: 'dot', style: `--c:${it.sat.color}` }),
              h('span', { class: 'r-name' }, it.sat.name),
              h('span', { class: 'muted' }, `${Math.round(it.el)}° ${compass(it.az)}`),
            ),
          ),
        ),
      ),
      h('p', { class: 'hint' }, 'Centre is straight up; the rim is the horizon. Change “Your site” on the Time Board to look from somewhere else.'),
    );
  }
}

function ago(t: number): string {
  const m = Math.round((Date.now() - t) / 60_000);
  if (m < 60) return `${Math.max(1, m)} min ago`;
  const hrs = Math.round(m / 60);
  if (hrs < 48) return `${hrs} h ago`;
  return `${Math.round(hrs / 24)} days ago`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
