/**
 * Live satellites as a single GPU point cloud.
 *
 * The worker returns ECI position + velocity snapshots a few times a second;
 * the vertex shader advances each point with a second-order Taylor step under
 * two-body gravity (p + v·dt + ½·a·dt²), so thousands of satellites move
 * smoothly at 60 fps — even at 1000× — without propagating SGP4 every frame.
 */
import * as THREE from 'three';
import { twoline2satrec, type SatRec } from 'satellite.js';
import type { SimClock } from '../core/clock';
import type { Theme } from '../core/types';
import type { WorkerRequest, WorkerResponse } from '../orbits/protocol';
import { orbitRing } from '../orbits/passes';
import { DATASETS, loadDataset, type Tle, type TleSource } from '../orbits/tle';
import type { Globe } from './Globe';

const MU = 398600.4418;
const KM = 1 / 6371;

export interface SatEntry extends Tle {
  dataset: string;
  color: string;
}

export interface DatasetState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  count: number;
  source?: TleSource;
  fetchedAt?: string | null;
  error?: string;
}

export interface SkyItem {
  sat: SatEntry;
  index: number;
  az: number;
  el: number;
  range: number;
}

const satVertex = /* glsl */ `
  attribute vec3 pos0;
  attribute vec3 vel0;
  attribute vec3 color;
  attribute float size;
  uniform float uDt;
  uniform float uPixelRatio;
  varying vec3 vColor;
  void main() {
    vColor = color;
    float r0 = length(pos0);
    if (r0 < 1000.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
    vec3 acc = -${MU.toFixed(4)} * pos0 / (r0 * r0 * r0);
    vec3 p = pos0 + vel0 * uDt + 0.5 * acc * uDt * uDt;
    vec3 tp = vec3(p.x, p.z, -p.y) * ${KM.toExponential(8)};
    vec4 mv = modelViewMatrix * vec4(tp, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = size * uPixelRatio * clamp(3.4 / -mv.z, 0.6, 2.4);
  }
`;

const satFragment = /* glsl */ `
  uniform float uAlpha;
  varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float core = smoothstep(0.5, 0.05, d);
    gl_FragColor = vec4(vColor * (0.55 + 0.9 * core), core * uAlpha);
  }
`;

export class SatelliteLayer {
  readonly datasets = new Map<string, DatasetState>(DATASETS.map((d) => [d.id, { status: 'idle', count: 0 }]));
  sats: SatEntry[] = [];
  selected: number | null = null;
  selectedRec: SatRec | null = null;

  private loaded = new Map<string, { tles: Tle[]; source: TleSource; fetchedAt: string | null }>();
  private enabled = new Set<string>();
  private worker: Worker;
  private generation = 0;
  private inFlight = false;
  private lastRequest = 0;
  private snapshotTime = 0;
  private pos = new Float32Array(0);
  private vel = new Float32Array(0);
  private points: THREE.Points;
  private material: THREE.ShaderMaterial;
  private ring: THREE.Line;
  private ringTime = 0;
  private marker: THREE.Sprite;
  private label: HTMLDivElement;
  private tooltip: HTMLDivElement;
  private visible = false;
  private listeners = new Set<() => void>();
  private skyWaiters = new Map<number, (v: [number, number, number, number][]) => void>();
  private skySeq = 0;

