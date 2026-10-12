/**
 * What the app needs from a map, so the 3D globe and the flat map are
 * interchangeable behind one toggle.
 */
import type { Place, Theme } from '../core/types';

export interface MarkerSpec {
  place: Place;
  color: string;
  /** Clock-row key (UTC offset); sites sharing a key share a timeline row. */
  key: number;
  /** One site per key keeps its label when zoomed out. */
  lead: boolean;
}

export interface NearSite {
  place: Place;
  key: number;
  color: string;
  isNsoc: boolean;
  /** Distance from the pointer in CSS pixels. */
  d: number;
}

export interface MapClick {
  x: number;
  y: number;
  lat: number | null;
  lon: number | null;
}

export interface MapView {
  /** The element pointer events land on (for the cursor style). */
  readonly surface: HTMLElement;
  setTheme(theme: Theme): void;
  setPlaces(specs: MarkerSpec[], nsoc: Place): void;
  focus(key: number | null): void;
  hover(placeId: string | null): void;
  /** Every visible site within `radius` px of a point, nearest first. */
  sitesNear(x: number, y: number, radius: number): NearSite[];
  fit(points: { lat: number; lon: number }[], duration?: number): void;
  /** Daylight at a moment (timeline crosshair / converted event); null = live. */
  setPreviewTime(t: number | null): void;
  /** Pause rendering while hidden. */
  setActive(active: boolean): void;
  onClick(fn: (e: MapClick) => void): void;
  onPointerMove(fn: (x: number, y: number) => void): void;
  onPointerLeave(fn: () => void): void;
  ready: Promise<void>;
}
