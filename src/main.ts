import '@fontsource-variable/space-grotesk';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/600.css';
import '@fontsource/jetbrains-mono/700.css';
import './styles.css';

import { SimClock } from './core/clock';
import { decodeGroup } from './core/share';
import { makeGroup, store } from './core/store';
import type { Mode, Theme } from './core/types';
import { Globe } from './globe/Globe';
import { PlacesLayer } from './globe/places';
import { SatelliteLayer } from './globe/satellites';
import { BoardPanel } from './ui/board';
import { $, toast } from './ui/dom';
import { OrbitsPanel } from './ui/orbits';
import { TimeBar } from './ui/timebar';

function boot(): void {
  const clock = new SimClock();
  const globeHost = $('#globe');

  let globe: Globe;
  try {
    globe = new Globe(globeHost, clock);
  } catch (err) {
    console.error(err);
    globeHost.innerHTML =
      '<div class="no-webgl"><b>WebGL is unavailable.</b><span>The 3D globe needs a browser with WebGL enabled. The Time Board below still works.</span></div>';
    return;
  }

  importSharedGroup();

  const places = new PlacesLayer(globe);
  const sats = new SatelliteLayer(globe, clock);
  const board = new BoardPanel($('#board-panel'), clock, globe, places);
  const orbits = new OrbitsPanel($('#orbits-panel'), clock, globe, sats);
  const timebar = new TimeBar($('#timebar'), clock);
  // Debug handle for local profiling; stripped from production builds.
  if (import.meta.env.DEV) Object.assign(window, { __tb: { globe, sats, clock } });

  globe.onFrame((sim) => {
    board.tick(sim);
    orbits.tick(sim);
    timebar.tick(sim);
  });

  // Mode + theme
  const modeButtons = document.querySelectorAll<HTMLButtonElement>('[data-mode]');
  const themeButtons = document.querySelectorAll<HTMLButtonElement>('[data-theme-btn]');
  let currentMode: Mode | null = null;

  function applyMode(mode: Mode, animate = true): void {
    if (mode === currentMode) return;
    currentMode = mode;
    document.body.dataset.mode = mode;
    modeButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    $('#board-panel').hidden = mode !== 'board';
    $('#orbits-panel').hidden = mode !== 'orbits';
    places.setVisible(mode === 'board');
    sats.setVisible(mode === 'orbits');
    orbits.setActive(mode === 'orbits');
    globe.setMeridiansVisible(mode === 'board');
    if (mode === 'orbits') {
      globe.setZoomRange(1.25, 24);
      if (animate) {
        const h = store.get().home;
        globe.flyTo(h.lat - 10, h.lon, 4.6, 1800);
      }
    } else {
      globe.setZoomRange(1.22, 6);
      if (animate) board.fitGroup();
    }
    updateHash();
  }

  function applyTheme(theme: Theme): void {
    document.documentElement.dataset.theme = theme;
    themeButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themeBtn === theme)));
    globe.setTheme(theme);
    sats.setTheme(theme);
  }

  modeButtons.forEach((b) =>
    b.addEventListener('click', () => store.update((s) => (s.mode = b.dataset.mode as Mode))),
  );
  themeButtons.forEach((b) =>
    b.addEventListener('click', () => store.update((s) => (s.theme = b.dataset.themeBtn as Theme))),
  );
  store.subscribe((s, prev) => {
    if (s.mode !== prev.mode) applyMode(s.mode);
    if (s.theme !== prev.theme) applyTheme(s.theme);
  });

  // Deep links: #mode=orbits&sat=25544
  const params = new URLSearchParams(location.hash.slice(1));
  const hashMode = params.get('mode');
  if (hashMode === 'orbits' || hashMode === 'board') store.update((s) => (s.mode = hashMode));
  applyTheme(store.get().theme);
  applyMode(store.get().mode, false);
  if (store.get().mode === 'board') {
    // Open on a slow sweep in toward the group.
    globe.ready.then(() => setTimeout(() => !globe.hasInteracted && board.fitGroup(), 900));
  } else {
    const h = store.get().home;
    globe.flyTo(h.lat - 10, h.lon, 4.6, 1);
  }
  const sat = Number(params.get('sat'));
  if (sat) orbits.selectNorad(sat, true);

  globe.ready.then(() => document.body.classList.add('ready'));

  function updateHash(): void {
    const mode = store.get().mode;
    history.replaceState(null, '', mode === 'orbits' ? '#mode=orbits' : location.pathname + location.search);
  }

  // Keep the globe centred in the space the panels leave free.
  const panel = $('#panel');
  const topbar = $('.topbar');
  const timebarEl = $('#timebar');
  const layout = () => {
    const mobile = innerWidth <= 760;
    const pr = panel.getBoundingClientRect();
    globe.setInsets(
      mobile
        ? { left: 0, top: topbar.getBoundingClientRect().bottom, bottom: innerHeight - pr.top }
        : { left: pr.right, top: 60, bottom: innerHeight - timebarEl.getBoundingClientRect().top },
    );
  };
  new ResizeObserver(layout).observe(panel);
  addEventListener('resize', layout);
  panel.addEventListener('transitionend', layout);
  layout();

  // Mobile bottom sheet
  $('#sheet-toggle').addEventListener('click', () => {
    const open = panel.classList.toggle('collapsed');
    $('#sheet-toggle').setAttribute('aria-expanded', String(!open));
  });

  // Keyboard shortcuts
  window.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('input, select, textarea, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return;
    switch (e.key) {
      case ' ':
        e.preventDefault();
        clock.setPaused(!clock.paused);
        break;
      case 'n':
      case 'N':
        clock.reset();
        break;
      case '[':
        timebar.stepRate(-1);
        break;
      case ']':
        timebar.stepRate(1);
        break;
      case 'ArrowLeft':
        clock.shift(e.shiftKey ? -3_600_000 : -900_000);
        break;
      case 'ArrowRight':
        clock.shift(e.shiftKey ? 3_600_000 : 900_000);
        break;
      case '1':
        store.update((s) => (s.mode = 'board'));
        break;
      case '2':
        store.update((s) => (s.mode = 'orbits'));
        break;
      case 't':
      case 'T':
        store.update((s) => (s.theme = s.theme === 'dark' ? 'cream' : 'dark'));
        break;
    }
  });
}

/** #g=<token> adds (or re-activates) a group someone shared. */
function importSharedGroup(): void {
  const params = new URLSearchParams(location.hash.slice(1));
  const token = params.get('g');
  if (!token) return;
  const data = decodeGroup(token);
  history.replaceState(null, '', location.pathname + location.search);
  if (!data) {
    toast('That share link looks broken — nothing was imported');
    return;
  }
  const sig = (ps: { name: string; tz: string }[]) => ps.map((p) => p.name + p.tz).join('|');
  const existing = store.get().groups.find((g) => g.name === data.name && sig(g.places) === sig(data.places));
  if (existing) {
    store.update((s) => {
      s.activeGroupId = existing.id;
      s.mode = 'board';
    });
    return;
  }
  const g = makeGroup(data.name, data.places);
  store.update((s) => {
    s.groups.push(g);
    s.activeGroupId = g.id;
    s.mode = 'board';
  });
  setTimeout(() => toast(`Imported “${data.name}” with ${data.places.length} places`), 600);
}

boot();
