/**
 * Events list: upcoming broadcasts, maintenance windows and shift changes
 * with live countdowns, the local time at every site, and staffing at start.
 */
import { resolveLocal } from '../core/convert';
import { countdownLabel, schedule, type Scheduled } from '../core/countdown';
import { reportLine, reportRows } from '../core/report';
import { coverageAt, shiftsFor } from '../core/shifts';
import { store, uid } from '../core/store';
import { pad2, zonedParts } from '../core/tz';
import type { EventKind, TBEvent } from '../core/types';
import { copyText, h, icon, toast } from './dom';
import { view } from './view';

const KIND_ICON = { broadcast: 'broadcast', maintenance: 'wrench', shift: 'users', other: 'dot' } as const;
const KIND_LABEL: Record<EventKind, string> = { broadcast: 'Broadcast / on-air', maintenance: 'Maintenance window', shift: 'Shift change', other: 'Other' };

export interface EventPrefill {
  local: string;
  tz: string;
  sourceLabel: string;
  title: string;
}

export class EventsPanel {
  readonly el = h('section', { class: 'events', 'aria-label': 'Events' });
  private listEl = h('div', { class: 'ev-list' });
  private formEl = h('div', { class: 'ev-form-wrap' });
  private countdowns: { el: HTMLElement; s: Scheduled }[] = [];
  private lastRender = 0;
  private lastSecond = -1;
  private open = new Set<string>();

  constructor() {
    this.el.append(
      h(
        'div',
        { class: 'section-head' },
        h('h2', {}, 'Events'),
        h('button', { type: 'button', class: 'btn', onclick: () => this.openForm(null) }, icon('plus', 14), 'New event'),
      ),
      this.formEl,
      this.listEl,
    );
    store.subscribe(() => this.render(Date.now()));
  }

  tick(now: number): void {
    const second = Math.floor(now / 1000);
    if (second === this.lastSecond) return;
    this.lastSecond = second;
    if (now - this.lastRender > 30_000) this.render(now);
    for (const c of this.countdowns) c.el.textContent = phaseText(c.s, now);
  }

  /** Next live/upcoming event, for the header chip. */
  next(now: number): Scheduled | null {
    return schedule(store.get().events, now).find((s) => s.phase !== 'past') ?? null;
  }

