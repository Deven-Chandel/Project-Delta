/**
 * The timeline board — the main view. One row per clock, on a shared axis in
 * NSOC time: daylight shading, staffed hours, each row's own local hour
 * ticks, a now line, event flags, and a crosshair whose single tooltip lists
 * every clock at that moment. The expandable per-site rows are the table view.
 */
import { countdownLabel, schedule } from '../core/countdown';
import { slotColor } from '../core/palette';
import { reportRows } from '../core/report';
import { zoneAbbr } from '../core/abbr';
import { buildRows, rowCoverage, type BoardRow } from '../core/rows';
import { formatShift, intersectIntervals, mergeIntervals, shiftIntervals, shiftsFor } from '../core/shifts';
import { store } from '../core/store';
import { axisWindow, fracToTime, lightBands, localTicks, timeToFrac } from '../core/timeline';
import { formatDelta, formatOffset, offsetMinutes, pad2, tzLabel, zonedParts, type Interval } from '../core/tz';
import type { Group, Place } from '../core/types';
import { AnalogClock } from './analog';
import { coverageText } from './coverage';
import { h, icon } from './dom';
import { view } from './view';

const HOUR = 3_600_000;
const pct = (f: number) => `${(Math.min(1, Math.max(0, f)) * 100).toFixed(3)}%`;

interface RowView {
  row: BoardRow;
  el: HTMLElement;
  analog: AnalogClock;
  time: HTMLElement;
  cover: HTMLElement;
}

export class TimelineBoard {
  readonly el = h('section', { class: 'tl', 'aria-label': 'Timeline of every site' });
  private axisEl = h('div', { class: 'tl-axis', 'aria-hidden': 'true' });
  private body = h('div', { class: 'tl-body', tabindex: 0, 'aria-label': 'Timeline. Use left and right arrows to inspect a time, Enter to convert it.' });
  private overlay = h('div', { class: 'tl-overlay', 'aria-hidden': 'true' });
  private nowLine = h('div', { class: 'tl-line now' }, h('span', {}, 'now'));
  private eventLine = h('div', { class: 'tl-line event' });
  private cross = h('div', { class: 'tl-line cross' });
  private tip = h('div', { class: 'tl-tip', role: 'status' });
  private modeBtns: HTMLButtonElement[] = [];
  private rows: RowView[] = [];
  private window: Interval = [0, 1];
  private sig = '';
  private lastSecond = -1;
  private expanded = new Set<number>();

  constructor() {
    const modes = h(
      'div',
      { class: 'seg', role: 'group', 'aria-label': 'Timeline range' },
      ...(['rolling', 'day'] as const).map((m) => {
        const b = h('button', { type: 'button', 'data-axis': m, onclick: () => store.update((s) => (s.axis = m)) }, m === 'rolling' ? '24 h' : 'NSOC day');
        this.modeBtns.push(b);
        return b;
      }),
    );
    this.overlay.append(this.nowLine, this.eventLine, this.cross, this.tip);
    this.el.append(
      h('div', { class: 'tl-head' }, h('div', { class: 'tl-corner' }, h('span', { class: 'eyebrow' }, 'Clocks'), modes), this.axisEl),
      this.body,
      h(
        'div',
        { class: 'tl-legend' },
        h('span', {}, h('i', { class: 'lg day' }), 'Daylight'),
        h('span', {}, h('i', { class: 'lg twilight' }), 'Dawn / dusk'),
        h('span', {}, h('i', { class: 'lg night' }), 'Night'),
        h('span', {}, h('i', { class: 'lg staffed' }), 'Staffed'),
        h('span', {}, h('i', { class: 'lg now' }), 'Now'),
        h('span', {}, h('i', { class: 'lg event' }), 'Converted event'),
        h('span', { class: 'muted' }, 'Hover or use ← → to read every site at that moment · click to convert'),
      ),
    );
    this.body.append(this.overlay);
    this.bind();
    store.subscribe(() => (this.sig = ''));
    view.subscribe((v, prev) => {
      if (v.eventAt !== prev.eventAt) this.sig = '';
      if (v.hoverAt !== prev.hoverAt) this.renderCross();
      if (v.focusKey !== prev.focusKey || v.hoverKey !== prev.hoverKey) this.markFocus();
    });
  }

  /** Called every animation frame; work is throttled to once per second. */
  tick(now: number): void {
    const second = Math.floor(now / 1000);
    if (second === this.lastSecond) return;
    this.lastSecond = second;
    const sig = this.signature(now);
    if (sig !== this.sig) this.render(now, sig);
    this.updateClocks(now);
    this.place(this.nowLine, now);
    const ev = view.get().eventAt;
    this.eventLine.hidden = ev === null;
    if (ev !== null) this.place(this.eventLine, ev);
  }

