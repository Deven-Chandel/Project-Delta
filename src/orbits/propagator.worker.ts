/// <reference lib="webworker" />
/**
 * SGP4 propagation off the main thread. The main thread asks for a snapshot
 * at time t; we return ECI position and velocity for every satellite, and the
 * GPU extrapolates between snapshots (see satellites.ts), so motion stays
 * smooth even at 1000× while this worker runs only a few times per second.
 */
import { degreesToRadians, ecfToLookAngles, eciToEcf, gstime, propagate, twoline2satrec, type SatRec } from 'satellite.js';
import type { WorkerRequest, WorkerResponse } from './protocol';

let sats: (SatRec | null)[] = [];

function post(msg: WorkerResponse, transfer: Transferable[] = []): void {
  (self as DedicatedWorkerGlobalScope).postMessage(msg, transfer);
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  if (msg.type === 'init') {
    sats = msg.tles.map(([l1, l2]) => {
      try {
        const rec = twoline2satrec(l1, l2);
        return rec.error ? null : rec;
      } catch {
        return null;
      }
    });
    post({ type: 'ready', generation: msg.generation, count: sats.length });
    return;
  }

  if (msg.type === 'step') {
    const n = sats.length;
    const pos = new Float32Array(n * 3);
    const vel = new Float32Array(n * 3);
    const date = new Date(msg.time);
    for (let i = 0; i < n; i++) {
      const rec = sats[i];
      if (!rec) continue;
      const pv = propagate(rec, date);
      if (!pv || !Number.isFinite(pv.position.x)) continue;
      pos[i * 3] = pv.position.x;
      pos[i * 3 + 1] = pv.position.y;
      pos[i * 3 + 2] = pv.position.z;
      vel[i * 3] = pv.velocity.x;
      vel[i * 3 + 1] = pv.velocity.y;
      vel[i * 3 + 2] = pv.velocity.z;
    }
    post({ type: 'step', generation: msg.generation, time: msg.time, pos, vel }, [pos.buffer, vel.buffer]);
    return;
  }

  if (msg.type === 'sky') {
    const date = new Date(msg.time);
    const gmst = gstime(date);
    const observer = {
      latitude: degreesToRadians(msg.lat),
      longitude: degreesToRadians(msg.lon),
      height: 0.1,
    };
    const visible: [number, number, number, number][] = [];
    for (let i = 0; i < sats.length; i++) {
      const rec = sats[i];
      if (!rec) continue;
      const pv = propagate(rec, date);
      if (!pv || !Number.isFinite(pv.position.x)) continue;
      const look = ecfToLookAngles(observer, eciToEcf(pv.position, gmst));
      const el = (look.elevation * 180) / Math.PI;
      if (el > 0) visible.push([i, (look.azimuth * 180) / Math.PI, el, look.rangeSat]);
    }
    post({ type: 'sky', generation: msg.generation, time: msg.time, visible });
  }
};
