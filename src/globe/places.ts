/**
 * Place markers on the globe: glowing pins, HTML labels that track their
 * pins, and animated arcs from the NSOC to every site in the group.
 */
import * as THREE from 'three';
import { arcPoints, latLonToVec3 } from '../core/geo';
import { pad2, zonedParts } from '../core/tz';
import type { Place } from '../core/types';
import { placeLabels, wantsLabel, type LabelCandidate } from '../map/labels';
import type { MarkerSpec, NearSite } from '../map/types';
import type { Globe } from './Globe';
import { arcFragment, arcVertex } from './shaders';

export type { MarkerSpec } from '../map/types';

interface Marker {
  spec: MarkerSpec;
  pos: THREE.Vector3;
  dot: THREE.Mesh;
  spike: THREE.Line;
  label: HTMLDivElement;
  time: HTMLElement;
  arc: THREE.Line | null;
}

const UP = new THREE.Vector3(0, 0, 1);

export class PlacesLayer {
  readonly group = new THREE.Group();
  private markers: Marker[] = [];
  private home: Marker | null = null;
  private homeRing: THREE.Mesh;
  private focusKey: number | null = null;
  private hoverId: string | null = null;
  private lastSecond = -1;
  private visible = true;
  private dotGeo = new THREE.CircleGeometry(0.0085, 24);
  private elapsed = 0;