  private signature(now: number): string {
    // Store changes already clear `sig`; this only catches time passing and resizes.
    const t = view.get().eventAt ?? now;
    return [innerWidth < 760, Math.floor(t / 60_000), Math.floor(now / 60_000)].join('|');
  }

  /** Anchored on now; re-centres on a converted event only if it falls outside. */
  private windowFor(now: number): Interval {
    const s = store.get();
    const ev = view.get().eventAt;
    const make = (t: number): Interval => {
      if (innerWidth < 760) {
        const from = Math.floor(t / HOUR) * HOUR - 2 * HOUR;
        return [from, from + 12 * HOUR];
      }
      return axisWindow(t, s.nsoc.tz, s.axis);
    };
    const w = make(now);
    return ev === null || (ev >= w[0] && ev <= w[1]) ? w : make(ev);
  }

  private render(now: number, sig: string): void {
    this.sig = sig;
    const s = store.get();
    const group = store.activeGroup();
    const t = view.get().eventAt ?? now;
    this.window = this.windowFor(now);
    this.modeBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.axis === s.axis)));
    this.renderAxis(now);

    const rows = buildRows(group, s.nsoc, t);
    this.rows = rows.map((r) => this.renderRow(r, group, s.nsoc));
    const children: Node[] = [];
    for (const rv of this.rows) {
      children.push(rv.el);
      if (this.expanded.has(rv.row.key)) children.push(this.detail(rv.row, group, t));
    }
    if (group.places.length === 0) {
      children.push(h('div', { class: 'tl-empty' }, h('b', {}, 'No sites in this group yet.'), ' Add sites from the Sites tab, or click the map to drop a pin.'));
    }
    this.body.replaceChildren(...children, this.overlay);
    this.markFocus();
    this.renderCross();
  }

  private renderAxis(now: number): void {
    const s = store.get();
    const [from, to] = this.window;
    const every = to - from > 13 * HOUR ? 3 : 2;
    const ticks = localTicks(s.nsoc.tz, this.window, every).map((tk) =>
      h('span', { class: `ax-tick${tk.hour === 0 ? ' midnight' : ''}`, style: `left:${pct(timeToFrac(tk.t, this.window))}` }, tk.hour === 0 ? zonedParts(s.nsoc.tz, tk.t).weekday : pad2(tk.hour)),
    );
    const flags = schedule(s.events, now)
      .filter((x) => x.start >= from && x.start <= to)
      .map((x) =>
        h(
          'button',
          {
            type: 'button',
            class: `ax-flag ${x.ev.kind}`,
            style: `left:${pct(timeToFrac(x.start, this.window))}`,
            title: `${x.ev.title} · ${countdownLabel(x.start, now)}`,
            'aria-label': `${x.ev.title}, ${countdownLabel(x.start, now)}`,
            onclick: () => view.set({ eventAt: x.start, eventTitle: x.ev.title }),
          },
          icon(x.ev.kind === 'broadcast' ? 'broadcast' : x.ev.kind === 'maintenance' ? 'wrench' : x.ev.kind === 'shift' ? 'users' : 'dot', 12),
        ),
      );
    this.axisEl.replaceChildren(h('span', { class: 'ax-caption' }, `NSOC · ${s.nsoc.name}`), ...ticks, ...flags);
  }

  private renderRow(row: BoardRow, group: Group, nsoc: Place): RowView {
    const theme = store.get().theme;
    const color = slotColor(row.slot, theme);
    const lead = row.sites[0]?.place ?? nsoc;
    const analog = new AnalogClock(30);
    const time = h('span', { class: 'lab-time' });
    const cover = h('span', { class: 'lab-cover' });
    const names = row.sites.map((s) => s.place.name);
    const title = row.isNsoc && row.sites.length === 0 ? nsoc.name : names[0];
    const more = names.length > 1 ? h('small', { class: 'more' }, `+${names.length - 1}`) : null;
    const open = this.expanded.has(row.key);

    const label = h(
      'button',
      {
        type: 'button',
        class: 'tl-label',
        'aria-expanded': String(open),
        title: `${names.join(', ') || nsoc.name} — show sites`,
        onclick: () => {
          if (this.expanded.has(row.key)) this.expanded.delete(row.key);
          else this.expanded.add(row.key);
          this.sig = '';
          view.fly(row.key);
        },
      },
      h('span', { class: 'chev' }, icon('chevron', 14)),
      h('span', { class: 'swatch', style: `--c:${color}` }),
      analog.el,
      h(
        'span',
        { class: 'lab-text' },
        h('span', { class: 'lab-top' }, h('b', {}, row.abbr), h('span', { class: 'lab-name' }, title), more, row.isNsoc ? h('span', { class: 'badge' }, 'NSOC') : null),
        h('span', { class: 'lab-sub' }, h('span', {}, row.isNsoc ? formatOffset(row.key) : `Δ ${formatDelta(row.delta)}`), cover),
      ),
      time,
    );

    // Track: light bands for the lead site, staffed bars, local hour ticks.
    const w = this.window;
    const bands = lightBands(lead.lat, lead.lon, w)
      .filter((b) => b.phase !== 'night')
      .map((b) => h('span', { class: `band ${b.phase}`, style: `left:${pct(timeToFrac(b.from, w))};width:calc(${pct(timeToFrac(b.to, w))} - ${pct(timeToFrac(b.from, w))})` }));
    // Sites with no hours set don't count against "all staffed" (matches the label).
    const perSite = row.sites
      .filter((s) => shiftsFor(s.place, group).length)
      .map((s) => shiftIntervals(s.place.tz, shiftsFor(s.place, group), w[0], w[1]));
    const any = mergeIntervals(perSite.flat());
    const all = perSite.length ? perSite.reduce((acc, ivs) => intersectIntervals(acc, ivs)) : [];
    const bar = (iv: Interval, cls: string) =>
      h('span', { class: `staff ${cls}`, style: `--c:${color};left:${pct(timeToFrac(iv[0], w))};width:calc(${pct(timeToFrac(iv[1], w))} - ${pct(timeToFrac(iv[0], w))})` });
    const ticks = localTicks(row.tz, w, w[1] - w[0] > 13 * HOUR ? 3 : 2).map((tk) =>
      h('span', { class: `lt${tk.hour === 0 ? ' midnight' : ''}`, style: `left:${pct(timeToFrac(tk.t, w))}` }, tk.hour === 0 ? zonedParts(row.tz, tk.t).weekday : pad2(tk.hour)),
    );
    const track = h('div', { class: 'tl-track' }, ...bands, ...any.map((iv) => bar(iv, 'some')), ...all.map((iv) => bar(iv, 'all')), ...ticks);

    const el = h('div', { class: `tl-row${row.isNsoc ? ' nsoc' : ''}`, 'data-key': row.key, style: `--c:${color}` }, label, track);
    el.addEventListener('mouseenter', () => view.set({ hoverKey: row.key }));
    el.addEventListener('mouseleave', () => view.get().hoverKey === row.key && view.set({ hoverKey: null }));
    return { row, el, analog, time, cover };
  }

  /** Per-site table for an expanded row — every value without hovering. */
  private detail(row: BoardRow, group: Group, t: number): HTMLElement {
    const nsoc = store.get().nsoc;
    const rows = row.sites.length
      ? row.sites.map((s) => {
          const z = zonedParts(s.place.tz, t);
          const hours = shiftsFor(s.place, group);
          return h(
            'tr',
            {},
            h('td', {}, s.place.name, s.place.region ? h('small', {}, ` ${s.place.region}`) : null),
            h('td', { class: 'mono' }, `${pad2(z.hour)}:${pad2(z.minute)}`, h('small', {}, ` ${z.weekday}`)),
            h('td', { class: 'mono' }, hours.length ? hours.map(formatShift).join(', ') : '—', s.place.shifts ? h('small', {}, ' own') : null),
            h('td', {}, coverageText(s.coverage.state, s.coverage.until, s.place.tz)),
          );
        })
      : [h('tr', {}, h('td', { colspan: 4 }, `${nsoc.name} (NSOC) — no group sites on this clock.`))];
    return h(
      'div',
      { class: 'tl-detail' },
      h(
        'table',
        {},
        h('caption', { class: 'sr-only' }, `Sites on ${row.abbr}`),
        h('thead', {}, h('tr', {}, h('th', {}, 'Site'), h('th', {}, 'Local'), h('th', {}, 'Staffed hours'), h('th', {}, 'Status'))),
        h('tbody', {}, ...rows),
      ),
      h('p', { class: 'hint' }, `${tzLabel(row.tz, t)} · daylight shading follows ${row.sites[0]?.place.name ?? nsoc.name}`),
    );
  }

  private updateClocks(now: number): void {
    const t = view.get().eventAt ?? now;
    for (const rv of this.rows) {
      const z = zonedParts(rv.row.tz, t);
      rv.analog.set(z.hour, z.minute, z.second);
      rv.time.textContent = `${pad2(z.hour)}:${pad2(z.minute)}`;
      const c = rowCoverage(rv.row);
      const text =
        c.state === 'unset' ? 'Hours not set' : c.state === 'all' ? 'Staffed' : c.state === 'none' ? 'Unstaffed' : `${c.on}/${c.total} staffed`;
      const cls = c.state === 'all' ? 'ok' : c.state === 'some' ? 'warn' : c.state === 'none' ? (view.get().eventAt !== null ? 'crit' : 'off') : 'unset';
      if (rv.cover.dataset.state !== cls + text) {
        rv.cover.dataset.state = cls + text;
        rv.cover.className = `lab-cover ${cls}`;
        rv.cover.title = text;
        rv.cover.replaceChildren(icon(cls === 'ok' ? 'check' : cls === 'warn' ? 'ending' : cls === 'unset' ? 'dot' : 'off', 12), h('span', { class: 'cover-text' }, text));
      }
    }
  }

  private place(line: HTMLElement, t: number): void {
    const f = timeToFrac(t, this.window);
    line.hidden = f < 0 || f > 1;
    line.style.left = pct(f);
  }

  private bind(): void {
    const tAt = (clientX: number) => {
      const r = this.overlay.getBoundingClientRect();
      return fracToTime((clientX - r.left) / r.width, this.window);
    };
    const onTrack = (e: PointerEvent) => !!(e.target as HTMLElement).closest('.tl-track');
    this.body.addEventListener('pointermove', (e) => {
      if (!onTrack(e)) {
        if (view.get().hoverAt !== null) view.set({ hoverAt: null });
        return;
      }
      view.set({ hoverAt: tAt(e.clientX) });
    });
    this.body.addEventListener('pointerleave', () => view.set({ hoverAt: null, hoverKey: null }));
    this.body.addEventListener('click', (e) => {
      if (!(e.target as HTMLElement).closest('.tl-track')) return;
      view.set({ eventAt: tAt(e.clientX), eventTitle: '', hoverAt: null });
    });
    this.body.addEventListener('keydown', (e) => {
      const base = view.get().hoverAt ?? view.get().eventAt ?? Math.round(Date.now() / 900_000) * 900_000;
      const step = e.shiftKey ? HOUR : 15 * 60_000;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const next = Math.min(this.window[1], Math.max(this.window[0], base + (e.key === 'ArrowRight' ? step : -step)));
        view.set({ hoverAt: next });
      } else if (e.key === 'Enter' && view.get().hoverAt !== null) {
        view.set({ eventAt: view.get().hoverAt, eventTitle: '', hoverAt: null });
      } else if (e.key === 'Escape') {
        view.set({ hoverAt: null });
      }
    });
    this.body.addEventListener('blur', () => view.set({ hoverAt: null }));
  }

  private renderCross(): void {
    const t = view.get().hoverAt;
    this.cross.hidden = t === null;
    this.tip.hidden = t === null;
    if (t === null) return;
    this.place(this.cross, t);
    const s = store.get();
    const group = store.activeGroup();
    const nz = zonedParts(s.nsoc.tz, t);
    const rows = reportRows(t, group.places, s.nsoc);
    const rowEls = rows.map((r) => {
      // Match sites to a row by their clock at t, not by name (names can repeat).
      const places = group.places.filter((p) => offsetMinutes(p.tz, t) === r.offset && zoneAbbr(p.tz, t) === r.abbr);
      const set = places.filter((p) => shiftsFor(p, group).length);
      const on = set.filter((p) => shiftIntervals(p.tz, shiftsFor(p, group), t, t + 1).length).length;
      return h(
        'li',
        {},
        h('b', { class: 'mono' }, r.time),
        h('span', { class: 'abbr' }, r.abbr, r.dayShift ? ` ${r.weekday}` : ''),
        h('span', { class: 'who' }, r.isNsoc && !places.length ? 'NSOC' : r.names.slice(0, 3).join(', ') + (r.names.length > 3 ? ` +${r.names.length - 3}` : '')),
        set.length ? h('span', { class: `st ${on === set.length ? 'ok' : on ? 'warn' : 'off'}` }, `${on}/${set.length}`) : null,
      );
    });
    this.tip.replaceChildren(
      h('div', { class: 'tip-head' }, h('b', {}, `${pad2(nz.hour)}:${pad2(nz.minute)} NSOC`), h('span', {}, `${nz.weekday} ${nz.dateKey}`)),
      h('ul', {}, ...rowEls),
      h('div', { class: 'tip-foot' }, 'Click or Enter to convert this time'),
    );
    const f = timeToFrac(t, this.window);
    this.tip.classList.toggle('left', f > 0.62);
    this.tip.style.left = pct(f);
  }

  private markFocus(): void {
    const k = view.highlight();
    for (const rv of this.rows) rv.el.classList.toggle('focused', rv.row.key === k);
  }
}
