import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { BasicWorld } from '../../core/BasicWorld';
import { Spacecraft } from '../../core/spacecraft';
import { useElementSize } from '../../hooks/useElementSize';

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

  return (
    <div ref={containerRef} className="w-full h-full bg-black/50 rounded overflow-hidden border border-white/10">
      <canvas ref={canvasRef} className="w-full h-full block" />
    </div>
  );
};

