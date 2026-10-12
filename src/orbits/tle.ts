/**
 * Two-line element sets: parsing and loading.
 *
 * Load order: the same-origin snapshot that CI fetches from CelesTrak on a
 * schedule (fast, cached by the CDN, kind to CelesTrak's servers), falling
 * back to CelesTrak directly when the snapshot is missing or stale.
 */
export interface Tle {
  name: string;
  line1: string;
  line2: string;
  /** NORAD catalog number. */
  norad: number;
}

export interface Dataset {
  id: string;
  label: string;
  color: string;
  blurb: string;
}

export const DATASETS: Dataset[] = [
  { id: 'stations', label: 'Space stations', color: '#f5a623', blurb: 'ISS, Tiangong and visiting craft' },
  { id: 'starlink', label: 'Starlink', color: '#7aa2ff', blurb: 'SpaceX broadband megaconstellation' },
  { id: 'gps-ops', label: 'GPS', color: '#3ddc97', blurb: 'Operational navigation satellites' },
  { id: 'geo', label: 'Geostationary', color: '#4fd1c5', blurb: 'Fixed over the equator at 35,786 km' },
  { id: 'weather', label: 'Weather', color: '#ff7b9c', blurb: 'Meteorological satellites' },
  { id: 'science', label: 'Science', color: '#c792ea', blurb: 'Hubble and other observatories' },
  { id: 'visual', label: '100 brightest', color: '#f2f5f9', blurb: 'Easiest to see with the naked eye' },
];

export function parseTle(text: string): Tle[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0);
  const out: Tle[] = [];
  for (let i = 0; i < lines.length; i++) {
    const a = lines[i];
    const b = lines[i + 1];
    const c = lines[i + 2];
    if (a.startsWith('1 ') && b?.startsWith('2 ')) {
      out.push(make(`NORAD ${a.slice(2, 7).trim()}`, a, b));
      i += 1;
    } else if (b?.startsWith('1 ') && c?.startsWith('2 ')) {
      out.push(make(a.trim(), b, c));
      i += 2;
    }
  }
  return out.filter((t) => Number.isFinite(t.norad) && checksumOk(t.line1) && checksumOk(t.line2));
}

function make(name: string, line1: string, line2: string): Tle {
  return { name, line1, line2, norad: parseInt(line1.slice(2, 7), 10) };
}

/** TLE modulo-10 checksum: digits count as their value, '-' counts as 1. */
export function checksumOk(line: string): boolean {
  if (line.length < 69) return false;
  let sum = 0;
  for (const ch of line.slice(0, 68)) {
    if (ch >= '0' && ch <= '9') sum += ch.charCodeAt(0) - 48;
    else if (ch === '-') sum += 1;
  }
  return sum % 10 === parseInt(line[68], 10);
}

export interface Manifest {
  fetchedAt: string;
  groups: Record<string, number>;
}

export type TleSource = 'snapshot' | 'live';
const STALE_MS = 3 * 86_400_000;
let manifestPromise: Promise<Manifest | null> | null = null;

function manifest(): Promise<Manifest | null> {
  manifestPromise ??= fetch('./data/tle/manifest.json', { cache: 'no-cache' })
    .then((r) => (r.ok ? (r.json() as Promise<Manifest>) : null))
    .catch(() => null);
  return manifestPromise;
}

export async function loadDataset(id: string): Promise<{ tles: Tle[]; source: TleSource; fetchedAt: string | null }> {
  const m = await manifest();
  const fresh = m && m.groups[id] && Date.now() - Date.parse(m.fetchedAt) < STALE_MS;
  if (fresh) {
    try {
      const r = await fetch(`./data/tle/${id}.txt`);
      if (r.ok) {
        const tles = parseTle(await r.text());
        if (tles.length) return { tles, source: 'snapshot', fetchedAt: m.fetchedAt };
      }
    } catch {
      /* fall through to live */
    }
  }
  const r = await fetch(`https://celestrak.org/NORAD/elements/gp.php?GROUP=${encodeURIComponent(id)}&FORMAT=tle`);
  if (!r.ok) throw new Error(`CelesTrak responded ${r.status}`);
  const tles = parseTle(await r.text());
  if (!tles.length) throw new Error('No satellites in response');
  return { tles, source: 'live', fetchedAt: new Date().toISOString() };
}
