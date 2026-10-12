export interface Place {
  id: string;
  name: string;
  /** Province / state / country code shown on the chip, e.g. "ON". */
  region: string;
  lat: number;
  lon: number;
  tz: string;
}

export interface Group {
  id: string;
  name: string;
  places: Place[];
}

export type Mode = 'board' | 'orbits';
export type Theme = 'dark' | 'cream';