  constructor(
    private readonly globe: Globe,
    private readonly clock: SimClock,
  ) {
    this.worker = new Worker(new URL('../orbits/propagator.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => this.onWorker(e.data);

    this.material = new THREE.ShaderMaterial({
      uniforms: { uDt: { value: 0 }, uPixelRatio: { value: globe.renderer.getPixelRatio() }, uAlpha: { value: 1 } },
      vertexShader: satVertex,
      fragmentShader: satFragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(new THREE.BufferGeometry(), this.material);
    this.points.frustumCulled = false;
    globe.inertial.add(this.points);

    this.ring = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xf5a623, transparent: true, opacity: 0.75, depthWrite: false }),
    );
    this.ring.frustumCulled = false;
    globe.inertial.add(this.ring);

    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    g.strokeStyle = '#f5a623';
    g.lineWidth = 5;
    g.beginPath();
    g.arc(32, 32, 22, 0, Math.PI * 2);
    g.stroke();
    const tex = new THREE.CanvasTexture(c);
    this.marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, sizeAttenuation: false }));
    this.marker.scale.setScalar(0.045);
    this.marker.visible = false;
    globe.scene.add(this.marker);

    this.label = document.createElement('div');
    this.label.className = 'sat-label';
    globe.overlay.appendChild(this.label);
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'sat-tooltip';
    globe.overlay.appendChild(this.tooltip);

    globe.onFrame((sim) => this.frame(sim));
    this.setVisible(false);
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.points.visible = v;
    this.ring.visible = v && this.selected !== null;
    this.marker.visible = v && this.selected !== null;
    this.label.style.display = v ? '' : 'none';
    this.tooltip.style.display = 'none';
  }

  setTheme(theme: Theme): void {
    this.material.blending = theme === 'cream' ? THREE.NormalBlending : THREE.AdditiveBlending;
    this.material.needsUpdate = true;
  }

  async setEnabled(ids: string[]): Promise<void> {
    this.enabled = new Set(ids);
    const missing = ids.filter((id) => !this.loaded.has(id));
    this.rebuild();
    await Promise.all(missing.map((id) => this.load(id)));
  }

  private async load(id: string): Promise<void> {
    const st = this.datasets.get(id)!;
    if (st.status === 'loading') return;
    st.status = 'loading';
    this.emit();
    try {
      const res = await loadDataset(id);
      this.loaded.set(id, res);
      Object.assign(st, { status: 'ready', count: res.tles.length, source: res.source, fetchedAt: res.fetchedAt, error: undefined });
    } catch (err) {
      Object.assign(st, { status: 'error', error: err instanceof Error ? err.message : String(err) });
    }
    this.rebuild();
  }

  /** Merge enabled datasets (first dataset wins for duplicates) and re-seed the worker. */
  private rebuild(): void {
    const prevSelected = this.selected !== null ? this.sats[this.selected]?.norad : null;
    const seen = new Set<number>();
    const sats: SatEntry[] = [];
    for (const d of DATASETS) {
      if (!this.enabled.has(d.id)) continue;
      for (const t of this.loaded.get(d.id)?.tles ?? []) {
        if (seen.has(t.norad)) continue;
        seen.add(t.norad);
        sats.push({ ...t, dataset: d.id, color: d.color });
      }
    }
    this.sats = sats;
    this.generation += 1;
    this.inFlight = false;
    this.pos = new Float32Array(sats.length * 3);
    this.vel = new Float32Array(sats.length * 3);

    const geo = new THREE.BufferGeometry();
    const color = new Float32Array(sats.length * 3);
    const size = new Float32Array(sats.length);
    const c = new THREE.Color();
    sats.forEach((s, i) => {
      c.set(s.color);
      color.set([c.r, c.g, c.b], i * 3);
      size[i] = s.dataset === 'stations' ? 6.5 : s.dataset === 'starlink' ? 2.2 : 3.4;
    });
    geo.setAttribute('pos0', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('vel0', new THREE.BufferAttribute(this.vel, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(color, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
    // A dummy position attribute keeps three.js happy about vertex count.
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(sats.length * 3), 3));
    this.points.geometry.dispose();
    this.points.geometry = geo;

    this.post({ type: 'init', generation: this.generation, tles: sats.map((s) => [s.line1, s.line2]) });

    const idx = prevSelected != null ? sats.findIndex((s) => s.norad === prevSelected) : -1;
    if (idx >= 0) this.select(idx, false);
    else if (this.selected !== null) this.select(null);
    this.emit();
  }

  select(index: number | null, notify = true): void {
    this.selected = index;
    this.selectedRec = null;
    if (index !== null && this.sats[index]) {
      try {
        this.selectedRec = twoline2satrec(this.sats[index].line1, this.sats[index].line2);
      } catch {
        this.selectedRec = null;
      }
      this.label.textContent = this.sats[index].name;
      this.label.style.setProperty('--c', this.sats[index].color);
      this.updateRing(this.clock.now());
    }
    this.ring.visible = this.visible && index !== null;
    this.marker.visible = this.visible && index !== null;
    this.label.classList.toggle('show', index !== null);
    if (notify) this.emit();
  }

  findByNorad(norad: number): number {
    return this.sats.findIndex((s) => s.norad === norad);
  }

  /** Current position of satellite i in world coordinates (extrapolated like the shader). */
  worldPosition(i: number, sim: number, out = new THREE.Vector3()): THREE.Vector3 | null {
    const x = this.pos[i * 3];
    const y = this.pos[i * 3 + 1];
    const z = this.pos[i * 3 + 2];
    const r = Math.hypot(x, y, z);
    if (r < 1000) return null;
    const dt = (sim - this.snapshotTime) / 1000;
    const k = (-MU / (r * r * r)) * 0.5 * dt * dt;
    const px = x + this.vel[i * 3] * dt + k * x;
    const py = y + this.vel[i * 3 + 1] * dt + k * y;
    const pz = z + this.vel[i * 3 + 2] * dt + k * z;
    out.set(px * KM, pz * KM, -py * KM);
    return out.applyMatrix4(this.globe.inertial.matrixWorld);
  }

  /** Unit normal of satellite i's orbital plane, in world coordinates. */
  orbitNormal(i: number): THREE.Vector3 | null {
    const r = new THREE.Vector3(this.pos[i * 3], this.pos[i * 3 + 2], -this.pos[i * 3 + 1]);
    const v = new THREE.Vector3(this.vel[i * 3], this.vel[i * 3 + 2], -this.vel[i * 3 + 1]);
    if (r.lengthSq() < 1) return null;
    return r.cross(v).normalize().transformDirection(this.globe.inertial.matrixWorld);
  }

  pick(x: number, y: number, radius = 14): number | null {
    if (!this.visible) return null;
    const sim = this.clock.now();
    const v = new THREE.Vector3();
    let best: number | null = null;
    let bestD = radius;
    for (let i = 0; i < this.sats.length; i++) {
      if (!this.worldPosition(i, sim, v)) continue;
      const p = this.globe.project(v);
      if (!p.visible) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      // Prefer bigger targets (stations) when overlapping.
      const bias = this.sats[i].dataset === 'stations' ? 4 : 0;
      if (d - bias < bestD) {
        bestD = d - bias;
        best = i;
      }
    }
    return best;
  }

  hover(x: number, y: number): void {
    if (!this.visible) return;
    const i = this.pick(x, y, 10);
    if (i === null || i === this.selected) {
      this.tooltip.style.display = 'none';
      this.globe.renderer.domElement.style.cursor = '';
      return;
    }
    this.tooltip.textContent = this.sats[i].name;
    this.tooltip.style.display = 'block';
    this.tooltip.style.transform = `translate3d(${x + 14}px, ${y - 10}px, 0)`;
    this.globe.renderer.domElement.style.cursor = 'pointer';
  }

  /** Satellites above the horizon for an observer, from the worker. */
  sky(lat: number, lon: number): Promise<SkyItem[]> {
    const id = ++this.skySeq;
    const gen = this.generation;
    return new Promise((resolve) => {
      this.skyWaiters.set(id, (visible) => {
        if (gen !== this.generation) return resolve([]);
        resolve(
          visible
            .filter(([i]) => this.sats[i])
            .map(([i, az, el, range]) => ({ sat: this.sats[i], index: i, az, el, range })),
        );
      });
      this.post({ type: 'sky', generation: id, time: this.clock.now(), lat, lon });
    });
  }

  private post(msg: WorkerRequest): void {
    this.worker.postMessage(msg);
  }

  private onWorker(msg: WorkerResponse): void {
    if (msg.type === 'sky') {
      const fn = this.skyWaiters.get(msg.generation);
      this.skyWaiters.delete(msg.generation);
      fn?.(msg.visible);
      return;
    }
    if (msg.generation !== this.generation) return;
    if (msg.type === 'ready') {
      this.requestStep();
      return;
    }
    this.inFlight = false;
    if (msg.pos.length !== this.pos.length) return;
    this.pos.set(msg.pos);
    this.vel.set(msg.vel);
    this.snapshotTime = msg.time;
    const g = this.points.geometry;
    g.getAttribute('pos0').needsUpdate = true;
    g.getAttribute('vel0').needsUpdate = true;
  }

  private requestStep(): void {
    if (this.sats.length === 0) return;
    this.inFlight = true;
    this.lastRequest = performance.now();
    this.post({ type: 'step', generation: this.generation, time: this.clock.now() });
  }

  private updateRing(sim: number): void {
    if (!this.selectedRec) return;
    const pts = orbitRing(this.selectedRec, sim);
    const arr = new Float32Array(pts.length * 3);
    pts.forEach(([x, y, z], i) => arr.set([x * KM, z * KM, -y * KM], i * 3));
    this.ring.geometry.dispose();
    this.ring.geometry = new THREE.BufferGeometry();
    this.ring.geometry.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    (this.ring.material as THREE.LineBasicMaterial).color.set(this.sats[this.selected!]?.color ?? '#f5a623');
    this.ringTime = sim;
  }

  private frame(sim: number): void {
    if (!this.visible || this.sats.length === 0) return;
    const dt = (sim - this.snapshotTime) / 1000;
    this.material.uniforms.uDt.value = dt;

    const rate = Math.abs(this.clock.rate);
    const interval = this.clock.paused ? 800 : rate <= 1 ? 1000 : rate <= 60 ? 300 : 120;
    if (!this.inFlight && (performance.now() - this.lastRequest > interval || Math.abs(dt) > 90)) this.requestStep();

    if (this.selected !== null) {
      // Orbits precess; refresh the ring every ~20 simulated minutes.
      if (Math.abs(sim - this.ringTime) > 20 * 60_000) this.updateRing(sim);
      const wp = this.worldPosition(this.selected, sim);
      if (wp) {
        this.marker.position.copy(wp);
        const p = this.globe.project(wp);
        this.label.style.transform = `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0)`;
        this.label.style.opacity = p.visible ? '1' : '0.25';
      }
    }
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}
