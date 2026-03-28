import type { ChartSource, AxisSide } from './types';
import type { RingBuffer } from './useChartData';
import { readAt } from './useChartData';

const LEFT_MARGIN = 38;
const RIGHT_MARGIN_AXIS = 38;
const RIGHT_MARGIN_NONE = 6;
const TOP_MARGIN = 14; // room for legend
const BOTTOM_MARGIN = 14;
const GRID_LINES = 4;

function niceStep(range: number, targetTicks: number): number {
  const rough = range / targetTicks;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  const nice = norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10;
  return nice * mag;
}

function autoRange(
  buffers: Map<string, RingBuffer>,
  sources: ChartSource[],
  side: AxisSide,
  tMin: number,
  tMax: number,
): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of sources) {
    if (s.axis !== side) continue;
    const rb = buffers.get(s.id);
    if (!rb || rb.count === 0) continue;
    for (let i = 0; i < rb.count; i++) {
      const { t, v } = readAt(rb, i);
      if (t < tMin || t > tMax) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  if (!isFinite(lo)) return [-1, 1];
  if (lo === hi) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.08;
  return [lo - pad, hi + pad];
}

export function drawChart(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  buffers: Map<string, RingBuffer>,
  sources: ChartSource[],
  elapsed: number,
  timeWindow: number,
  dpr: number,
): void {
  const w = width * dpr;
  const h = height * dpr;
  ctx.clearRect(0, 0, w, h);
  if (sources.length === 0) return;

  ctx.save();
  ctx.scale(dpr, dpr);

  const hasRight = sources.some(s => s.axis === 'right');
  const rightMargin = hasRight ? RIGHT_MARGIN_AXIS : RIGHT_MARGIN_NONE;
  const plotL = LEFT_MARGIN;
  const plotR = width - rightMargin;
  const plotT = TOP_MARGIN;
  const plotB = height - BOTTOM_MARGIN;
  const plotW = plotR - plotL;
  const plotH = plotB - plotT;

  if (plotW < 10 || plotH < 10) { ctx.restore(); return; }

  const tMax = elapsed;
  const tMin = elapsed - timeWindow;

  // Auto-range each axis
  const leftRange = autoRange(buffers, sources, 'left', tMin, tMax);
  const rightRange = hasRight ? autoRange(buffers, sources, 'right', tMin, tMax) : [0, 1] as [number, number];

  const mapX = (t: number) => plotL + ((t - tMin) / (tMax - tMin)) * plotW;
  const mapY = (v: number, range: [number, number]) =>
    plotB - ((v - range[0]) / (range[1] - range[0])) * plotH;

  // Grid lines (horizontal)
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= GRID_LINES; i++) {
    const y = Math.round(plotT + (i / GRID_LINES) * plotH) + 0.5;
    ctx.beginPath();
    ctx.moveTo(plotL, y);
    ctx.lineTo(plotR, y);
    ctx.stroke();
  }

  // Grid lines (vertical — time)
  const timeStep = niceStep(timeWindow, 5);
  const tStart = Math.ceil(tMin / timeStep) * timeStep;
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.font = '10px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let t = tStart; t <= tMax; t += timeStep) {
    const x = Math.round(mapX(t)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, plotT);
    ctx.lineTo(x, plotB);
    ctx.stroke();
    ctx.fillText(`${t.toFixed(0)}s`, x, plotB + 2);
  }

  // Y-axis tick labels
  ctx.font = '10px monospace';
  ctx.textBaseline = 'middle';

  // Left axis
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  const lStep = niceStep(leftRange[1] - leftRange[0], GRID_LINES);
  const lStart = Math.ceil(leftRange[0] / lStep) * lStep;
  for (let v = lStart; v <= leftRange[1]; v += lStep) {
    const y = mapY(v, leftRange);
    if (y < plotT - 2 || y > plotB + 2) continue;
    ctx.fillText(formatTick(v), plotL - 3, y);
  }

  // Right axis
  if (hasRight) {
    ctx.textAlign = 'left';
    const rStep = niceStep(rightRange[1] - rightRange[0], GRID_LINES);
    const rStart = Math.ceil(rightRange[0] / rStep) * rStep;
    for (let v = rStart; v <= rightRange[1]; v += rStep) {
      const y = mapY(v, rightRange);
      if (y < plotT - 2 || y > plotB + 2) continue;
      ctx.fillText(formatTick(v), plotR + 3, y);
    }
  }

  // Plot area clip
  ctx.save();
  ctx.beginPath();
  ctx.rect(plotL, plotT, plotW, plotH);
  ctx.clip();

  // Draw series
  for (const s of sources) {
    const rb = buffers.get(s.id);
    if (!rb || rb.count === 0) continue;
    const range = s.axis === 'left' ? leftRange : rightRange;

    ctx.strokeStyle = s.color;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < rb.count; i++) {
      const { t, v } = readAt(rb, i);
      if (t < tMin) continue;
      const x = mapX(t);
      const y = mapY(v, range);
      if (!started) { ctx.moveTo(x, y); started = true; }
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  ctx.restore(); // unclip

  // Legend (top-left, inside plot area)
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  let lx = plotL + 4;
  for (const s of sources) {
    ctx.fillStyle = s.color;
    ctx.fillRect(lx, plotT - 10, 6, 6);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    const labelW = ctx.measureText(s.label).width;
    ctx.fillText(s.label, lx + 8, plotT - 7);
    lx += 8 + labelW + 10;
  }

  ctx.restore(); // unscale
}

function formatTick(v: number): string {
  const abs = Math.abs(v);
  if (abs === 0) return '0';
  if (abs >= 1000) return v.toFixed(0);
  if (abs >= 10) return v.toFixed(1);
  if (abs >= 1) return v.toFixed(2);
  return v.toFixed(3);
}
