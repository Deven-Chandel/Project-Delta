// Fetches satellite TLE snapshots from CelesTrak into public/data/tle/.
// Runs in CI before each deploy (and on a schedule) so visitors load orbit
// data from our own origin instead of all hitting CelesTrak. Never fails the
// build: if CelesTrak is unreachable the app falls back to fetching live.
import { mkdirSync, writeFileSync } from 'node:fs';

const GROUPS = ['stations', 'starlink', 'gps-ops', 'geo', 'weather', 'science', 'visual'];
const outDir = new URL('../public/data/tle/', import.meta.url);
mkdirSync(outDir, { recursive: true });

const counts = {};
for (const group of GROUPS) {
  const url = `https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=tle`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'TimeBoard3D/1.0 (GitHub Pages snapshot)' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const n = text.split('\n').filter((l) => l.startsWith('1 ')).length;
    if (n === 0) throw new Error('empty response');
    writeFileSync(new URL(`${group}.txt`, outDir), text);
    counts[group] = n;
    console.log(`${group}: ${n} satellites`);
  } catch (err) {
    console.warn(`::warning::Could not fetch ${group} from CelesTrak (${err.message}); site will fetch it live.`);
  }
}

if (Object.keys(counts).length > 0) {
  writeFileSync(new URL('manifest.json', outDir), JSON.stringify({ fetchedAt: new Date().toISOString(), groups: counts }, null, 2));
}
