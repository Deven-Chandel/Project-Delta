/**
 * Flat (equirectangular) map on a 2D canvas: NASA day imagery blended into
 * the night-lights image along the live terminator, a faint 15° hour grid,
 * site pins with collision-avoiding labels, pan / wheel / pinch zoom, and
 * horizontal wrap-around so the date line is never an edge.
 */
import { clampView, fitView, project, unproject, wrapLon, zoomAt, minZoom, type FlatView, type Viewport } from '../core/flatproj';
import { subsolarPoint } from '../core/sun';
import { pad2, zonedParts } from '../core/tz';
import type { Place, Theme } from '../core/types';
import { placeLabels, wantsLabel, type LabelCandidate } from './labels';
import type { MapClick, MapView, MarkerSpec, NearSite } from './types';

const DEG = Math.PI / 180;
const MASK_W = 720;
const MASK_H = 360;
/** Zoom (px per degree) above which every site gets a label. */
const ALL_LABELS_K = 13;

interface Pin {
  spec: MarkerSpec;
  isNsoc: boolean;
  label: HTMLDivElement;
  time: HTMLElement;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export class FlatMap implements MapView {
  readonly surface: HTMLCanvasElement;
  readonly ready: Promise<void>;
  private ctx: CanvasRenderingContext2D;
  private overlay: HTMLDivElement;
  private vp: Viewport = { w: 1, h: 1 };
  private view: FlatView = { lon: -95, lat: 52, k: 6 };
  private tween: { from: FlatView; to: FlatView; start: number; dur: number } | null = null;
  private day: HTMLImageElement | null = null;
  private night: HTMLImageElement | null = null;
  /** Day layer for the current frame, masked to daylight (viewport-sized). */
  private dayLayer = document.createElement('canvas');
  private mask = document.createElement('canvas');
  private maskKey = '';
  private maskAt = 0;
  private preview: number | null = null;
  private pins: Pin[] = [];
  private focusKey: number | null = null;
  private hoverId: string | null = null;
  private theme: Theme = 'dark';
  private dirty = true;
  private active = false;
  private raf = 0;
  private lastMinute = -1;
  private pointers = new Map<number, { x: number; y: number }>();
  private down: { x: number; y: number; t: number; moved: boolean } | null = null;
  private pinchDist = 0;
  /** Last fit request, replayed once the map first gets a real size. */
  private pendingFit: { lat: number; lon: number }[] | null = null;
  /** A single click waits briefly so a double-click (zoom) doesn't also count as clicks. */
  private clickTimer: ReturnType<typeof setTimeout> | null = null;
  private clickFns: ((e: MapClick) => void)[] = [];
  private moveFns: ((x: number, y: number) => void)[] = [];
  private leaveFns: (() => void)[] = [];

  constructor(private readonly container: HTMLElement) {
    this.surface = document.createElement('canvas');
    this.surface.className = 'flat-canvas';
    this.surface.setAttribute('aria-label', 'Flat map of your sites');
    this.ctx = this.surface.getContext('2d')!;
    this.overlay = document.createElement('div');
    this.overlay.className = 'globe-overlay';
    container.append(this.surface, this.overlay);
    this.mask.width = MASK_W;
    this.mask.height = MASK_H;
    const base = import.meta.env.BASE_URL;
    this.ready = Promise.all([loadImage(`${base}textures/earth-day.jpg`), loadImage(`${base}textures/earth-night.jpg`)]).then(([d, n]) => {
      this.day = d;
      this.night = n;
      this.maskKey = '';
      this.dirty = true;
    });
    this.bind();
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  // ── MapView ─────────────────────────────────────────────────────────
  setTheme(theme: Theme): void {
    this.theme = theme;
    this.dirty = true;
  }

  setPlaces(specs: MarkerSpec[], nsoc: Place): void {
    for (const p of this.pins) p.label.remove();
    const all = [...specs.map((s) => ({ spec: s, isNsoc: false })), { spec: { place: nsoc, color: '#f5a623', key: Number.NaN, lead: true }, isNsoc: true }];
    this.pins = all.map(({ spec, isNsoc }) => {
      const label = document.createElement('div');
      label.className = `globe-label${isNsoc ? ' is-home' : ''}`;
      label.style.setProperty('--c', spec.color);
      label.innerHTML = `${isNsoc ? '<span class="tag">NSOC</span>' : ''}<b></b><time></time>`;
      label.querySelector('b')!.textContent = spec.place.name;
      this.overlay.appendChild(label);
      return { spec, isNsoc, label, time: label.querySelector('time')! };
    });
    this.lastMinute = -1;
    this.dirty = true;
  }

  focus(key: number | null): void {
    this.focusKey = key;
    this.dirty = true;
  }

  hover(placeId: string | null): void {
    if (this.hoverId === placeId) return;
    this.hoverId = placeId;
    this.dirty = true;
  }

  sitesNear(x: number, y: number, radius: number): NearSite[] {
    const out: NearSite[] = [];
    for (const p of this.pins) {
      const s = project(p.spec.place.lat, p.spec.place.lon, this.view, this.vp);
      const d = Math.hypot(s.x - x, s.y - y);
      if (d <= radius) out.push({ place: p.spec.place, key: p.spec.key, color: p.spec.color, isNsoc: p.isNsoc, d });
    }
    return out.sort((a, b) => a.d - b.d);
  }

  fit(points: { lat: number; lon: number }[], duration = 700): void {
    if (this.vp.w <= 1 || this.vp.h <= 1) {
      this.pendingFit = points;
      return;
    }
    const to = fitView(points, this.vp, 56);
    if (duration <= 1 || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.view = to;
      this.tween = null;
    } else {
      this.tween = { from: { ...this.view }, to, start: performance.now(), dur: duration };
    }
    this.dirty = true;
  }

  setPreviewTime(t: number | null): void {
    this.preview = t;
  }

  setActive(active: boolean): void {
    this.active = active;
    cancelAnimationFrame(this.raf);
    if (active) {
      this.dirty = true;
      this.raf = requestAnimationFrame(() => this.frame());
    }
  }

  onClick(fn: (e: MapClick) => void): void {
    this.clickFns.push(fn);
  }
  onPointerMove(fn: (x: number, y: number) => void): void {
    this.moveFns.push(fn);
  }
  onPointerLeave(fn: () => void): void {
    this.leaveFns.push(fn);
  }

  // ── Rendering ───────────────────────────────────────────────────────
  private resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    const first = this.vp.w <= 1;
    this.vp = { w, h };
    const dpr = Math.min(devicePixelRatio, 2);
    this.surface.width = Math.round(w * dpr);
    this.surface.height = Math.round(h * dpr);
    this.surface.style.width = `${w}px`;
    this.surface.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.dayLayer.width = this.surface.width;
    this.dayLayer.height = this.surface.height;
    this.dayLayer.getContext('2d')!.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.view = clampView(first ? { ...this.view, k: Math.max(this.view.k, minZoom(this.vp)) } : this.view, this.vp);
    this.dirty = true;
    if (this.pendingFit) {
      const pts = this.pendingFit;
      this.pendingFit = null;
      this.fit(pts, 1);
    }
  }

  private frame(): void {
    if (!this.active) return;
    const now = performance.now();
    if (this.tween) {
      const f = Math.min(1, (now - this.tween.start) / this.tween.dur);
      const e = f < 0.5 ? 4 * f * f * f : 1 - Math.pow(-2 * f + 2, 3) / 2;
      const { from, to } = this.tween;
      this.view = clampView(
        { lon: from.lon + wrapLon(to.lon - from.lon) * e, lat: from.lat + (to.lat - from.lat) * e, k: from.k * Math.pow(to.k / from.k, e) },
        this.vp,
      );
      if (f >= 1) this.tween = null;
      this.dirty = true;
    }
    const t = this.preview ?? Date.now();
    const key = String(Math.floor(t / 60_000));
    if (key !== this.maskKey && now - this.maskAt > 120) {
      this.maskKey = key;
      this.maskAt = now;
      this.updateMask(t);
      this.dirty = true;
    }
    const minute = Math.floor(t / 60_000);
    if (minute !== this.lastMinute) {
      this.lastMinute = minute;
      for (const p of this.pins) {
        const z = zonedParts(p.spec.place.tz, t);
        p.time.textContent = `${pad2(z.hour)}:${pad2(z.minute)}`;
      }
      this.dirty = true;
    }
    if (this.dirty) {
      this.dirty = false;
      this.draw();
      this.placeLabels();
    }
    this.raf = requestAnimationFrame(() => this.frame());
  }

  /** Daylight alpha mask (1 = sun up) on a 0.5° grid; smoothed when scaled up. */
  private updateMask(t: number): void {
    const s = subsolarPoint(t);
    const mctx = this.mask.getContext('2d')!;
    const img = mctx.createImageData(MASK_W, MASK_H);
    const sinS = Math.sin(s.lat * DEG);
    const cosS = Math.cos(s.lat * DEG);
    const cosLon = new Float32Array(MASK_W);
    for (let x = 0; x < MASK_W; x++) cosLon[x] = Math.cos((((x + 0.5) / MASK_W) * 360 - 180 - s.lon) * DEG);
    for (let y = 0; y < MASK_H; y++) {
      const lat = (90 - ((y + 0.5) / MASK_H) * 180) * DEG;
      const a = Math.sin(lat) * sinS;
      const b = Math.cos(lat) * cosS;
      for (let x = 0; x < MASK_W; x++) {
        const f = Math.min(1, Math.max(0, (a + b * cosLon[x] + 0.1) / 0.2));
        img.data[(y * MASK_W + x) * 4 + 3] = Math.round(f * f * (3 - 2 * f) * 255);
      }
    }
    mctx.putImageData(img, 0, 0);
  }

  /** Draw an equirectangular image across every horizontal copy of the world in view. */
  private tile(ctx: CanvasRenderingContext2D, img: CanvasImageSource): void {
    const { vp, view } = this;
    const worldW = 360 * view.k;
    const top = vp.h / 2 - (90 - view.lat) * view.k;
    let left = vp.w / 2 + (-180 - view.lon) * view.k;
    while (left > 0) left -= worldW;
    for (let x = left; x < vp.w; x += worldW) ctx.drawImage(img, x, top, worldW, 180 * view.k);
  }

  private draw(): void {
    const { ctx, vp, view } = this;
    const cream = this.theme === 'cream';
    ctx.clearRect(0, 0, vp.w, vp.h);
    ctx.fillStyle = cream ? '#d9d0bc' : '#05070c';
    ctx.fillRect(0, 0, vp.w, vp.h);

    // Night side: dimmed day imagery plus city lights; day side: full imagery
    // masked to where the sun is up. Drawn from the full-resolution textures.
    const worldW = 360 * view.k;
    const top = vp.h / 2 - (90 - view.lat) * view.k;
    ctx.imageSmoothingEnabled = true;
    if (this.day) {
      ctx.globalAlpha = 0.16;
      this.tile(ctx, this.day);
      ctx.globalAlpha = 1;
      if (this.night) {
        ctx.globalCompositeOperation = 'lighter';
        this.tile(ctx, this.night);
        ctx.globalCompositeOperation = 'source-over';
      }
      const dl = this.dayLayer.getContext('2d')!;
      dl.globalCompositeOperation = 'source-over';
      dl.clearRect(0, 0, vp.w, vp.h);
      dl.imageSmoothingEnabled = true;
      this.tile(dl, this.day);
      dl.globalCompositeOperation = 'destination-in';
      this.tile(dl, this.mask);
      dl.globalCompositeOperation = 'source-over';
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(this.dayLayer, 0, 0);
      ctx.restore();
    }

    // Hour grid: a meridian every 15° is one hour of Earth's rotation.
    ctx.strokeStyle = cream ? 'rgba(60,45,25,0.18)' : 'rgba(160,180,210,0.10)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let lon = -180; lon < 180; lon += 15) {
      for (let x = vp.w / 2 + wrapLon(lon - view.lon) * view.k - worldW; x < vp.w + worldW; x += worldW) {
        if (x < -1 || x > vp.w + 1) continue;
        ctx.moveTo(Math.round(x) + 0.5, Math.max(0, top));
        ctx.lineTo(Math.round(x) + 0.5, Math.min(vp.h, top + 180 * view.k));
      }
    }
    ctx.stroke();

    // Pins: 2px surface ring keeps overlapping dots distinct.
    const ring = cream ? '#fbf8f0' : '#0a0e16';
    for (const p of this.pins) {
      const s = project(p.spec.place.lat, p.spec.place.lon, view, vp);
      if (s.x < -20 || s.x > vp.w + 20 || s.y < -20 || s.y > vp.h + 20) continue;
      const focused = this.focusKey !== null && p.spec.key === this.focusKey;
      const dimmed = this.focusKey !== null && !focused && !p.isNsoc;
      const hovered = this.hoverId === p.spec.place.id;
      const r = (p.isNsoc ? 6 : 4.5) * (hovered ? 1.45 : focused ? 1.2 : 1);
      ctx.globalAlpha = dimmed ? 0.35 : 1;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r + 2, 0, Math.PI * 2);
      ctx.fillStyle = ring;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.fillStyle = p.spec.color;
      ctx.fill();
      if (p.isNsoc) {
        ctx.beginPath();
        ctx.arc(s.x, s.y, r + 5, 0, Math.PI * 2);
        ctx.strokeStyle = p.spec.color;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  private placeLabels(): void {
    const { vp, view } = this;
    const cands: LabelCandidate[] = [];
    const hidden: HTMLElement[] = [];
    for (const p of this.pins) {
      const s = project(p.spec.place.lat, p.spec.place.lon, view, vp);
      const c = { isNsoc: p.isNsoc, hovered: this.hoverId === p.spec.place.id, focused: this.focusKey !== null && p.spec.key === this.focusKey, lead: p.spec.lead };
      if (!wantsLabel(c, this.focusKey !== null, view.k >= ALL_LABELS_K) || s.x < 0 || s.x > vp.w || s.y < 0 || s.y > vp.h) {
        hidden.push(p.label);
        continue;
      }
      cands.push({ ...c, label: p.label, name: p.spec.place.name, x: s.x, y: s.y });
    }
    placeLabels(cands, hidden, vp.w);
  }

  // ── Interaction ─────────────────────────────────────────────────────
  private bind(): void {
    const el = this.surface;
    el.style.touchAction = 'none';
    const local = (e: PointerEvent | WheelEvent | MouseEvent) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, local(e));
      this.tween = null;
      if (this.pointers.size === 1) this.down = { ...local(e), t: performance.now(), moved: false };
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.down) this.down.moved = true;
      }
    });
    el.addEventListener('pointermove', (e) => {
      const p = local(e);
      const prev = this.pointers.get(e.pointerId);
      if (!prev) {
        if (e.pointerType === 'mouse') for (const fn of this.moveFns) fn(p.x, p.y);
        return;
      }
      if (this.pointers.size === 1) {
        const dx = p.x - prev.x;
        const dy = p.y - prev.y;
        if (this.down && Math.hypot(p.x - this.down.x, p.y - this.down.y) > 5) this.down.moved = true;
        if (this.down?.moved) {
          this.view = clampView({ ...this.view, lon: this.view.lon - dx / this.view.k, lat: this.view.lat + dy / this.view.k }, this.vp);
          this.dirty = true;
          el.style.cursor = 'grabbing';
        }
      } else if (this.pointers.size === 2) {
        this.pointers.set(e.pointerId, p);
        const [a, b] = [...this.pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.pinchDist > 0) {
          this.view = zoomAt(this.view, this.vp, (a.x + b.x) / 2, (a.y + b.y) / 2, dist / this.pinchDist);
          this.dirty = true;
        }
        this.pinchDist = dist;
        return;
      }
      this.pointers.set(e.pointerId, p);
    });
    const end = (e: PointerEvent) => {
      const d = this.down;
      const p = local(e);
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinchDist = 0;
      el.style.cursor = '';
      if (this.pointers.size === 0) {
        this.down = null;
        if (d && !d.moved && performance.now() - d.t < 600 && e.type === 'pointerup') {
          if (this.clickTimer) {
            // Second click of a double-click: the dblclick handler zooms instead.
            clearTimeout(this.clickTimer);
            this.clickTimer = null;
            return;
          }
          this.clickTimer = setTimeout(() => {
            this.clickTimer = null;
            const ll = unproject(p.x, p.y, this.view, this.vp);
            const onWorld = p.y >= this.vp.h / 2 - (90 - this.view.lat) * this.view.k && p.y <= this.vp.h / 2 - (-90 - this.view.lat) * this.view.k;
            for (const fn of this.clickFns) fn({ x: p.x, y: p.y, lat: onWorld ? ll.lat : null, lon: onWorld ? ll.lon : null });
          }, 260);
        }
      }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse' && this.pointers.size === 0) for (const fn of this.leaveFns) fn();
    });
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const p = local(e);
        this.tween = null;
        this.view = zoomAt(this.view, this.vp, p.x, p.y, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
        this.dirty = true;
      },
      { passive: false },
    );
    el.addEventListener('dblclick', (e) => {
      if (this.clickTimer) clearTimeout(this.clickTimer);
      this.clickTimer = null;
      this.tween = null;
      const p = local(e);
      this.view = zoomAt(this.view, this.vp, p.x, p.y, 2);
      this.dirty = true;
    });
  }
}
