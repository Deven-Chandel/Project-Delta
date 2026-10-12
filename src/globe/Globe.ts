/**
 * The 3D scene: Earth, atmosphere, stars, sun, and the camera rig.
 *
 * Earth never rotates; it is the Earth-fixed frame. The sun direction follows
 * the clock, or a preview time while the controller hovers the timeline or
 * converts an event, so the terminator shows daylight at that moment.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { latLonToVec3, vec3ToLatLon } from '../core/geo';
import { subsolarPoint } from '../core/sun';
import type { SimClock } from '../core/clock';
import type { Theme } from '../core/types';
import {
  atmosphereFragment,
  atmosphereVertex,
  earthFragment,
  earthVertex,
  starsFragment,
  starsVertex,
} from './shaders';

export type FrameCallback = (simTime: number, dt: number) => void;

interface Flight {
  from: THREE.Vector3;
  to: THREE.Vector3;
  fromDist: number;
  toDist: number;
  start: number;
  duration: number;
}

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

export class Globe {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;
  readonly overlay: HTMLDivElement;
  readonly earth: THREE.Mesh;
  readonly sunDir = new THREE.Vector3(1, 0, 0);

  private earthMat: THREE.ShaderMaterial;
  private atmoMat: THREE.ShaderMaterial;
  private stars: THREE.Points;
  private starsMat: THREE.ShaderMaterial;
  private sun: THREE.Sprite;
  private meridians: THREE.LineSegments;
  private frameCallbacks = new Set<FrameCallback>();
  private flight: Flight | null = null;
  private lastFrame = performance.now();
  private raycaster = new THREE.Raycaster();
  private pointerDown: { x: number; y: number; t: number } | null = null;
  private clickHandlers = new Set<(e: { x: number; y: number; lat: number | null; lon: number | null }) => void>();
  private moveHandlers = new Set<(x: number, y: number) => void>();
  private leaveHandlers = new Set<() => void>();
  private interacted = false;
  private insets = { left: 0, top: 0, bottom: 0 };
  private previewTime: number | null = null;
  ready: Promise<void>;

  constructor(
    private readonly container: HTMLElement,
    private readonly clock: SimClock,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x05070c);
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.setAttribute('aria-label', 'Interactive 3D globe');

    this.overlay = document.createElement('div');
    this.overlay.className = 'globe-overlay';
    container.appendChild(this.overlay);

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.01, 400);
    this.camera.position.set(...latLonToVec3(38, -85, 3.1));

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.enablePan = false;
    this.controls.minDistance = 1.22;
    this.controls.maxDistance = 6;
    this.controls.autoRotate = false;
    this.controls.autoRotateSpeed = 0.35;
    this.controls.addEventListener('start', () => {
      this.flight = null;
      this.interacted = true;
      this.controls.autoRotate = false;
    });

    // Earth
    const loader = new THREE.TextureLoader();
    const tex = (url: string, srgb: boolean) =>
      new Promise<THREE.Texture>((resolve) => {
        loader.load(
          url,
          (t) => {
            t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
            t.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
            resolve(t);
          },
          undefined,
          () => resolve(new THREE.Texture()),
        );
      });
    const base = import.meta.env.BASE_URL;
    const day = tex(`${base}textures/earth-day.jpg`, true);
    const night = tex(`${base}textures/earth-night.jpg`, true);
    const water = tex(`${base}textures/earth-water.jpg`, false);

    this.earthMat = new THREE.ShaderMaterial({
      uniforms: {
        dayMap: { value: null },
        nightMap: { value: null },
        waterMap: { value: null },
        sunDir: { value: this.sunDir },
        cream: { value: 0 },
      },
      vertexShader: earthVertex,
      fragmentShader: earthFragment,
    });
    this.earth = new THREE.Mesh(new THREE.SphereGeometry(1, 160, 80), this.earthMat);
    this.earth.visible = false;
    this.scene.add(this.earth);

    this.ready = Promise.all([day, night, water]).then(([d, n, w]) => {
      this.earthMat.uniforms.dayMap.value = d;
      this.earthMat.uniforms.nightMap.value = n;
      this.earthMat.uniforms.waterMap.value = w;
      this.earth.visible = true;
    });

    // Atmosphere halo
    this.atmoMat = new THREE.ShaderMaterial({
      uniforms: {
        sunDir: { value: this.sunDir },
        glowColor: { value: new THREE.Color(0x4f9dff) },
        strength: { value: 1.0 },
      },
      vertexShader: atmosphereVertex,
      fragmentShader: atmosphereFragment,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    this.scene.add(new THREE.Mesh(new THREE.SphereGeometry(1.16, 96, 48), this.atmoMat));

    // Stars
    const n = 4200;
    const pos = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const phase = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1;
      const t = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      pos.set([r * Math.cos(t) * 150, u * 150, r * Math.sin(t) * 150], i * 3);
      size[i] = Math.random() < 0.04 ? 2.6 + Math.random() * 1.6 : 0.8 + Math.random() * 1.4;
      phase[i] = Math.random() * 10;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    sg.setAttribute('size', new THREE.BufferAttribute(size, 1));
    sg.setAttribute('phase', new THREE.BufferAttribute(phase, 1));
    this.starsMat = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 }, pixelRatio: { value: this.renderer.getPixelRatio() }, opacity: { value: 1 } },
      vertexShader: starsVertex,
      fragmentShader: starsFragment,
      transparent: true,
      depthWrite: false,
    });
    this.stars = new THREE.Points(sg, this.starsMat);
    this.scene.add(this.stars);

    // Sun glow sprite
    this.sun = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: radialTexture(['rgba(255,244,214,1)', 'rgba(255,196,110,0.35)', 'rgba(255,170,60,0)']),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
      }),
    );
    this.sun.scale.setScalar(16);
    this.scene.add(this.sun);

    // Faint time-zone meridians every 15° (one hour of Earth rotation).
    const mpts: number[] = [];
    for (let lon = -180; lon < 180; lon += 15) {
      for (let lat = -88; lat < 88; lat += 4) {
        mpts.push(...latLonToVec3(lat, lon, 1.0015), ...latLonToVec3(lat + 4, lon, 1.0015));
      }
    }
    const mg = new THREE.BufferGeometry();
    mg.setAttribute('position', new THREE.Float32BufferAttribute(mpts, 3));
    this.meridians = new THREE.LineSegments(
      mg,
      new THREE.LineBasicMaterial({ color: 0x9fb4d0, transparent: true, opacity: 0.07, depthWrite: false }),
    );
    this.scene.add(this.meridians);

    this.bindPointer();
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  onFrame(fn: FrameCallback): () => void {
    this.frameCallbacks.add(fn);
    return () => this.frameCallbacks.delete(fn);
  }

  /** Click (not drag) on the canvas, with the lat/lon under the cursor if it hit Earth. */
  onClick(fn: (e: { x: number; y: number; lat: number | null; lon: number | null }) => void): void {
    this.clickHandlers.add(fn);
  }

  onPointerMove(fn: (x: number, y: number) => void): void {
    this.moveHandlers.add(fn);
  }

  onPointerLeave(fn: () => void): void {
    this.leaveHandlers.add(fn);
  }

  /** Stop rendering while the globe is hidden; resume when shown. */
  setActive(active: boolean): void {
    this.renderer.setAnimationLoop(active ? () => this.frame() : null);
    if (active) this.resize();
  }

  setTheme(theme: Theme): void {
    const cream = theme === 'cream';
    this.renderer.setClearColor(cream ? 0xefe8d8 : 0x05070c);
    this.starsMat.uniforms.opacity.value = cream ? 0 : 1;
    this.earthMat.uniforms.cream.value = cream ? 1 : 0;
    this.atmoMat.uniforms.glowColor.value.set(cream ? 0xd98a3a : 0x4f9dff);
    this.atmoMat.uniforms.strength.value = cream ? 0.9 : 1.0;
    this.atmoMat.blending = cream ? THREE.NormalBlending : THREE.AdditiveBlending;
    this.atmoMat.needsUpdate = true;
    (this.meridians.material as THREE.LineBasicMaterial).color.set(cream ? 0x6b5a3e : 0x9fb4d0);
    (this.meridians.material as THREE.LineBasicMaterial).opacity = cream ? 0.12 : 0.07;
    this.sun.visible = !cream;
  }

  /** Show sunlight at a specific moment (timeline hover, converted event); null = live. */
  setPreviewTime(t: number | null): void {
    this.previewTime = t;
  }

  setMeridiansVisible(v: boolean): void {
    this.meridians.visible = v;
  }

  setZoomRange(min: number, max: number): void {
    this.controls.minDistance = min;
    this.controls.maxDistance = max;
  }

  get distance(): number {
    return this.camera.position.length();
  }

  /** Smoothly fly the camera to look at a lat/lon from `distance` Earth radii. */
  flyTo(lat: number, lon: number, distance = this.distance, duration = 1500): void {
    this.interacted = true;
    this.controls.autoRotate = false;
    const to = new THREE.Vector3(...latLonToVec3(lat, lon)).normalize();
    const from = this.camera.position.clone().normalize();
    if (reducedMotion) duration = 1;
    this.flight = {
      from,
      to,
      fromDist: this.distance,
      toDist: distance,
      start: performance.now(),
      duration,
    };
  }

  /** Frame a set of places: aim at their centroid, back off by their spread. */
  fitPlaces(places: { lat: number; lon: number }[], duration = 1500): void {
    if (places.length === 0) return;
    const c = new THREE.Vector3();
    const vs = places.map((p) => new THREE.Vector3(...latLonToVec3(p.lat, p.lon)));
    vs.forEach((v) => c.add(v));
    if (c.lengthSq() < 1e-6) c.set(...latLonToVec3(20, 0));
    c.normalize();
    const spread = Math.max(...vs.map((v) => v.angleTo(c)));
    const fovHalf = THREE.MathUtils.degToRad(this.camera.fov / 2) * Math.min(1, this.camera.aspect);
    const dist = THREE.MathUtils.clamp(1 + (Math.sin(spread) * 1.5) / Math.tan(fovHalf) + 0.35, 1.6, 4.2);
    const { lat, lon } = vec3ToLatLon([c.x, c.y, c.z]);
    // Bias slightly south so northern places aren't hidden under the top bar.
    this.flyTo(lat - Math.min(8, spread * 10), lon, dist, duration);
  }

  /** Project a world point to overlay pixels; `visible` is false when behind Earth or the camera. */
  project(p: THREE.Vector3): { x: number; y: number; visible: boolean; facing: number } {
    const v = p.clone().project(this.camera);
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const toCam = this.camera.position.clone().sub(p);
    // Facing: how much the surface normal at p points at the camera (for fading labels).
    const facing = p.clone().normalize().dot(toCam.normalize());
    const occluded = rayHitsEarthBefore(this.camera.position, p);
    return {
      x: ((v.x + 1) / 2) * w,
      y: ((1 - v.y) / 2) * h,
      visible: v.z < 1 && !occluded,
      facing,
    };
  }

  latLonAt(x: number, y: number): { lat: number; lon: number } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    // Earth is a unit sphere at the origin, so intersect analytically instead
    // of testing ~25k triangles of the render mesh.
    const { origin: o, direction: d } = this.raycaster.ray;
    const b = o.dot(d);
    const disc = b * b - (o.lengthSq() - 1);
    if (disc < 0) return null;
    const t = -b - Math.sqrt(disc);
    if (t < 0) return null;
    const hit = o.clone().addScaledVector(d, t);
    return vec3ToLatLon([hit.x, hit.y, hit.z]);
  }

  private bindPointer(): void {
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e) => {
      this.pointerDown = { x: e.clientX, y: e.clientY, t: performance.now() };
    });
    el.addEventListener('pointerup', (e) => {
      const d = this.pointerDown;
      this.pointerDown = null;
      if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || performance.now() - d.t > 600) return;
      const rect = el.getBoundingClientRect();
      const ll = this.latLonAt(e.clientX, e.clientY);
      for (const fn of this.clickHandlers)
        fn({ x: e.clientX - rect.left, y: e.clientY - rect.top, lat: ll?.lat ?? null, lon: ll?.lon ?? null });
    });
    el.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse') for (const fn of this.leaveHandlers) fn();
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      const rect = el.getBoundingClientRect();
      for (const fn of this.moveHandlers) fn(e.clientX - rect.left, e.clientY - rect.top);
    });
  }

  /** Screen space covered by UI; the globe is centred in what's left. */
  setInsets(insets: { left: number; top: number; bottom: number }): void {
    this.insets = insets;
    this.resize();
  }

  private resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    const { left, top, bottom } = this.insets;
    this.camera.setViewOffset(w, h, -left / 2, (bottom - top) / 2, w, h);
    this.camera.updateProjectionMatrix();
  }

  private frame(): void {
    const nowReal = performance.now();
    const dt = Math.min(0.1, (nowReal - this.lastFrame) / 1000);
    this.lastFrame = nowReal;
    const sim = this.previewTime ?? this.clock.now();

    const s = subsolarPoint(sim);
    this.sunDir.set(...latLonToVec3(s.lat, s.lon)).normalize();
    this.sun.position.copy(this.sunDir).multiplyScalar(120);
    this.starsMat.uniforms.time.value = nowReal / 1000;

    if (this.flight) this.stepFlight(nowReal);
    // Rotation feels the same at every zoom level.
    this.controls.rotateSpeed = 0.18 + 0.32 * Math.min(1, (this.distance - 1) / 3);
    this.controls.zoomSpeed = 0.6 + 0.4 * Math.min(1, (this.distance - 1) / 3);
    this.controls.update();

    for (const fn of this.frameCallbacks) fn(sim, dt);
    this.renderer.render(this.scene, this.camera);
  }

  private stepFlight(now: number): void {
    const f = this.flight!;
    const t = Math.min(1, (now - f.start) / f.duration);
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const dir = slerp(f.from, f.to, e);
    // Pull back a little mid-flight for a satisfying arc.
    const hop = Math.sin(Math.PI * e) * Math.min(0.8, f.from.angleTo(f.to) * 0.5);
    const dist = THREE.MathUtils.lerp(f.fromDist, f.toDist, e) + hop;
    this.camera.position.copy(dir.multiplyScalar(dist));
    if (t >= 1) this.flight = null;
  }

  get hasInteracted(): boolean {
    return this.interacted;
  }
}

function slerp(a: THREE.Vector3, b: THREE.Vector3, t: number): THREE.Vector3 {
  const omega = a.angleTo(b);
  if (omega < 1e-5) return b.clone();
  const s = Math.sin(omega);
  return a
    .clone()
    .multiplyScalar(Math.sin((1 - t) * omega) / s)
    .add(b.clone().multiplyScalar(Math.sin(t * omega) / s));
}

/** Does the segment camera→p pass through the Earth (unit sphere) before reaching p? */
function rayHitsEarthBefore(cam: THREE.Vector3, p: THREE.Vector3): boolean {
  const d = p.clone().sub(cam);
  const len = d.length();
  d.divideScalar(len);
  const b = cam.dot(d);
  const c = cam.lengthSq() - 1;
  const disc = b * b - c;
  if (disc < 0) return false;
  const t = -b - Math.sqrt(disc);
  return t > 0 && t < len - 1e-3;
}

function radialTexture(stops: string[]): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  stops.forEach((s, i) => grd.addColorStop(i / (stops.length - 1), s));
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
