/**
 * The 3D globe behind the shared MapView interface.
 */
import type { SimClock } from '../core/clock';
import type { Place, Theme } from '../core/types';
import { Globe } from '../globe/Globe';
import { PlacesLayer } from '../globe/places';
import type { MapClick, MapView, MarkerSpec, NearSite } from './types';

export class GlobeMap implements MapView {
  readonly surface: HTMLElement;
  readonly ready: Promise<void>;
  private globe: Globe;
  private places: PlacesLayer;

  constructor(container: HTMLElement, clock: SimClock) {
    this.globe = new Globe(container, clock);
    this.places = new PlacesLayer(this.globe);
    this.surface = this.globe.renderer.domElement;
    this.ready = this.globe.ready;
  }

  setTheme(theme: Theme): void {
    this.globe.setTheme(theme);
  }
  setPlaces(specs: MarkerSpec[], nsoc: Place): void {
    this.places.setPlaces(specs, nsoc);
  }
  focus(key: number | null): void {
    this.places.focus(key);
  }
  hover(placeId: string | null): void {
    this.places.hover(placeId);
  }
  sitesNear(x: number, y: number, radius: number): NearSite[] {
    return this.places.sitesNear(x, y, radius);
  }
  fit(points: { lat: number; lon: number }[], duration = 1400): void {
    this.globe.fitPlaces(points, duration);
  }
  setPreviewTime(t: number | null): void {
    this.globe.setPreviewTime(t);
  }
  setActive(active: boolean): void {
    this.globe.setActive(active);
  }
  onClick(fn: (e: MapClick) => void): void {
    this.globe.onClick(fn);
  }
  onPointerMove(fn: (x: number, y: number) => void): void {
    this.globe.onPointerMove(fn);
  }
  onPointerLeave(fn: () => void): void {
    this.globe.onPointerLeave(fn);
  }
}
