/**
 * Event converter: "event at 14:00 on Oct 14 at <site>" → that moment at
 * every site, a report line ready to paste, and a warning for any site that
 * is unstaffed then or a wall time DST skips or repeats.
 */
import { parseClock, resolveLocal, toLocalString } from '../core/convert';
import { reportBlock, reportLine, reportRows } from '../core/report';
import { coverageAt, shiftsFor } from '../core/shifts';
import { store } from '../core/store';
import { pad2, zonedParts } from '../core/tz';
import { copyText, h, icon, toast } from './dom';
import { view } from './view';

export class Converter {
  readonly el = h('section', { class: 'conv', 'aria-label': 'Event converter' });
  private timeIn: HTMLInputElement;
  private dateIn: HTMLInputElement;
  private srcSel: HTMLSelectElement;
  private lineEl = h('code', { class: 'conv-line' });
  private statusEl = h('div', { class: 'conv-status', role: 'status', 'aria-live': 'polite' });
  private modeEl = h('span', { class: 'conv-mode' });
  private resetBtn: HTMLButtonElement;
  private lastSecond = -1;
  private syncing = false;
  private warnTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly onSave: (prefill: { local: string; tz: string; sourceLabel: string; title: string }) => void) {
    this.timeIn = h('input', { type: 'text', inputmode: 'numeric', placeholder: '14:00', 'aria-label': 'Event time (24 h)', autocomplete: 'off', class: 'mono' });
    this.dateIn = h('input', { type: 'date', 'aria-label': 'Event date' });
    this.srcSel = h('select', { 'aria-label': 'Time is local to' });
    this.resetBtn = h('button', { type: 'button', class: 'btn', onclick: () => this.reset() }, icon('now', 14), 'Back to now');

    const convert = () => this.fromInputs();
    this.timeIn.addEventListener('keydown', (e) => e.key === 'Enter' && convert());
    this.timeIn.addEventListener('change', convert);
    this.dateIn.addEventListener('change', convert);
    this.srcSel.addEventListener('change', convert);

    this.el.append(
      h(
        'div',
        { class: 'conv-row' },
        h('span', { class: 'conv-label' }, icon('clock', 15), 'Event at'),
        this.timeIn,
        h('span', { class: 'muted' }, 'on'),
        this.dateIn,
        h('span', { class: 'muted' }, 'at'),
        h('label', { class: 'select' }, this.srcSel, icon('chevron', 14)),
        h('button', { type: 'button', class: 'btn primary', onclick: convert }, 'Convert'),
        this.resetBtn,
      ),
      h(
        'div',
        { class: 'conv-out' },
        this.modeEl,
        this.lineEl,
        h(
          'div',
          { class: 'conv-actions' },
          h('button', { type: 'button', class: 'btn', title: 'Copy one line for a report or chat', onclick: () => this.copy('line') }, icon('copy', 14), 'Copy line'),
          h('button', { type: 'button', class: 'btn', title: 'Copy a multi-line block with site names, for email', onclick: () => this.copy('block') }, icon('copy', 14), 'Copy block'),
          h('button', { type: 'button', class: 'btn', onclick: () => this.save() }, icon('calendar', 14), 'Save as event'),
        ),
      ),
      this.statusEl,
    );

    store.subscribe(() => {
      this.renderSources();
      this.lastSecond = -1;
    });
    view.subscribe((v, prev) => {
      if (v.eventAt !== prev.eventAt) {
        if (!this.syncing) this.fillFrom(v.eventAt);
        this.lastSecond = -1;
      }
    });
    this.renderSources();
    this.fillFrom(null);
  }

  tick(now: number): void {
    const second = Math.floor(now / 1000);
    if (second === this.lastSecond) return;
    this.lastSecond = second;
    const ev = view.get().eventAt;
    const t = ev ?? now;
    const s = store.get();
    const group = store.activeGroup();
    this.lineEl.textContent = reportLine(reportRows(t, group.places, s.nsoc));
    this.resetBtn.hidden = ev === null;
    this.modeEl.textContent = ev === null ? 'Now' : view.get().eventTitle || 'Event';
    this.modeEl.className = `conv-mode ${ev === null ? 'live' : 'event'}`;
    if (ev === null && !this.timeIn.matches(':focus') && second % 30 === 0) this.fillFrom(null);
    if (ev !== null) this.renderCoverage(ev);
  }

  private renderSources(): void {
    const s = store.get();
    const current = this.srcSel.value;
    const opts = [
      h('option', { value: s.nsoc.tz, 'data-label': `NSOC · ${s.nsoc.name}` }, `NSOC · ${s.nsoc.name}`),
      ...store
        .activeGroup()
        .places.filter((p) => p.tz !== s.nsoc.tz)
        .reduce<{ tz: string; name: string }[]>((acc, p) => (acc.some((a) => a.tz === p.tz) ? acc : [...acc, { tz: p.tz, name: p.name }]), [])
        .map((p) => h('option', { value: p.tz, 'data-label': p.name }, p.name)),
      h('option', { value: 'UTC', 'data-label': 'UTC' }, 'UTC'),
    ];
    this.srcSel.replaceChildren(...opts);
    if ([...this.srcSel.options].some((o) => o.value === current)) this.srcSel.value = current;
  }

  /** Put an instant (or now) into the inputs, in the selected source zone. */
  private fillFrom(t: number | null): void {
    const tz = this.srcSel.value || store.get().nsoc.tz;
    const local = toLocalString(tz, t ?? Date.now());
    this.dateIn.value = local.slice(0, 10);
    this.timeIn.value = local.slice(11);
  }

  private fromInputs(): void {
    this.clearStatus();
    const min = parseClock(this.timeIn.value);
    if (min === null) {
      this.status('warn', 'alert', 'Type a time like 14:00, 1400 or 2pm.');
      return;
    }
    const date = this.dateIn.value || toLocalString(this.srcSel.value, Date.now()).slice(0, 10);
    const local = `${date}T${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;
    const tz = this.srcSel.value;
    const r = resolveLocal(tz, local);
    if (!r) return this.status('warn', 'alert', 'That date or time is not valid.');
    this.timeIn.value = local.slice(11);
    this.syncing = true;
    // A newly typed time is a new moment, not the event that was shown before.
    view.set({ eventAt: r.utc, eventTitle: '' });
    this.syncing = false;
    if (r.status === 'gap') {
      this.status('warn', 'alert', `${local.slice(11)} doesn’t exist there that day (clocks spring forward) — showing ${toLocalString(tz, r.utc).slice(11)}.`);
    } else if (r.status === 'ambiguous') {
      this.status('warn', 'alert', `${local.slice(11)} happens twice there that day (clocks fall back) — showing the first, daylight-time occurrence.`);
    }
  }

  private renderCoverage(t: number): void {
    if (this.statusEl.dataset.kind === 'warn') return;
    const group = store.activeGroup();
    const off = group.places.filter((p) => {
      const sh = shiftsFor(p, group);
      return sh.length && coverageAt(p.tz, sh, t).state === 'off';
    });
    const sig = off.map((p) => p.id).join(',');
    if (this.statusEl.dataset.sig === sig) return;
    this.statusEl.dataset.sig = sig;
    if (off.length === 0) {
      const set = group.places.some((p) => shiftsFor(p, group).length);
      this.statusEl.replaceChildren(...(set ? [h('span', { class: 'st ok' }, icon('check', 13), 'Every site with hours set is staffed at this time.')] : []));
      return;
    }
    const names = off.map((p) => p.name);
    this.statusEl.replaceChildren(
      h('span', { class: 'st crit' }, icon('off', 13), `Unstaffed at this time: ${names.slice(0, 6).join(', ')}${names.length > 6 ? ` +${names.length - 6} more` : ''}`),
    );
  }

  private status(kind: 'warn', ic: 'alert', text: string): void {
    this.clearStatus();
    this.statusEl.dataset.kind = kind;
    this.statusEl.replaceChildren(h('span', { class: 'st warn' }, icon(ic, 13), text));
    this.warnTimer = setTimeout(() => {
      this.warnTimer = null;
      delete this.statusEl.dataset.kind;
      this.statusEl.dataset.sig = '\u0000';
      this.lastSecond = -1;
    }, 8000);
  }

  /** Drop any warning and force the coverage line to redraw. */
  private clearStatus(): void {
    if (this.warnTimer) clearTimeout(this.warnTimer);
    this.warnTimer = null;
    delete this.statusEl.dataset.kind;
    this.statusEl.dataset.sig = '\u0000';
    this.statusEl.replaceChildren();
    this.lastSecond = -1;
  }

  private reset(): void {
    view.set({ eventAt: null, eventTitle: '' });
    this.clearStatus();
  }

  private async copy(kind: 'line' | 'block'): Promise<void> {
    const s = store.get();
    const t = view.get().eventAt ?? Date.now();
    const rows = reportRows(t, store.activeGroup().places, s.nsoc);
    const text = kind === 'line' ? reportLine(rows) : reportBlock(view.get().eventTitle || (view.get().eventAt === null ? 'Now' : 'Event'), t, rows, s.nsoc.tz);
    toast((await copyText(text)) ? (kind === 'line' ? 'Report line copied' : 'Report block copied') : 'Couldn’t copy — select the text instead');
  }

  private save(): void {
    const t = view.get().eventAt ?? Date.now();
    const tz = this.srcSel.value;
    const opt = this.srcSel.selectedOptions[0];
    const z = zonedParts(tz, t);
    this.onSave({
      local: `${z.dateKey}T${pad2(z.hour)}:${pad2(z.minute)}`,
      tz,
      sourceLabel: opt?.dataset.label ?? tz,
      title: view.get().eventTitle,
    });
  }
}