  openForm(prefill: EventPrefill | null): void {
    const s = store.get();
    const tz = prefill?.tz ?? s.nsoc.tz;
    const z = zonedParts(tz, Date.now() + 3_600_000);
    const local = prefill?.local ?? `${z.dateKey}T${pad2(z.hour)}:00`;
    const title = h('input', { type: 'text', placeholder: 'e.g. National newscast, Network maintenance', 'aria-label': 'Event title', maxlength: 120, value: prefill?.title ?? '' });
    const kind = h('select', { 'aria-label': 'Event type' }, ...Object.entries(KIND_LABEL).map(([k, v]) => h('option', { value: k }, v)));
    const date = h('input', { type: 'date', value: local.slice(0, 10), 'aria-label': 'Date' });
    const time = h('input', { type: 'text', class: 'mono', value: local.slice(11), 'aria-label': 'Time (24 h)', inputmode: 'numeric' });
    const zone = h(
      'select',
      { 'aria-label': 'Time is local to' },
      h('option', { value: s.nsoc.tz }, `NSOC · ${s.nsoc.name}`),
      ...[...new Map(store.activeGroup().places.map((p) => [p.tz, p])).values()]
        .filter((p) => p.tz !== s.nsoc.tz)
        .map((p) => h('option', { value: p.tz }, p.name)),
      h('option', { value: 'UTC' }, 'UTC'),
    );
    zone.value = tz;
    const dur = h(
      'select',
      { 'aria-label': 'Duration' },
      ...[
        [0, 'No duration'],
        [15, '15 min'],
        [30, '30 min'],
        [60, '1 h'],
        [120, '2 h'],
        [240, '4 h'],
        [480, '8 h'],
      ].map(([v, l]) => h('option', { value: v }, String(l))),
    );
    dur.value = '60';
    const repeat = h('select', { 'aria-label': 'Repeat' }, h('option', { value: 'none' }, 'Once'), h('option', { value: 'daily' }, 'Every day'));
    const err = h('p', { class: 'st warn', hidden: true });
    const save = () => {
      const tm = time.value.trim().replace(/^(\d{1,2})(\d{2})$/, '$1:$2');
      const m = tm.match(/^(\d{1,2}):(\d{2})$/);
      const loc = m ? `${date.value}T${pad2(Number(m[1]))}:${m[2]}` : '';
      if (!m || !resolveLocal(zone.value, loc)) {
        err.hidden = false;
        err.textContent = 'Enter a date and a 24-hour time like 14:00.';
        return;
      }
      const ev: TBEvent = {
        id: uid('e'),
        title: title.value.trim() || KIND_LABEL[kind.value as EventKind],
        kind: kind.value as EventKind,
        local: loc,
        tz: zone.value,
        sourceLabel: zone.selectedOptions[0]?.textContent ?? zone.value,
        durationMin: Number(dur.value),
        repeat: repeat.value === 'daily' ? 'daily' : 'none',
        groupId: store.get().activeGroupId,
      };
      store.update((d) => d.events.push(ev));
      this.formEl.replaceChildren();
      toast(`Saved “${ev.title}”`);
      this.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    };
    this.formEl.replaceChildren(
      h(
        'form',
        { class: 'ev-form', onsubmit: (e: Event) => (e.preventDefault(), save()) },
        h('label', { class: 'field wide' }, h('span', {}, 'Title'), title),
        h('label', { class: 'field' }, h('span', {}, 'Type'), kind),
        h('label', { class: 'field' }, h('span', {}, 'Date'), date),
        h('label', { class: 'field' }, h('span', {}, 'Time'), time),
        h('label', { class: 'field' }, h('span', {}, 'Local to'), zone),
        h('label', { class: 'field' }, h('span', {}, 'Duration'), dur),
        h('label', { class: 'field' }, h('span', {}, 'Repeat'), repeat),
        err,
        h(
          'div',
          { class: 'ev-form-actions' },
          h('button', { type: 'submit', class: 'btn primary' }, icon('check', 14), 'Save event'),
          h('button', { type: 'button', class: 'btn', onclick: () => this.formEl.replaceChildren() }, 'Cancel'),
        ),
      ),
    );
    requestAnimationFrame(() => title.focus());
  }

  private render(now: number): void {
    this.lastRender = now;
    const s = store.get();
    const list = schedule(s.events, now);
    const upcoming = list.filter((x) => x.phase !== 'past');
    const past = list.filter((x) => x.phase === 'past').slice(0, 5);
    this.countdowns = [];
    if (list.length === 0) {
      this.listEl.replaceChildren(h('p', { class: 'empty' }, 'No events yet. Convert a time above and choose “Save as event”, or add one here.'));
      return;
    }
    this.listEl.replaceChildren(
      ...upcoming.map((x) => this.item(x, now)),
      ...(past.length ? [h('h3', { class: 'ev-sub' }, 'Earlier'), ...past.map((x) => this.item(x, now))] : []),
    );
  }

