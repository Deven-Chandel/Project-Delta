/**
 * Sites panel: build your own group — add sites by search or by clicking the
 * map, set staffed / on-air hours (group default or per site), share by link,
 * and back up to a file.
 */
import { exportState, mergeBackup } from '../core/backup';
import { nearestCity, searchCities, type City } from '../core/cities';
import { encodeGroup } from '../core/share';
import { formatShift, parseShift } from '../core/shifts';
import { makeGroup, store, uid } from '../core/store';
import { formatOffset, offsetMinutes, pad2, zonedParts } from '../core/tz';
import type { Place, ShiftWindow } from '../core/types';
import { copyText, downloadText, h, icon, toast } from './dom';
import { view } from './view';

type Pending = Omit<Place, 'id'>;

const PRESETS: [string, ShiftWindow][] = [
  ['24 h', { start: 0, end: 0 }],
  ['06–22', { start: 360, end: 1320 }],
  ['07–23', { start: 420, end: 1380 }],
  ['09–17', { start: 540, end: 1020 }],
  ['22–06 night', { start: 1320, end: 360 }],
];

export class SitesPanel {
  readonly el = h('section', { class: 'sites', 'aria-label': 'Sites and groups' });
  private groupBar = h('div', { class: 'groupbar' });
  private hoursEl = h('div', { class: 'hours' });
  private pendingEl = h('div', { class: 'pending' });
  private listEl = h('ul', { class: 'site-list' });
  private results = h('ul', { class: 'results', role: 'listbox' });
  private searchInput: HTMLInputElement;
  private editing: 'new' | 'rename' | null = null;
  private editingSite: string | null = null;

