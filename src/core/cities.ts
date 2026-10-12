import raw from '../data/cities.json';
import { distanceKm } from './geo';

export interface City {
  name: string;
  ascii: string;
  province: string;
  /** Short code for chips: province abbreviation for Canada/US, otherwise ISO country code. */
  regionCode: string;
  iso2: string;
  country: string;
  lat: number;
  lon: number;
  tz: string;
  pop: number;
}

type Row = [string, string, string, string, string, number, number, string, number];

const PROVINCES: Record<string, string> = {
  'British Columbia': 'BC', Alberta: 'AB', Saskatchewan: 'SK', Manitoba: 'MB', Ontario: 'ON',
  Québec: 'QC', Quebec: 'QC', 'New Brunswick': 'NB', 'Nova Scotia': 'NS', 'Prince Edward Island': 'PE',
  'Newfoundland and Labrador': 'NL', Yukon: 'YT', 'Northwest Territories': 'NT', Nunavut: 'NU',
};

let cache: City[] | null = null;

export function cityIndex(): City[] {
  if (!cache) {
    cache = (raw as Row[]).map(([name, ascii, province, iso2, country, lat, lon, tz, pop]) => ({
      name,
      ascii,
      province,
      regionCode: iso2 === 'CA' ? (PROVINCES[province] ?? 'CA') : iso2,
      iso2,
      country,
      lat,
      lon,
      tz,
      pop,
    }));
  }
  return cache;
}

function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Prefix matches first, then substring matches; bigger cities rank higher. */
export function searchCities(query: string, limit = 8): City[] {
  const q = fold(query.trim());
  if (!q) return [];
  const prefix: City[] = [];
  const contains: City[] = [];
  for (const c of cityIndex()) {
    const name = fold(c.ascii);
    const hay = `${name} ${fold(c.country)} ${fold(c.province)}`;
    if (name.startsWith(q)) prefix.push(c);
    else if (hay.includes(q)) contains.push(c);
    if (prefix.length >= limit) break;
  }
  return [...prefix, ...contains].slice(0, limit);
}

export function nearestCity(lat: number, lon: number, maxKm = 120): City | null {
  let best: City | null = null;
  let bestD = maxKm;
  for (const c of cityIndex()) {
    const d = distanceKm(lat, lon, c.lat, c.lon);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}