  private item(x: Scheduled, now: number): HTMLElement {
    const s = store.get();
    const group = s.groups.find((g) => g.id === x.ev.groupId) ?? store.activeGroup();
    const nz = zonedParts(s.nsoc.tz, x.start);
    const rows = reportRows(x.start, group.places, s.nsoc);
    const set = group.places.filter((p) => shiftsFor(p, group).length);
    const off = set.filter((p) => coverageAt(p.tz, shiftsFor(p, group), x.start).state === 'off');
    const countdown = h('span', { class: `ev-count ${x.phase}` });
    countdown.textContent = phaseText(x, now);
    this.countdowns.push({ el: countdown, s: x });
    const isOpen = this.open.has(x.ev.id);

    const details = isOpen
      ? h(
          'div',
          { class: 'ev-detail' },
          h('table', {}, h('tbody', {}, ...rows.map((r) => h('tr', {}, h('td', { class: 'mono' }, r.time, r.dayShift ? h('small', {}, ` ${r.weekday}`) : null), h('td', {}, h('b', {}, r.abbr)), h('td', {}, r.names.join(', ')))))),
          off.length ? h('p', { class: 'st crit' }, icon('off', 12), `Unstaffed at start: ${off.map((p) => p.name).join(', ')}`) : null,
          h('p', { class: 'hint' }, `Entered as ${x.ev.local.slice(11)} ${x.ev.sourceLabel || x.ev.tz}${x.ev.repeat === 'daily' ? ' · repeats daily at that local time' : ''} · group: ${group.name}`),
        )
      : null;

    return h(
      'article',
      { class: `ev ${x.phase}${isOpen ? ' open' : ''}`, 'data-kind': x.ev.kind },
      h(
        'button',
        {
          type: 'button',
          class: 'ev-main',
          'aria-expanded': String(isOpen),
          onclick: () => {
            if (isOpen) this.open.delete(x.ev.id);
            else this.open.add(x.ev.id);
            this.render(Date.now());
          },
        },
        h('span', { class: 'ev-icon' }, icon(KIND_ICON[x.ev.kind], 16)),
        h(
          'span',
          { class: 'ev-text' },
          h('b', {}, x.ev.title),
          h('span', { class: 'ev-when' }, `${nz.weekday} ${nz.dateKey.slice(5)} · ${pad2(nz.hour)}:${pad2(nz.minute)} NSOC${x.ev.durationMin ? ` · ${fmtDur(x.ev.durationMin)}` : ''}${x.ev.repeat === 'daily' ? ' · daily' : ''}`),
        ),
        countdown,
      ),
      h(
        'div',
        { class: 'ev-cover' },
        set.length
          ? off.length
            ? h('span', { class: 'st crit' }, icon('off', 12), `${off.length} of ${set.length} sites unstaffed at start`)
            : h('span', { class: 'st ok' }, icon('check', 12), `All ${set.length} sites staffed at start`)
          : h('span', { class: 'st unset' }, icon('dot', 12), 'Site hours not set'),
        h(
          'span',
          { class: 'ev-actions' },
          h('button', { type: 'button', class: 'icon-btn', title: 'Show on the board', 'aria-label': `Show ${x.ev.title} on the board`, onclick: () => view.set({ eventAt: x.start, eventTitle: x.ev.title }) }, icon('timeline', 15)),
          h(
            'button',
            {
              type: 'button',
              class: 'icon-btn',
              title: 'Copy report line',
              'aria-label': `Copy report line for ${x.ev.title}`,
              onclick: async () => toast((await copyText(`${x.ev.title}: ${reportLine(rows)}`)) ? 'Report line copied' : 'Couldn’t copy'),
            },
            icon('copy', 15),
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'icon-btn',
              title: 'Delete event',
              'aria-label': `Delete ${x.ev.title}`,
              onclick: () => {
                if (!confirm(`Delete “${x.ev.title}”?`)) return;
                store.update((d) => (d.events = d.events.filter((e) => e.id !== x.ev.id)));
              },
            },
            icon('trash', 15),
          ),
        ),
      ),
      details,
    );
  }
}

function fmtDur(min: number): string {
  return min >= 60 ? `${min / 60} h` : `${min} min`;
}

function phaseText(s: Scheduled, now: number): string {
  if (s.phase === 'live') return s.ev.durationMin ? `LIVE · ends ${countdownLabel(s.end, now)}` : 'NOW';
  if (s.phase === 'past') return countdownLabel(s.start, now).replace('started ', '');
  return countdownLabel(s.start, now);
}
