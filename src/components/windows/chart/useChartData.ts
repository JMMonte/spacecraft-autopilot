import { useRef, useEffect } from 'react';
import type { ChartSource } from './types';

export interface RingBuffer {
  data: Float64Array;
  times: Float64Array;
  head: number;
  count: number;
  capacity: number;
}

function createRingBuffer(capacity: number): RingBuffer {
  return {
    data: new Float64Array(capacity),
    times: new Float64Array(capacity),
    head: 0,
    count: 0,
    capacity,
  };
}

function push(rb: RingBuffer, time: number, value: number) {
  rb.data[rb.head] = value;
  rb.times[rb.head] = time;
  rb.head = (rb.head + 1) % rb.capacity;
  if (rb.count < rb.capacity) rb.count++;
}

/** Read the i-th oldest sample (0 = oldest visible). */
export function readAt(rb: RingBuffer, i: number): { t: number; v: number } {
  const idx = (rb.head - rb.count + i + rb.capacity) % rb.capacity;
  return { t: rb.times[idx], v: rb.data[idx] };
}

export interface ChartDataRef {
  buffers: Map<string, RingBuffer>;
  elapsed: number;
}

/**
 * Samples all sources at a fixed interval into ring buffers.
 * Returns a stable ref — no React re-renders on each tick.
 */
export function useChartData(
  sources: ChartSource[],
  sampleInterval: number,
  capacity: number,
): React.RefObject<ChartDataRef> {
  const ref = useRef<ChartDataRef>({ buffers: new Map(), elapsed: 0 });

  // Reset buffers when sources change identity
  useEffect(() => {
    const buffers = new Map<string, RingBuffer>();
    for (const s of sources) {
      buffers.set(s.id, createRingBuffer(capacity));
    }
    ref.current = { buffers, elapsed: 0 };
  }, [sources, capacity]);

  // Sampling loop
  useEffect(() => {
    const t0 = performance.now();
    const id = setInterval(() => {
      const elapsed = (performance.now() - t0) / 1000;
      ref.current.elapsed = elapsed;
      for (const s of sources) {
        const rb = ref.current.buffers.get(s.id);
        if (!rb) continue;
        const v = s.sample();
        if (v !== null && isFinite(v)) {
          push(rb, elapsed, v);
        }
      }
    }, sampleInterval);
    return () => clearInterval(id);
  }, [sources, sampleInterval]);

  return ref;
}
