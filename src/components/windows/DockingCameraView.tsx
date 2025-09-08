import React, { useEffect, useRef, useState, ChangeEvent } from 'react';
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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { width, height } = useElementSize(containerRef.current);
  const [fov, setFov] = useState<number>(60);

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

  // Initialize FOV from the current docking camera when available or when portId/spacecraft changes
  useEffect(() => {
    if (!spacecraft) return;
    const cam = spacecraft.getDockingPortCamera(portId);
    if (cam) setFov(cam.fov);
  }, [spacecraft, portId]);

  const applyFov = (nextFov: number) => {
    setFov(nextFov);
    const cam = spacecraft?.getDockingPortCamera(portId);
    if (cam) {
      cam.fov = nextFov;
      cam.updateProjectionMatrix();
    }
  };

  const onFovSlider = (e: ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    applyFov(Math.min(120, Math.max(20, v)));
  };

  const onFovInput = (e: ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    if (!Number.isFinite(v)) return;
    applyFov(Math.min(120, Math.max(20, v)));
  };

  return (
    <div ref={containerRef} className="relative w-full h-full bg-black/50 rounded overflow-hidden border border-white/10">
      <canvas ref={canvasRef} className="w-full h-full block" />
      {/* Crosshair overlay */}
      <div className="pointer-events-none absolute inset-0">
        {/* Horizontal line */}
        <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-px bg-white/50" />
        {/* Vertical line */}
        <div className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-px bg-white/50" />
        {/* Center dot */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-white/80 shadow-[0_0_6px_rgba(255,255,255,0.8)]" />
      </div>
      <div className="absolute top-1 left-1 right-1 pointer-events-none">
        <div className="flex items-end gap-1 bg-black/40 backdrop-blur px-1 py-1 rounded border border-white/10 w-auto pointer-events-auto">
          <div className="flex-1 min-w-[120px]">
            <RangeInput
              label="FOV"
              unit="deg"
              value={fov}
              onChange={onFovSlider}
              min={20}
              max={120}
              step={1}
              className="text-[10px]"
            />
          </div>
          <div className="w-16">
            <NumberInput
              value={Number.isFinite(fov) ? Number(fov.toFixed(1)) : 60}
              onChange={onFovInput}
              step={1}
              className="text-[10px]"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
