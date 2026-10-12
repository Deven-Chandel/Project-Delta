/**
 * Zone abbreviations for report lines ("14:00 ET / 15:30 NT").
 *
 * Intl output varies by browser and ICU build, and some zones only come
 * back as long names ("Whitehorse Time") or "GMT-7", so a small override
 * table pins the ones an NSOC in Canada relies on.
 */
import { formatOffset, offsetMinutes } from './tz';

export type AbbrStyle = 'generic' | 'specific';

/** Zones that never observe DST keep a fixed standard label in both styles. */
const FIXED: Record<string, string> = {
  'America/Whitehorse': 'MST',
  'America/Dawson': 'MST',
  'America/Dawson_Creek': 'MST',
  'America/Fort_Nelson': 'MST',
  'America/Creston': 'MST',
  'America/Phoenix': 'MST',
  'America/Regina': 'CST',
  'America/Swift_Current': 'CST',
  'Asia/Kolkata': 'IST',
  'Asia/Calcutta': 'IST',
  'Asia/Tokyo': 'JST',
  'Asia/Seoul': 'KST',
  'Asia/Singapore': 'SGT',
  'Asia/Hong_Kong': 'HKT',
  'Asia/Shanghai': 'CST',
  'UTC': 'UTC',
  'Etc/UTC': 'UTC',
};

/** Generic (season-independent) labels Intl doesn't produce as an abbreviation. */
const GENERIC: Record<string, string> = {
  'America/St_Johns': 'NT',
};

const cache = new Map<string, Intl.DateTimeFormat>();
function fmt(locale: string, tz: string, name: 'short' | 'shortGeneric'): Intl.DateTimeFormat {
  const key = `${locale}|${tz}|${name}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { timeZone: tz, timeZoneName: name });
    cache.set(key, f);
  }
  return f;
}

function intlName(locale: string, tz: string, name: 'short' | 'shortGeneric', t: number): string {
  try {
    return fmt(locale, tz, name).formatToParts(t).find((p) => p.type === 'timeZoneName')?.value ?? '';
  } catch {
    return '';
  }
}

const isAbbr = (s: string) => /^[A-Z]{2,5}$/.test(s);

function specificAbbr(tz: string, t: number): string {
  for (const locale of ['en-CA', 'en-US', 'en-GB', 'en-AU', 'en-IN', 'en-NZ']) {
    const s = intlName(locale, tz, 'short', t);
    if (isAbbr(s) && s !== 'GMT') return s;
    if (s === 'GMT' && offsetMinutes(tz, t) === 0) return 'GMT';
  }
  return '';
}

/**
 * "ET" (generic) or "EDT" (specific). Falls back to "UTC+9" rather than
 * inventing a label, so a report line is never wrong.
 */
export function zoneAbbr(tz: string, t: number, style: AbbrStyle = 'generic'): string {
  if (FIXED[tz]) return FIXED[tz];
  if (style === 'generic') {
    if (GENERIC[tz]) return GENERIC[tz];
    const g = intlName('en-US', tz, 'shortGeneric', t);
    if (isAbbr(g) && g !== 'GMT') return g;
  }
  return specificAbbr(tz, t) || formatOffset(offsetMinutes(tz, t)).replace('−', '-');
}
