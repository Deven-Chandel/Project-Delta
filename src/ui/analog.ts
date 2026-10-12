/**
 * The analog clock face from the original Time Board, as a reusable SVG.
 */
const SIZE = 88;
const R = 40;
const C = 44;
const NS = 'http://www.w3.org/2000/svg';

let ticksCache = '';
function ticks(): string {
  if (ticksCache) return ticksCache;
  let s = '';
  for (let i = 0; i < 60; i++) {
    const a = (i * 6 * Math.PI) / 180;
    const major = i % 5 === 0;
    const r1 = major ? R - 7 : R - 3.5;
    s += `<line class="tick${major ? ' major' : ''}" x1="${(C + r1 * Math.sin(a)).toFixed(1)}" y1="${(C - r1 * Math.cos(a)).toFixed(1)}" x2="${(C + R * Math.sin(a)).toFixed(1)}" y2="${(C - R * Math.cos(a)).toFixed(1)}"/>`;
  }
  ticksCache = s;
  return s;
}

export class AnalogClock {
  readonly el: SVGSVGElement;
  private hour: SVGLineElement;
  private min: SVGLineElement;
  private sec: SVGLineElement;

  constructor(size = 64) {
    this.el = document.createElementNS(NS, 'svg');
    this.el.setAttribute('class', 'analog');
    this.el.setAttribute('width', String(size));
    this.el.setAttribute('height', String(size));
    this.el.setAttribute('viewBox', `0 0 ${SIZE} ${SIZE}`);
    this.el.setAttribute('aria-hidden', 'true');
    this.el.innerHTML = `
      <circle class="face" cx="${C}" cy="${C}" r="${R}"/>
      ${ticks()}
      <line class="hand-hour" x1="${C}" y1="${C}" x2="${C}" y2="${C - 21}"/>
      <line class="hand-min" x1="${C}" y1="${C}" x2="${C}" y2="${C - 30}"/>
      <line class="hand-sec" x1="${C}" y1="${C + 6}" x2="${C}" y2="${C - 34}"/>
      <circle class="hub" cx="${C}" cy="${C}" r="2.6"/>`;
    [this.hour, this.min, this.sec] = Array.from(this.el.querySelectorAll('line[class^="hand"]')) as SVGLineElement[];
  }

  set(hour: number, minute: number, second: number): void {
    this.hour.setAttribute('transform', `rotate(${((hour % 12) + minute / 60) * 30} ${C} ${C})`);
    this.min.setAttribute('transform', `rotate(${(minute + second / 60) * 6} ${C} ${C})`);
    this.sec.setAttribute('transform', `rotate(${second * 6} ${C} ${C})`);
  }
}
