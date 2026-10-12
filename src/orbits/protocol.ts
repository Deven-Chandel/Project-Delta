/** Messages between the main thread and the propagation worker. */
export type WorkerRequest =
  | { type: 'init'; generation: number; tles: [string, string][] }
  | { type: 'step'; generation: number; time: number }
  | { type: 'sky'; generation: number; time: number; lat: number; lon: number };

export type WorkerResponse =
  | { type: 'ready'; generation: number; count: number }
  | { type: 'step'; generation: number; time: number; pos: Float32Array; vel: Float32Array }
  | { type: 'sky'; generation: number; time: number; visible: [index: number, az: number, el: number, rangeKm: number][] };
