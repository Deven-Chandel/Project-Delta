/**
 * Transient view state shared by the board, converter, events list and map:
 * which instant is being inspected (a converted event, or the timeline
 * crosshair) and which clock row is focused. Not persisted.
 */
export interface ViewState {
  /** Instant the converter is showing; null = live "now". */
  eventAt: number | null;
  eventTitle: string;
  /** Instant under the timeline crosshair; null when not hovering. */
  hoverAt: number | null;
  /** Row the user chose (clicked) — stays until cleared. */
  focusKey: number | null;
  /** Row under the mouse on the timeline — clears when the mouse leaves. */
  hoverKey: number | null;
  /** Bumped when the user explicitly asks to see the focused row on the map. */
  flySeq: number;
  /** On phones, whether that request should also open the Map tab. */
  flyShow: boolean;
}

type Listener = (v: ViewState, prev: ViewState) => void;

class View {
  private state: ViewState = { eventAt: null, eventTitle: '', hoverAt: null, focusKey: null, hoverKey: null, flySeq: 0, flyShow: false };
  private listeners = new Set<Listener>();

  get(): ViewState {
    return this.state;
  }

  set(patch: Partial<ViewState>): void {
    const prev = this.state;
    this.state = { ...prev, ...patch };
    for (const l of this.listeners) l(this.state, prev);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Focus a row and frame its sites on the map (and open the Map tab on phones if `show`). */
  fly(key: number, show = false): void {
    this.set({ focusKey: key, flySeq: this.state.flySeq + 1, flyShow: show });
  }

  /** Row to highlight: a hovered row wins over the chosen one. */
  highlight(): number | null {
    return this.state.hoverKey ?? this.state.focusKey;
  }

  /** The instant the board should describe: crosshair, then event, then now. */
  instant(now: number): number {
    return this.state.hoverAt ?? this.state.eventAt ?? now;
  }
}

export const view = new View();