  constructor(private readonly globe: Globe) {
    globe.scene.add(this.group);
    this.homeRing = new THREE.Mesh(
      new THREE.RingGeometry(0.014, 0.018, 48),
      new THREE.MeshBasicMaterial({ color: 0xf5a623, transparent: true, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.group.add(this.homeRing);
    globe.onFrame((sim, dt) => this.frame(sim, dt));
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.group.visible = v;
    for (const m of this.all()) m.label.style.display = v ? '' : 'none';
  }

  setPlaces(specs: MarkerSpec[], home: Place): void {
    for (const m of this.all()) this.dispose(m);
    this.markers = specs.map((s) => this.build(s, home));
    this.home = this.build({ place: home, color: '#f5a623', key: Number.NaN, lead: true }, null, true);
    this.lastSecond = -1;
  }

  focus(key: number | null): void {
    this.focusKey = key;
  }

  hover(placeId: string | null): void {
    this.hoverId = placeId;
  }

  /** Every visible marker within `radius` px of a point, nearest first. */
  sitesNear(x: number, y: number, radius: number): NearSite[] {
    const out: NearSite[] = [];
    for (const m of this.all()) {
      const p = this.globe.project(m.pos);
      if (!p.visible) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d <= radius) out.push({ place: m.spec.place, key: m.spec.key, color: m.spec.color, isNsoc: m === this.home, d });
    }
    return out.sort((a, b) => a.d - b.d);
  }

  /** Nearest marker to a screen point, within `radius` pixels. */
  pick(x: number, y: number, radius = 16): Place | null {
    let best: Marker | null = null;
    let bestD = radius;
    for (const m of this.all()) {
      const p = this.globe.project(m.pos);
      if (!p.visible) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestD) {
        bestD = d;
        best = m;
      }
    }
    return best?.spec.place ?? null;
  }

  private all(): Marker[] {
    return this.home ? [...this.markers, this.home] : this.markers;
  }

  private build(spec: MarkerSpec, home: Place | null, isHome = false): Marker {
    const { place, color } = spec;
    const pos = new THREE.Vector3(...latLonToVec3(place.lat, place.lon, 1.0025));
    const normal = pos.clone().normalize();

    const dot = new THREE.Mesh(
      this.dotGeo,
      new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
    );
    dot.position.copy(pos);
    dot.quaternion.setFromUnitVectors(UP, normal);
    if (isHome) dot.scale.setScalar(1.3);
    this.group.add(dot);

    const spike = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([normal.clone(), normal.clone().multiplyScalar(isHome ? 1.05 : 1.03)]),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 }),
    );
    this.group.add(spike);

    let arc: THREE.Line | null = null;
    if (home && !(Math.abs(home.lat - place.lat) < 0.01 && Math.abs(home.lon - place.lon) < 0.01)) {
      const pts = arcPoints(home, place, 72);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts.flat(), 3));
      g.setAttribute('progress', new THREE.Float32BufferAttribute(pts.map((_, i) => i / (pts.length - 1)), 1));
      arc = new THREE.Line(
        g,
        new THREE.ShaderMaterial({
          uniforms: {
            color: { value: new THREE.Color(color) },
            time: { value: 0 },
            opacity: { value: 0.5 },
            offset: { value: Math.random() },
          },
          vertexShader: arcVertex,
          fragmentShader: arcFragment,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      this.group.add(arc);
    }

    const label = document.createElement('div');
    label.className = `globe-label${isHome ? ' is-home' : ''}`;
    label.style.setProperty('--c', color);
    label.innerHTML = `${isHome ? '<span class="tag">NSOC</span>' : ''}<b></b><time></time>`;
    label.querySelector('b')!.textContent = place.name;
    this.globe.overlay.appendChild(label);

    return { spec, pos, dot, spike, label, time: label.querySelector('time')!, arc };
  }

  private dispose(m: Marker): void {
    this.group.remove(m.dot, m.spike);
    (m.dot.material as THREE.Material).dispose();
    m.spike.geometry.dispose();
    (m.spike.material as THREE.Material).dispose();
    if (m.arc) {
      this.group.remove(m.arc);
      m.arc.geometry.dispose();
      (m.arc.material as THREE.Material).dispose();
    }
    m.label.remove();
  }

  private frame(sim: number, dt: number): void {
    if (!this.visible) return;
    this.elapsed += dt;

    const second = Math.floor(sim / 1000);
    if (second !== this.lastSecond) {
      this.lastSecond = second;
      for (const m of this.all()) {
        const z = zonedParts(m.spec.place.tz, sim);
        m.time.textContent = `${pad2(z.hour)}:${pad2(z.minute)}`;
      }
    }

    if (this.home) {
      const pulse = (this.elapsed % 2.4) / 2.4;
      this.homeRing.position.copy(this.home.pos);
      this.homeRing.quaternion.copy(this.home.dot.quaternion);
      this.homeRing.scale.setScalar((1 + pulse * 2.2) * Math.min(1, Math.max(0.4, (this.globe.distance - 1) / 1.8)));
      (this.homeRing.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - pulse);
    }

    // Zoomed in far enough to read a region: label every site (collisions still apply).
    const zoomedIn = this.globe.distance < 2.25;
    // Keep pins a similar on-screen size at every zoom level.
    const zoomScale = Math.min(1, Math.max(0.4, (this.globe.distance - 1) / 1.8));
    const cands: LabelCandidate[] = [];
    const hidden: HTMLElement[] = [];
    for (const m of this.all()) {
      const isHome = m === this.home;
      const focused = this.focusKey !== null && m.spec.key === this.focusKey;
      const dimmed = this.focusKey !== null && !focused && !isHome;
      const hovered = this.hoverId === m.spec.place.id;

      const s = (hovered ? 1.7 : focused ? 1.35 : 1) * (isHome ? 1.3 : 1) * zoomScale;
      m.dot.scale.setScalar(s);
      (m.dot.material as THREE.MeshBasicMaterial).opacity = dimmed ? 0.35 : 1;
      (m.spike.material as THREE.LineBasicMaterial).opacity = dimmed ? 0.25 : 0.85;
      if (m.arc) {
        const u = (m.arc.material as THREE.ShaderMaterial).uniforms;
        u.time.value = this.elapsed;
        u.opacity.value = focused || hovered ? 1 : dimmed ? 0.12 : 0.45;
      }

      const c = { isNsoc: isHome, hovered, focused, lead: m.spec.lead };
      const p = this.globe.project(m.pos);
      if (!wantsLabel(c, this.focusKey !== null, zoomedIn) || !p.visible || p.facing < 0.12) {
        hidden.push(m.label);
        continue;
      }
      cands.push({ ...c, label: m.label, name: m.spec.place.name, x: p.x, y: p.y, opacity: Math.min(1, (p.facing - 0.12) * 5) });
    }
    placeLabels(cands, hidden, this.globe.overlay.clientWidth);
  }
}
