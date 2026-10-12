/**
 * Time bar: shows simulated time at "Your site", scrubs ±24 h, changes speed.
 * Everything on screen reads the same SimClock, so this one control drives the
 * terminator, every clock face and every satellite at once.
 */
import type { SimClock } from '../core/clock';
import { store } from '../core/store';
import { formatOffset, offsetMinutes, pad2, tzAbbr, zonedParts } from '../core/tz';
import { h, icon } from './dom';

const RATES = [-1000, -100, -10, 1, 10, 100, 1000];
const RANGE_H = 24;

export class TimeBar {
  private timeEl = h('div', { class: 'tb-time' });
  private dateEl = h('div', { class: 'tb-date' });
  private statusEl = h('button', { class: 'tb-status', type: 'button', title: 'Return to live time (N)' });
  private rateEl = h('span', { class: 'tb-rate' });
  private slider: HTMLInputElement;
  private playBtn: HTMLButtonElement;
  private dragging = false;
  private lastSecond = -1;

  constructor(
    readonly el: HTMLElement,
    private readonly clock: SimClock,
  ) {
    this.slider = h('input', {
      type: 'range',
      min: -RANGE_H * 60,
      max: RANGE_H * 60,
      step: 5,
      value: 0,
      'aria-label': 'Scrub time, ±24 hours',
    });
    this.slider.addEventListener('pointerdown', () => (this.dragging = true));
    window.addEventListener('pointerup', () => (this.dragging = false));
    this.slider.addEventListener('input', () => {
      clock.set(Date.now() + Number(this.slider.value) * 60_000);
    });

    this.playBtn = h('button', { class: 'icon-btn', type: 'button', title: 'Play / pause (Space)', onclick: () => clock.setPaused(!clock.paused) });
    this.statusEl.addEventListener('click', () => clock.reset());

    const ticks = h(
      'div',
      { class: 'tb-ticks', 'aria-hidden': 'true' },
      ...[-24, -12, 0, 12, 24].map((hr) => h('span', {}, hr === 0 ? 'now' : `${hr > 0 ? '+' : ''}${hr}h`)),
    );

    el.append(
      h('div', { class: 'tb-clock' }, this.timeEl, this.dateEl),
      this.statusEl,
      h('div', { class: 'tb-scrub' }, this.slider, ticks),
      h(
        'div',
        { class: 'tb-controls' },
        h('button', { class: 'icon-btn', type: 'button', title: 'Slower / reverse ([)', onclick: () => this.stepRate(-1) }, icon('rewind', 15)),
        this.playBtn,
        h('button', { class: 'icon-btn', type: 'button', title: 'Faster (])', onclick: () => this.stepRate(1) }, icon('ffwd', 15)),
        this.rateEl,
        h('button', { class: 'btn now-btn', type: 'button', title: 'Back to live time (N)', onclick: () => clock.reset() }, icon('now', 14), 'Now'),
      ),
    );

    clock.subscribe(() => this.renderControls());
    store.subscribe(() => (this.lastSecond = -1));
    this.renderControls();
  }

  stepRate(dir: 1 | -1): void {
    const i = RATES.indexOf(this.clock.rate);
    const next = RATES[Math.max(0, Math.min(RATES.length - 1, (i < 0 ? 3 : i) + dir))];
    if (this.clock.paused) this.clock.setPaused(false);
    this.clock.setRate(next);
  }

  tick(sim: number): void {
    const second = Math.floor(sim / 1000);
    if (!this.dragging) {
      const offMin = (sim - Date.now()) / 60_000;
      this.slider.value = String(Math.max(-RANGE_H * 60, Math.min(RANGE_H * 60, offMin)));
      this.slider.classList.toggle('out', Math.abs(offMin) > RANGE_H * 60);
    }
    if (second === this.lastSecond) return;
    this.lastSecond = second;
    const home = store.get().home;
    const z = zonedParts(home.tz, sim);
    this.timeEl.innerHTML = `${pad2(z.hour)}:${pad2(z.minute)}<span class="sec">:${pad2(z.second)}</span>`;
    const abbr = tzAbbr(home.tz, sim) || formatOffset(offsetMinutes(home.tz, sim));
    const utc = new Date(sim);
    this.dateEl.textContent = `${z.weekday} ${z.dateKey} · ${abbr} at ${home.name} · ${pad2(utc.getUTCHours())}:${pad2(utc.getUTCMinutes())} UTC`;
    this.renderStatus(sim);
  }

  private renderStatus(sim: number): void {
    const c = this.clock;
    let text: string;
    let cls: string;
    if (c.live) {
      text = 'Live';
      cls = 'live';
    } else {
      const d = (sim - Date.now()) / 60_000;
      const abs = Math.abs(d);
      const span =
        abs < 1
          ? 'now'
          : abs < 60
            ? `${Math.round(abs)}m`
            : abs < 60 * 48
              ? `${Math.floor(abs / 60)}h${Math.round(abs % 60) ? ` ${Math.round(abs % 60)}m` : ''}`
              : `${Math.round(abs / 1440)} days`;
      text = span === 'now' ? (c.paused ? 'Paused' : 'Now') : `${span} ${d > 0 ? 'ahead' : 'ago'}`;
      cls = c.paused ? 'paused' : 'shifted';
    }
    this.statusEl.className = `tb-status ${cls}`;
    this.statusEl.textContent = text;
  }

  private renderControls(): void {
    const c = this.clock;
    this.playBtn.replaceChildren(icon(c.paused ? 'play' : 'pause', 15));
    this.playBtn.setAttribute('aria-label', c.paused ? 'Play' : 'Pause');
    this.rateEl.textContent = `${c.rate < 0 ? '−' : ''}${Math.abs(c.rate)}×`;
    this.rateEl.classList.toggle('fast', c.rate !== 1);
    this.lastSecond = -1;
  }
}
