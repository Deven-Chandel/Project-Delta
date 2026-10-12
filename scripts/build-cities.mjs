// Builds src/data/cities.json: a compact, searchable world-city index.
// Source: the MIT-licensed `city-timezones` dataset (dev dependency only).
// Keeps cities over 150k people plus every Canadian city, so the bundle stays small.
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { cityMapping } = require('city-timezones');

const seen = new Set();
const rows = cityMapping
  .filter((c) => c.timezone && (c.pop >= 150_000 || (c.iso2 === 'CA' && c.pop >= 5_000)))
  .sort((a, b) => b.pop - a.pop)
  .filter((c) => {
    const key = `${c.city_ascii}|${c.iso2}|${c.province}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  })
  // [name, ascii name, province, iso2, country, lat, lon, tz, population]
  .map((c) => [
    c.city,
    c.city_ascii,
    c.province ?? '',
    c.iso2,
    c.country,
    Math.round(c.lat * 1000) / 1000,
    Math.round(c.lng * 1000) / 1000,
    c.timezone,
    Math.round(c.pop),
  ]);

writeFileSync(new URL('../src/data/cities.json', import.meta.url), JSON.stringify(rows));
console.log(`cities.json: ${rows.length} cities`);
