/**
 * Event conversion: one wall-clock moment at one site, shown at every site.
 */
import { offsetMinutes, zonedParts } from './tz';

export type ResolveStatus = 'ok' | 'gap' | 'ambiguous';

/** Parse "YYYY-MM-DDTHH:mm". */
export function parseLocal(local: string): { y: number; m: number; d: number; hh: number; mm: number } | null {
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [y, mo, d, hh, mm] = m.slice(1).map(Number);
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth || hh > 23 || mm > 59) return null;
  return { y, m: mo, d, hh, mm };
}

/**
 * Resolve a wall time in a zone to a UTC instant, and say whether that wall
 * time is skipped (spring-forward gap) or happens twice (fall-back).
 * A gap resolves using the pre-jump offset (02:30 → 03:30 the same night);
 * an ambiguous time resolves to its first occurrence, as most schedulers do.
 */
export function resolveLocal(tz: string, local: string): { utc: number; status: ResolveStatus } | null {
  const p = parseLocal(local);
  if (!p) return null;
  const wall = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm);
  const offBefore = offsetMinutes(tz, wall - 6 * 3_600_000 - 14 * 3_600_000);
  const offAfter = offsetMinutes(tz, wall + 6 * 3_600_000 + 14 * 3_600_000);
  const candidates = [...new Set([offBefore, offAfter, offsetMinutes(tz, wall)])].map((o) => wall - o * 60_000);
  const valid = candidates
    .filter((utc) => {
      const z = zonedParts(tz, utc);
      return z.year === p.y && z.month === p.m && z.day === p.d && z.hour === p.hh && z.minute === p.mm;
    })
    .sort((a, b) => a - b);
  if (valid.length === 0) return { utc: wall - offBefore * 60_000, status: 'gap' };
  return { utc: valid[0], status: valid.length > 1 ? 'ambiguous' : 'ok' };
}

/** Format an instant as a wall time in a zone, "YYYY-MM-DDTHH:mm". */
export function toLocalString(tz: string, utc: number): string {
  const z = zonedParts(tz, utc);
  return `${z.dateKey}T${String(z.hour).padStart(2, '0')}:${String(z.minute).padStart(2, '0')}`;
}

/** Calendar-day difference of a zone vs a reference zone at an instant (−1, 0, +1…). */
export function dayShift(tz: string, refTz: string, utc: number): number {
  const a = zonedParts(tz, utc);
  const b = zonedParts(refTz, utc);
  return Math.round((Date.UTC(a.year, a.month - 1, a.day) - Date.UTC(b.year, b.month - 1, b.day)) / 86_400_000);
}

/** Accepts "1400", "14:00", "9:30", "2pm", "2:30 pm". Returns minutes from midnight. */
export function parseClock(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, '');
  const m = t.match(/^(\d{1,2})(?::?(\d{2}))?(am|pm|a|p)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const ap = m[3];
  if (min > 59) return null;
  if (ap) {
    if (h < 1 || h > 12) return null;
    if (ap.startsWith('p') && h !== 12) h += 12;
    if (ap.startsWith('a') && h === 12) h = 0;
  } else if (h > 23) {
    return null;
  }
  return h * 60 + min;
}
