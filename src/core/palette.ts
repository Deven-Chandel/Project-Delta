/**
 * Categorical colours for clock families, from a fixed, colourblind-validated
 * 8-slot palette (dataviz reference palette, checked against this app's dark
 * #11161f and cream #fbf8f0 surfaces). Colour follows the zone family, never
 * its rank, and a 9th family gets neutral grey instead of a generated hue —
 * rows are always text-labelled, so colour is a secondary cue.
 */
import { offsetMinutes } from './tz';
import type { Theme } from './types';

const DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
const CREAM = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const NEUTRAL = { dark: '#6b7280', cream: '#9a9183' };

export function slotColor(slot: number | null, theme: Theme): string {
  if (slot === null) return NEUTRAL[theme];
  return (theme === 'cream' ? CREAM : DARK)[slot];
}

/**
 * Zones that keep the same clocks all year share a family (Toronto, Iqaluit,
 * Thunder Bay), so deprecated links don't burn extra colours.
 */
export function familyKey(tz: string, year = new Date().getUTCFullYear()): string {
  return `${offsetMinutes(tz, Date.UTC(year, 0, 15))}/${offsetMinutes(tz, Date.UTC(year, 6, 15))}`;
}

/** Slot per family in order of first appearance; null once all 8 are used. */
export function assignSlots(tzs: string[]): Map<string, number | null> {
  const map = new Map<string, number | null>();
  let next = 0;
  for (const tz of tzs) {
    const key = familyKey(tz);
    if (map.has(key)) continue;
    map.set(key, next < 8 ? next++ : null);
  }
  return map;
}