  constructor(private readonly onNeedPanel: () => void) {
    this.searchInput = h('input', { type: 'search', placeholder: 'Add a site — try “Iqaluit” or “Tokyo”', 'aria-label': 'Search cities', autocomplete: 'off', spellcheck: 'false' });
    this.searchInput.addEventListener('input', () => this.renderResults());
    this.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') (this.results.querySelector('button') as HTMLButtonElement | null)?.click();
      if (e.key === 'ArrowDown') (this.results.querySelector('button') as HTMLButtonElement | null)?.focus();
    });
    const file = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      file.value = '';
      if (!f) return;
      const res = mergeBackup(await f.text(), store.get());
      if (!res) return toast('That file isn’t a Time Board backup');
      store.update((d) => Object.assign(d, res.state));
      toast(`Imported ${res.groups} group${res.groups === 1 ? '' : 's'} and ${res.events} event${res.events === 1 ? '' : 's'}`);
    });

    this.el.append(
      h('div', { class: 'section-head' }, h('h2', {}, 'Sites & groups')),
      this.groupBar,
      this.hoursEl,
      h('div', { class: 'search' }, h('label', { class: 'search-box' }, icon('search'), this.searchInput), this.results, h('p', { class: 'hint' }, icon('pin', 13), 'Or click anywhere on the map to drop a pin.')),
      this.pendingEl,
      this.listEl,
      h(
        'div',
        { class: 'backup' },
        h('button', { type: 'button', class: 'btn', onclick: () => downloadText(`time-board-${new Date().toISOString().slice(0, 10)}.json`, exportState(store.get())) }, icon('download', 14), 'Export backup'),
        h('button', { type: 'button', class: 'btn', onclick: () => file.click() }, icon('upload', 14), 'Import backup'),
        file,
        h('button', { type: 'button', class: 'link', onclick: () => this.resetDemo() }, 'Restore demo groups'),
      ),
    );
    store.subscribe(() => this.render());
    this.render();
  }

  /** Map click → propose a site at the nearest city, or a named pin. */
  async proposeAt(lat: number, lon: number): Promise<void> {
    const city = nearestCity(lat, lon, 60);
    let p: Pending;
    if (city) p = { name: city.name, region: city.regionCode, lat: city.lat, lon: city.lon, tz: city.tz };
    else {
      const { default: tzlookup } = await import('@photostructure/tz-lookup');
      let tz = 'UTC';
      try {
        tz = tzlookup(lat, lon);
      } catch {
        /* open ocean edge cases fall back to UTC */
      }
      p = { name: `Pin ${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`, region: '', lat, lon, tz };
    }
    this.renderPending(p);
    this.onNeedPanel();
  }

  private render(): void {
    this.renderGroupBar();
    this.renderHours();
    this.renderList();
  }

  private renderGroupBar(): void {
    const s = store.get();
    const active = store.activeGroup();
    if (this.editing) {
      const input = h('input', { type: 'text', value: this.editing === 'rename' ? active.name : '', placeholder: 'Group name, e.g. “Atlantic transmitters”', 'aria-label': 'Group name', maxlength: 60 });
      const commit = () => {
        const name = input.value.trim();
        const mode = this.editing;
        this.editing = null;
        if (!name) return this.renderGroupBar();
        if (mode === 'new') {
          const g = makeGroup(name, [], []);
          store.update((d) => {
            d.groups.push(g);
            d.activeGroupId = g.id;
          });
          this.searchInput.focus();
        } else store.update((d) => (d.groups.find((g) => g.id === active.id)!.name = name));
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') ((this.editing = null), this.renderGroupBar());
      });
      this.groupBar.replaceChildren(
        input,
        h('button', { class: 'btn primary', type: 'button', onclick: commit }, 'Save'),
        h('button', { class: 'btn', type: 'button', onclick: () => ((this.editing = null), this.renderGroupBar()) }, 'Cancel'),
      );
      requestAnimationFrame(() => input.focus());
      return;
    }
    const select = h('select', { 'aria-label': 'Active group' }, ...s.groups.map((g) => {
      const o = h('option', { value: g.id }, `${g.name} · ${g.places.length}`);
      o.selected = g.id === s.activeGroupId;
      return o;
    }));
    select.addEventListener('change', () => store.update((d) => (d.activeGroupId = select.value)));
    const btn = (label: string, ic: Parameters<typeof icon>[0], fn: () => void) => h('button', { class: 'icon-btn', type: 'button', title: label, 'aria-label': label, onclick: fn }, icon(ic));
    this.groupBar.replaceChildren(
      h('label', { class: 'select' }, select, icon('chevron', 14)),
      btn('New group', 'plus', () => ((this.editing = 'new'), this.renderGroupBar())),
      btn('Rename group', 'edit', () => ((this.editing = 'rename'), this.renderGroupBar())),
      btn('Copy share link', 'share', () => this.share()),
      btn('Delete group', 'trash', () => this.deleteGroup()),
    );
  }

  private renderHours(): void {
    const g = store.activeGroup();
    const input = h('input', { type: 'text', class: 'mono', placeholder: '07:00-23:00', 'aria-label': 'Add staffed hours for the whole group' });
    const add = (w: ShiftWindow | null) => {
      if (!w) return toast('Use a range like 07:00-23:00, 22:00-06:00 or 24h');
      if (g.shifts.some((x) => x.start === w.start && x.end === w.end)) return;
      store.update((d) => d.groups.find((x) => x.id === g.id)!.shifts.push(w));
    };
    input.addEventListener('keydown', (e) => e.key === 'Enter' && add(parseShift(input.value)));
    this.hoursEl.replaceChildren(
      h('div', { class: 'hours-head' }, h('b', {}, 'Staffed / on-air hours'), h('span', { class: 'muted' }, 'local to each site · per-site overrides below')),
      h(
        'div',
        { class: 'hours-chips' },
        ...(g.shifts.length
          ? g.shifts.map((w, i) =>
              h('span', { class: 'chip' }, h('span', { class: 'chip-main mono' }, formatShift(w)), h('button', { type: 'button', class: 'chip-x', 'aria-label': `Remove ${formatShift(w)}`, onclick: () => store.update((d) => d.groups.find((x) => x.id === g.id)!.shifts.splice(i, 1)) }, icon('x', 11))),
            )
          : [h('span', { class: 'muted' }, 'Not set — coverage won’t be shown.')]),
      ),
      h('div', { class: 'hours-add' }, input, h('button', { type: 'button', class: 'btn', onclick: () => add(parseShift(input.value)) }, 'Add'), ...PRESETS.map(([label, w]) => h('button', { type: 'button', class: 'chip-btn', onclick: () => add(w) }, label))),
    );
  }

  private renderList(): void {
    const s = store.get();
    const g = store.activeGroup();
    const now = Date.now();
    if (g.places.length === 0) {
      this.listEl.replaceChildren(h('li', { class: 'empty' }, 'No sites yet — search above or click the map.'));
      return;
    }
    const sorted = [...g.places].sort((a, b) => offsetMinutes(a.tz, now) - offsetMinutes(b.tz, now) || a.name.localeCompare(b.name));
    this.listEl.replaceChildren(
      ...sorted.map((p) => {
        const z = zonedParts(p.tz, now);
        const isNsoc = p.tz === s.nsoc.tz && Math.abs(p.lat - s.nsoc.lat) < 0.05 && Math.abs(p.lon - s.nsoc.lon) < 0.05;
        const editing = this.editingSite === p.id;
        const hoursInput = h('input', { type: 'text', class: 'mono', 'aria-label': `Hours for ${p.name}`, placeholder: 'group default', value: p.shifts ? p.shifts.map(formatShift).join(', ').replace(/–/g, '-') : '' });
        const saveHours = () => {
          const v = hoursInput.value.trim();
          const parts = v ? v.split(',').map((x) => parseShift(x)) : [];
          if (parts.some((x) => !x)) return toast('Use ranges like 07:00-23:00, separated by commas — or leave empty for the group default');
          this.editingSite = null;
          store.update((d) => {
            const site = d.groups.find((x) => x.id === g.id)!.places.find((x) => x.id === p.id)!;
            if (v) site.shifts = parts as ShiftWindow[];
            else delete site.shifts;
          });
        };
        hoursInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') saveHours();
          if (e.key === 'Escape') ((this.editingSite = null), this.renderList());
        });
        return h(
          'li',
          { class: 'site' },
          h(
            'button',
            { type: 'button', class: 'site-main', title: `Show ${p.name} on the map`, onclick: () => view.fly(offsetMinutes(p.tz, Date.now())) },
            h('b', {}, p.name),
            h('small', {}, [p.region, formatOffset(offsetMinutes(p.tz, now))].filter(Boolean).join(' · ')),
            isNsoc ? h('span', { class: 'badge' }, 'NSOC') : null,
          ),
          h('span', { class: 'site-time mono' }, `${pad2(z.hour)}:${pad2(z.minute)}`),
          editing
            ? h('span', { class: 'site-hours-edit' }, hoursInput, h('button', { type: 'button', class: 'btn primary', onclick: saveHours }, 'Save'))
            : h(
                'button',
                { type: 'button', class: 'site-hours mono', title: 'Edit this site’s hours', onclick: () => ((this.editingSite = p.id), this.renderList(), requestAnimationFrame(() => hoursInput.focus())) },
                p.shifts ? (p.shifts.length ? p.shifts.map(formatShift).join(', ') : 'never') : h('span', { class: 'muted' }, 'group hours'),
              ),
          h(
            'span',
            { class: 'site-actions' },
            isNsoc ? null : h('button', { type: 'button', class: 'icon-btn', title: 'Make this the NSOC', 'aria-label': `Make ${p.name} the NSOC`, onclick: () => this.setNsoc(p) }, icon('home', 15)),
            h('button', { type: 'button', class: 'icon-btn', title: `Remove ${p.name}`, 'aria-label': `Remove ${p.name}`, onclick: () => this.remove(p) }, icon('trash', 15)),
          ),
        );
      }),
    );
  }

  private renderResults(): void {
    const q = this.searchInput.value;
    const list = searchCities(q, 7);
    const now = Date.now();
    this.results.replaceChildren(
      ...list.map((c) => {
        const z = zonedParts(c.tz, now);
        return h(
          'li',
          {},
          h(
            'button',
            { type: 'button', role: 'option', onclick: () => this.pick(c) },
            h('span', { class: 'r-name' }, c.name, h('small', {}, `${c.province ? c.province + ', ' : ''}${c.country}`)),
            h('span', { class: 'r-time mono' }, `${pad2(z.hour)}:${pad2(z.minute)}`, h('small', {}, formatOffset(offsetMinutes(c.tz, now)))),
          ),
        );
      }),
    );
    if (q && list.length === 0) this.results.append(h('li', { class: 'none' }, 'No matching city — click the map to drop a pin instead.'));
  }

  private pick(c: City): void {
    this.searchInput.value = '';
    this.renderResults();
    this.add({ name: c.name, region: c.regionCode, lat: c.lat, lon: c.lon, tz: c.tz });
  }

  private renderPending(p: Pending | null): void {
    if (!p) return this.pendingEl.replaceChildren();
    const z = zonedParts(p.tz, Date.now());
    this.pendingEl.replaceChildren(
      h(
        'div',
        { class: 'focus-strip show pending' },
        h('div', { class: 'focus-info' }, h('b', {}, p.name), h('span', {}, `${p.region ? p.region + ' · ' : ''}${p.tz.replace(/_/g, ' ')} · ${pad2(z.hour)}:${pad2(z.minute)}`)),
        h(
          'div',
          { class: 'focus-actions' },
          h('button', { class: 'btn primary', type: 'button', onclick: () => (this.add(p), this.renderPending(null)) }, icon('plus', 14), `Add to ${store.activeGroup().name}`),
          h('button', { class: 'btn', type: 'button', onclick: () => (this.setNsoc({ ...p, id: 'nsoc' }), this.renderPending(null)) }, icon('home', 14), 'Make NSOC'),
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Dismiss', onclick: () => this.renderPending(null) }, icon('x')),
        ),
      ),
    );
    this.pendingEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  private add(p: Pending): void {
    const g = store.activeGroup();
    if (g.places.some((q) => q.tz === p.tz && Math.abs(q.lat - p.lat) < 0.05 && Math.abs(q.lon - p.lon) < 0.05)) return toast(`${p.name} is already in ${g.name}`);
    store.update((d) => d.groups.find((x) => x.id === g.id)!.places.push({ ...p, id: uid('p') }));
    toast(`Added ${p.name} to ${g.name}`);
  }

  private remove(p: Place): void {
    const g = store.activeGroup();
    store.update((d) => {
      const grp = d.groups.find((x) => x.id === g.id)!;
      grp.places = grp.places.filter((q) => q.id !== p.id);
    });
    toast(`Removed ${p.name}`);
  }

  private setNsoc(p: Place): void {
    store.update((d) => {
      d.nsoc = { id: 'nsoc', name: p.name, region: p.region, lat: p.lat, lon: p.lon, tz: p.tz };
      d.nsocConfirmed = true;
    });
    toast(`${p.name} is now the NSOC — every Δ is measured from here`);
  }

  private async share(): Promise<void> {
    const g = store.activeGroup();
    if (g.places.length === 0) return toast('Add some sites before sharing');
    const events = store.get().events.filter((e) => e.groupId === g.id);
    const url = `${location.origin}${location.pathname}#g=${encodeGroup(g, events)}`;
    if (url.length > 8000) toast('This group is large — Export backup is more reliable than a link');
    toast((await copyText(url)) ? `Share link for “${g.name}” copied — includes hours and ${events.length} event${events.length === 1 ? '' : 's'}` : 'Couldn’t copy the link');
  }

  private deleteGroup(): void {
    const g = store.activeGroup();
    if (!confirm(`Delete “${g.name}”, its ${g.places.length} sites and its events?`)) return;
    store.update((d) => {
      d.groups = d.groups.filter((x) => x.id !== g.id);
      d.events = d.events.filter((e) => e.groupId !== g.id);
      if (d.groups.length === 0) d.groups.push(makeGroup('My sites', [], []));
      d.activeGroupId = d.groups[0].id;
    });
  }

  private resetDemo(): void {
    if (!confirm('Replace all groups and events with the demo data? Export a backup first if you want to keep yours.')) return;
    try {
      localStorage.removeItem('timeboard3d.v2');
      localStorage.removeItem('timeboard3d.v1');
    } catch {
      /* ignore */
    }
    location.hash = '';
    location.reload();
  }
}
