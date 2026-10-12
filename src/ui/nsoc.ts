/**
 * "Where is your NSOC?" — asked once on first visit (pre-filled from the
 * browser's time zone), remembered, and reopened from the header clock.
 */
import { searchCities } from '../core/cities';
import { store } from '../core/store';
import { formatOffset, offsetMinutes, pad2, tzLabel, zonedParts } from '../core/tz';
import type { Place } from '../core/types';
import { h, icon, toast } from './dom';

export class NsocDialog {
  private dlg: HTMLDialogElement;

  constructor() {
    this.dlg = h('dialog', { class: 'nsoc-dialog', 'aria-labelledby': 'nsoc-title' });
    document.body.appendChild(this.dlg);
    this.dlg.addEventListener('cancel', (e) => {
      if (!store.get().nsocConfirmed) e.preventDefault();
    });
  }

  open(): void {
    const s = store.get();
    const now = Date.now();
    const choose = (p: Omit<Place, 'id'>) => {
      store.update((d) => {
        d.nsoc = { ...p, id: 'nsoc' };
        d.nsocConfirmed = true;
      });
      this.dlg.close();
      toast(`NSOC set to ${p.name} — every Δ is measured from here`);
    };
    const results = h('ul', { class: 'results' });
    const input = h('input', { type: 'search', placeholder: 'Search a city…', 'aria-label': 'Search for the NSOC city', autocomplete: 'off' });
    input.addEventListener('input', () => {
      results.replaceChildren(
        ...searchCities(input.value, 6).map((c) =>
          h(
            'li',
            {},
            h(
              'button',
              { type: 'button', onclick: () => choose({ name: c.name, region: c.regionCode, lat: c.lat, lon: c.lon, tz: c.tz }) },
              h('span', { class: 'r-name' }, c.name, h('small', {}, `${c.province ? c.province + ', ' : ''}${c.country}`)),
              h('span', { class: 'r-time mono' }, formatOffset(offsetMinutes(c.tz, now))),
            ),
          ),
        ),
      );
    });
    const sites = store.allPlaces().slice(0, 40);
    const siteSel = h('select', { 'aria-label': 'Or pick one of your sites' }, h('option', { value: '' }, 'Or pick one of your sites…'), ...sites.map((p, i) => h('option', { value: String(i) }, `${p.name}${p.region ? ', ' + p.region : ''}`)));
    siteSel.addEventListener('change', () => siteSel.value && choose(sites[Number(siteSel.value)]));
    const z = zonedParts(s.nsoc.tz, now);

    this.dlg.replaceChildren(
      h(
        'form',
        { method: 'dialog', class: 'nsoc-form', onsubmit: (e: Event) => e.preventDefault() },
        h('p', { class: 'eyebrow' }, 'Reference clock'),
        h('h2', { id: 'nsoc-title' }, 'Where is your NSOC?'),
        h('p', { class: 'muted' }, 'Every offset on the board is measured from the operations centre. You can change this any time from the clock in the header.'),
        h(
          'button',
          { type: 'button', class: 'nsoc-suggest', onclick: () => choose(s.nsoc) },
          icon('home', 18),
          h('span', {}, h('b', {}, `${s.nsoc.name}${s.nsoc.region ? ', ' + s.nsoc.region : ''}`), h('small', {}, `${pad2(z.hour)}:${pad2(z.minute)} · ${tzLabel(s.nsoc.tz, now)}`)),
          h('span', { class: 'go' }, s.nsocConfirmed ? 'Keep' : 'Use this'),
        ),
        h('label', { class: 'search-box' }, icon('search'), input),
        results,
        sites.length ? h('label', { class: 'select' }, siteSel, icon('chevron', 14)) : null,
        s.nsocConfirmed ? h('button', { type: 'button', class: 'link', onclick: () => this.dlg.close() }, 'Cancel') : null,
      ),
    );
    this.dlg.showModal();
    requestAnimationFrame(() => input.focus());
  }
}
