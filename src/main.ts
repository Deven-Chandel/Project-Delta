import '@fontsource-variable/space-grotesk';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/600.css';
import '@fontsource/jetbrains-mono/700.css';
import './styles.css';

import { SimClock } from './core/clock';
import { countdownLabel } from './core/countdown';
import { slotColor } from './core/palette';
import { buildRows } from './core/rows';
import { decodeGroup } from './core/share';
import { makeGroup, store, uid } from './core/store';
import { offsetMinutes, pad2, tzAbbr, zonedParts } from './core/tz';
import type { Theme } from './core/types';
import type { Globe } from './globe/Globe';
import type { MarkerSpec, PlacesLayer } from './globe/places';
import { Converter } from './ui/converter';
import { $, h, icon, toast } from './ui/dom';
import { EventsPanel } from './ui/events';
import { NsocDialog } from './ui/nsoc';
import { SitesPanel } from './ui/sites';
import { TimelineBoard } from './ui/timeline';
import { view } from './ui/view';

type Tab = 'board' | 'events' | 'sites' | 'map';
const mobile = () => innerWidth <= 900;

importSharedGroup();

// ── Panels ──────────────────────────────────────────────────────────────
const events = new EventsPanel();
const converter = new Converter((p) => {
  setTab('events');
  events.openForm(p);
});
const timeline = new TimelineBoard();
const sites = new SitesPanel(() => setTab('sites'));
const nsocDialog = new NsocDialog();

$('#pane-board').append(converter.el, timeline.el);
$('#pane-events').append(events.el);
$('#pane-sites').append(sites.el);

// ── Map (lazy on phones, never fatal) ───────────────────────────────────
let globe: Globe | null = null;
let places: PlacesLayer | null = null;
let globeFailed = false;
let mapLoading: Promise<void> | null = null;
const clock = new SimClock();

function ensureMap(): Promise<void> {
  mapLoading ??= loadMap();
  return mapLoading;
}

async function loadMap(): Promise<void> {
  if (globe || globeFailed) return;
  try {
    const [{ Globe }, { PlacesLayer }] = await Promise.all([import('./globe/Globe'), import('./globe/places')]);
    globe = new Globe($('#globe'), clock);
    places = new PlacesLayer(globe);
    globe.setTheme(store.get().theme);
    globe.onClick((e) => {
      const hit = places!.pick(e.x, e.y);
      if (hit) {
        if (hit.id !== 'nsoc') view.fly(offsetMinutes(hit.tz, Date.now()));
        return;
      }
      if (e.lat !== null && e.lon !== null) void sites.proposeAt(e.lat, e.lon);
    });
    globe.onPointerMove((x, y) => {
      const p = places!.pick(x, y);
      places!.hover(p?.id ?? null);
      globe!.renderer.domElement.style.cursor = p ? 'pointer' : '';
    });
    refreshMarkers();
    globe.ready.then(() => fitGroup(1));
  } catch (err) {
    console.error(err);
    globeFailed = true;
    $('#globe').replaceChildren(h('div', { class: 'no-webgl' }, h('b', {}, 'Map unavailable'), h('span', {}, 'This browser has WebGL turned off. The board, converter and events all still work.')));
  }
}

function refreshMarkers(): void {
  if (!places) return;
  const s = store.get();
  const t = view.get().eventAt ?? Date.now();
  const rows = buildRows(store.activeGroup(), s.nsoc, t);
  const specs: MarkerSpec[] = [];
  const isNsoc = (p: { tz: string; lat: number; lon: number }) => p.tz === s.nsoc.tz && Math.abs(p.lat - s.nsoc.lat) < 0.05 && Math.abs(p.lon - s.nsoc.lon) < 0.05;
  for (const r of rows) {
    // The NSOC has its own marker; don't draw a second pin for it as a site.
    const sitesHere = r.sites.filter((x) => !isNsoc(x.place));
    sitesHere.forEach((site, i) => specs.push({ place: site.place, color: slotColor(r.slot, s.theme), key: r.key, lead: i === 0 }));
  }
  places.setPlaces(specs, s.nsoc);
  places.focus(view.get().focusKey);
}

function fitGroup(duration = 1400): void {
  if (!globe) return;
  const s = store.get();
  const g = store.activeGroup();
  globe.fitPlaces(g.places.length ? [...g.places, s.nsoc] : [s.nsoc], duration);
}

// ── Tabs (phone) and side tabs (desktop) ────────────────────────────────
function setTab(tab: Tab): void {
  document.body.dataset.tab = tab;
  document.querySelectorAll<HTMLButtonElement>('.tabbar [data-tab]').forEach((b) => b.toggleAttribute('aria-current', b.dataset.tab === tab));
  if (tab === 'events' || tab === 'sites') setSide(tab);
  if (tab === 'map' || !mobile()) void ensureMap();
}
function setSide(side: 'events' | 'sites'): void {
  document.body.dataset.side = side;
  document.querySelectorAll<HTMLButtonElement>('.side-tabs [data-side]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.side === side)));
}
document.querySelectorAll<HTMLButtonElement>('.tabbar [data-tab]').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab as Tab)));
document.querySelectorAll<HTMLButtonElement>('.side-tabs [data-side]').forEach((b) => b.addEventListener('click', () => setSide(b.dataset.side as 'events' | 'sites')));
document.querySelectorAll<HTMLButtonElement>('[data-goto]').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.goto as Tab)));
setSide('events');
setTab('board');

// ── Header: NSOC clock, next event, group picker, theme ────────────────
const nsocBtn = $('#nsoc-clock');
nsocBtn.addEventListener('click', () => nsocDialog.open());
const nextBtn = $('#next-event') as HTMLButtonElement;
nextBtn.addEventListener('click', () => {
  const n = events.next(Date.now());
  if (n) view.set({ eventAt: n.start, eventTitle: n.ev.title });
  setTab('board');
});

