import React, { useRef, useEffect } from 'react';
import { useElementSize } from '../../hooks/useElementSize';
import { useChartData } from './chart/useChartData';
import { drawChart } from './chart/drawChart';
import type { ChartWindowProps } from './chart/types';

export type { ChartSource, AxisSide, ChartWindowProps } from './chart/types';

export const ChartWindow: React.FC<ChartWindowProps> = ({
  sources,
  timeWindow = 30,
  sampleInterval = 100,
  capacity = 600,
}) => {
  const dataRef = useChartData(sources, sampleInterval, capacity);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { width, height } = useElementSize(containerRef.current);

  // Resize canvas backing store when container changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !width || !height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
  }, [width, height]);

  // rAF draw loop — reads refs, no React renders
  useEffect(() => {
    let raf: number;
    const loop = () => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (ctx && width && height) {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const d = dataRef.current;
        drawChart(ctx, width, height, d.buffers, sources, d.elapsed, timeWindow, dpr);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [sources, timeWindow, width, height, dataRef]);

  return (
    <div ref={containerRef} className="relative w-full h-full min-h-[100px]">
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full block" />
    </div>
  );
};
