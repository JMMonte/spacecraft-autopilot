import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import * as THREE from 'three';
import { BasicWorld } from '../../core/BasicWorld';
import { Spacecraft } from '../../core/spacecraft';
import { useElementSize } from '../../hooks/useElementSize';
import { RangeInput } from '../ui/RangeInput';
import { NumberInput } from '../ui/NumberInput';

export type PortId = 'front' | 'back';

interface DockingCameraViewProps {
  world: BasicWorld | null;
  spacecraft: Spacecraft | null;
  portId: PortId;
}

export const DockingCameraView: React.FC<DockingCameraViewProps> = ({ world, spacecraft, portId }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  // Measure only the viewport (canvas) area, not the whole component
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const { width, height } = useElementSize(viewportRef.current);
  const [fov, setFov] = useState<number>(60);
  const lightParams = useMemo(() => spacecraft?.getDockingLightParams?.() ?? null, [spacecraft, width, height]);

  const handleStrengthChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (!spacecraft) return;
    const intensity = parseFloat(e.target.value);
    if (!isFinite(intensity)) return;
    spacecraft.setDockingLightParams({ intensity });
  }, [spacecraft]);

  const handleApertureChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (!spacecraft) return;
    const deg = parseFloat(e.target.value);
    if (!isFinite(deg)) return;
    const angle = (Math.PI / 180) * deg; // degrees to radians (SpotLight half-angle)
    spacecraft.setDockingLightParams({ angle });
  }, [spacecraft]);

  const handleLightToggle = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    spacecraft?.setDockingLight?.(portId, e.target.checked);
  }, [spacecraft, portId]);

  useEffect(() => {
    if (!canvasRef.current) return;
    const renderer = new THREE.WebGLRenderer({
      canvas: canvasRef.current,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
      logarithmicDepthBuffer: true,
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    rendererRef.current = renderer;
    return () => {
      renderer.dispose();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    let raf: number;
    const loop = () => {
      const renderer = rendererRef.current;
      if (renderer && world && spacecraft) {
        const cam = spacecraft.getDockingPortCamera(portId);
        const scene = world.camera?.scene as THREE.Scene;
        if (cam && scene) {
          const w = Math.max(1, Math.floor(width || 200));
          const h = Math.max(1, Math.floor(height || 150));
          const size = renderer.getSize(new THREE.Vector2());
          if (size.x !== w || size.y !== h) {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            renderer.setPixelRatio(dpr);
            renderer.setSize(w, h, false);
          }
          // Keep camera aspect up to date
          cam.aspect = w / h;
          cam.updateProjectionMatrix();
          renderer.render(scene, cam);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [world, spacecraft, portId, width, height]);

  // Initialize and keep local FOV value in sync with the camera on mount/changes
  useEffect(() => {
    const cam = spacecraft?.getDockingPortCamera(portId);
    if (cam) setFov(cam.fov);
  }, [spacecraft, portId]);

  const clampFov = (v: number) => Math.min(120, Math.max(20, v));
  const handleFovSlider = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = clampFov(Number(e.target.value));
    setFov(v);
    const cam = spacecraft?.getDockingPortCamera(portId);
    if (cam) { cam.fov = v; cam.updateProjectionMatrix(); }
  };
  const handleFovInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = clampFov(Number(e.target.value));
    setFov(v);
    const cam = spacecraft?.getDockingPortCamera(portId);
    if (cam) { cam.fov = v; cam.updateProjectionMatrix(); }
  };

  return (
    <div className="relative w-full h-full bg-black/50 rounded overflow-hidden border border-white/10 flex flex-col">
      {/* Viewport fills remaining space */}
      <div ref={viewportRef} className="relative flex-1 min-h-[120px]">
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full block" />
        {/* Crosshair overlay */}
        <div className="pointer-events-none absolute inset-0">
          {/* Horizontal line */}
          <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-px bg-white/50" />
          {/* Vertical line */}
          <div className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-px bg-white/50" />
          {/* Center dot */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-white/80 shadow-[0_0_6px_rgba(255,255,255,0.8)]" />
        </div>
      </div>

      {/* Controls footer */}
      <div className="px-2 py-2 bg-black/60 border-t border-white/10">
        {/* Light toggle */}
        <div className="flex items-center justify-between mb-2">
          <label className="flex items-center gap-1 text-[10px] text-white/80 font-mono">
            <input
              type="checkbox"
              checked={!!spacecraft?.isDockingLightOn?.(portId)}
              onChange={handleLightToggle}
              className="w-3 h-3 rounded border-white/30 bg-black/40 checked:bg-cyan-300/40 checked:border-cyan-300/60 focus:ring-0 focus:ring-offset-0"
            />
            Light
          </label>
          <div className="text-[10px] text-white/50 font-mono">{portId === 'front' ? 'Front Port' : 'Back Port'}</div>
        </div>

        {/* Strength + Aperture */}
        <div className="grid grid-cols-2 gap-3 mb-3">
          <RangeInput
            label="Strength"
            value={lightParams?.intensity ?? 10}
            onChange={handleStrengthChange}
            min={0}
            max={30}
            step={0.5}
          />
          <RangeInput
            label="Aperture (deg)"
            value={((lightParams?.angle ?? Math.PI / 8) * 180) / Math.PI}
            onChange={handleApertureChange}
            min={5}
            max={60}
            step={1}
          />
        </div>

        {/* FOV controls: hug content height */}
        <div className="flex items-end gap-2">
          <div className="flex-1 min-w-[160px]">
            <RangeInput
              label="FOV"
              unit="deg"
              value={fov}
              onChange={handleFovSlider}
              min={20}
              max={120}
              step={1}
              className="text-[10px]"
            />
          </div>
          <div className="w-20">
            <NumberInput
              value={Number.isFinite(fov as number) ? Number((fov ?? 60).toFixed(1)) : 60}
              onChange={handleFovInput}
              step={1}
              className="text-[10px]"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
