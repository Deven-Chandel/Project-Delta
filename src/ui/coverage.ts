/**
 * Staffing status as icon + text (status colour is never the only cue).
 * Shared by the timeline's site tables and the map popup.
 */
import { pad2, zonedParts } from '../core/tz';
import { h, icon } from './dom';

export function coverageText(state: string, until: number | null, tz: string, compact = false): HTMLElement {
  const at = (t: number) => {
    const z = zonedParts(tz, t);
    return `${pad2(z.hour)}:${pad2(z.minute)}`;
  };
  const size = compact ? 11 : 12;
  if (state === 'none') return h('span', { class: 'st unset' }, icon('dot', size), 'Not set');
  if (state === 'on') return h('span', { class: 'st ok' }, icon('check', size), compact ? 'Staffed' : until ? `Staffed until ${at(until)}` : 'Staffed 24 h');
  if (state === 'ending') return h('span', { class: 'st warn' }, icon('ending', size), `Ends ${until ? at(until) : ''}`);
  return h('span', { class: 'st off' }, icon('off', size), compact ? 'Off' : until ? `Off · opens ${at(until)}` : 'Off');
}