const groupSel = $('#group-select') as HTMLSelectElement;
groupSel.addEventListener('change', () => store.update((d) => (d.activeGroupId = groupSel.value)));
function renderGroupSelect(): void {
  const s = store.get();
  groupSel.replaceChildren(...s.groups.map((g) => {
    const o = h('option', { value: g.id }, `${g.name} · ${g.places.length} sites`);
    o.selected = g.id === s.activeGroupId;
    return o;
  }));
}

const themeButtons = document.querySelectorAll<HTMLButtonElement>('[data-theme-btn]');
themeButtons.forEach((b) => b.addEventListener('click', () => store.update((d) => (d.theme = b.dataset.themeBtn as Theme))));
function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  themeButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themeBtn === theme)));
  globe?.setTheme(theme);
}

store.subscribe((s, prev) => {
  renderGroupSelect();
  if (s.theme !== prev.theme) applyTheme(s.theme);
  refreshMarkers();
  if (s.activeGroupId !== prev.activeGroupId || s.nsoc.tz !== prev.nsoc.tz || s.nsoc.name !== prev.nsoc.name) fitGroup();
});
view.subscribe((v, prev) => {
  globe?.setPreviewTime(v.hoverAt ?? v.eventAt);
  if (v.eventAt !== prev.eventAt) refreshMarkers();
  if (v.focusKey !== prev.focusKey) places?.focus(v.focusKey);
  if (v.flySeq !== prev.flySeq && globe && v.focusKey !== null) {
    const ps = store.activeGroup().places.filter((p) => offsetMinutes(p.tz, v.eventAt ?? Date.now()) === v.focusKey);
    if (ps.length) globe.fitPlaces(ps);
    if (mobile()) setTab('map');
  }
});
renderGroupSelect();
applyTheme(store.get().theme);

// ── One loop drives every clock on the page ────────────────────────────
let lastSecond = -1;
function loop(): void {
  const now = Date.now();
  converter.tick(now);
  timeline.tick(now);
  events.tick(now);
  const sec = Math.floor(now / 1000);
  if (sec !== lastSecond) {
    lastSecond = sec;
    const s = store.get();
    const z = zonedParts(s.nsoc.tz, now);
    nsocBtn.replaceChildren(
      h('span', { class: 'nsoc-tag' }, 'NSOC'),
      h('span', { class: 'nsoc-name' }, s.nsoc.name),
      h('span', { class: 'nsoc-time mono' }, `${pad2(z.hour)}:${pad2(z.minute)}`, h('span', { class: 'sec' }, `:${pad2(z.second)}`)),
      h('span', { class: 'nsoc-abbr' }, tzAbbr(s.nsoc.tz, now)),
    );
    const n = events.next(now);
    nextBtn.hidden = !n;
    if (n) {
      nextBtn.className = `next-chip ${n.phase}`;
      nextBtn.replaceChildren(icon(n.phase === 'live' ? 'broadcast' : 'clock', 14), h('span', { class: 'next-title' }, n.ev.title.replace(/^Sample · /, '')), h('b', {}, n.phase === 'live' ? 'LIVE' : countdownLabel(n.start, now)));
    }
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

if (!store.get().nsocConfirmed) setTimeout(() => nsocDialog.open(), 300);

// ── Keyboard ───────────────────────────────────────────────────────────
addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  if (t.closest('input, select, textarea, dialog, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'n' || e.key === 'N') view.set({ eventAt: null, eventTitle: '' });
  if (e.key === 't' || e.key === 'T') store.update((d) => (d.theme = d.theme === 'dark' ? 'cream' : 'dark'));
});

/** #g=<token> imports a shared group (with its hours and events). */
function importSharedGroup(): void {
  const token = new URLSearchParams(location.hash.slice(1)).get('g');
  if (!token) return;
  history.replaceState(null, '', location.pathname + location.search);
  const data = decodeGroup(token);
  if (!data) return void setTimeout(() => toast('That share link looks broken — nothing was imported'), 400);
  const sig = (ps: { name: string; tz: string; shifts?: unknown }[]) => ps.map((p) => p.name + p.tz + JSON.stringify(p.shifts ?? null)).join('|');
  const evKey = (e: { title: string; local: string; tz: string }) => `${e.title}|${e.local}|${e.tz}`;
  const existing = store
    .get()
    .groups.find((g) => g.name === data.name && sig(g.places) === sig(data.places) && JSON.stringify(g.shifts) === JSON.stringify(data.shifts));
  if (existing) {
    // Same group already here: switch to it and add any events it doesn't have yet.
    const have = new Set(store.get().events.filter((e) => e.groupId === existing.id).map(evKey));
    const fresh = data.events.filter((e) => !have.has(evKey(e)));
    store.update((d) => {
      d.activeGroupId = existing.id;
      d.events.push(...fresh.map((e) => ({ ...e, id: uid('e'), groupId: existing.id })));
    });
    setTimeout(() => toast(fresh.length ? `Added ${fresh.length} shared event${fresh.length === 1 ? '' : 's'} to “${existing.name}”` : `Showing “${existing.name}”`), 600);
    return;
  }
  const taken = store.get().groups.some((g) => g.name === data.name);
  const g = makeGroup(taken ? `${data.name} (shared)` : data.name, data.places, data.shifts);
  store.update((d) => {
    d.groups.push(g);
    d.activeGroupId = g.id;
    d.events.push(...data.events.map((e) => ({ ...e, id: uid('e'), groupId: g.id })));
  });
  setTimeout(() => toast(`Imported “${data.name}”: ${data.places.length} sites, ${data.events.length} events`), 600);
}
