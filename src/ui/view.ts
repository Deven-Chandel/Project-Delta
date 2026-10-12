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
  /** Focused row (UTC offset key). */
  focusKey: number | null;
  /** Bumped when the user explicitly asks to see the focused row on the map. */
  flySeq: number;
}

type Listener = (v: ViewState, prev: ViewState) => void;

class View {
  private state: ViewState = { eventAt: null, eventTitle: '', hoverAt: null, focusKey: null, flySeq: 0 };
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

  /** Focus a row and fly the map to it. */
  fly(key: number): void {
    this.set({ focusKey: key, flySeq: this.state.flySeq + 1 });
  }

  /** The instant the board should describe: crosshair, then event, then now. */
  instant(now: number): number {
    return this.state.hoverAt ?? this.state.eventAt ?? now;
  }
}

export const view = new View();
