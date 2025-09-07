import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { BasicWorld } from '../../core/BasicWorld';
import { Spacecraft } from '../../core/spacecraft';
import { useElementSize } from '../../hooks/useElementSize';

type PortId = 'front' | 'back';

interface DockingCamerasWindowProps {
    world: BasicWorld | null;
    version?: number;
}

interface CameraViewConfig {
    id: string;
    spacecraftUuid: string | null;
    portId: PortId;
}

const DockingCameraView: React.FC<{
    world: BasicWorld;
    spacecraft: Spacecraft | null;
    portId: PortId;
}> = ({ world, spacecraft, portId }) => {
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
            logarithmicDepthBuffer: true
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
                    // Update size from container
                    const w = Math.max(1, Math.floor(width || 200));
                    const h = Math.max(1, Math.floor(height || 150));
                    if ((renderer.getSize(new THREE.Vector2()).x !== w) || (renderer.getSize(new THREE.Vector2()).y !== h)) {
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
        <div ref={containerRef} className="w-full aspect-video bg-black/40 rounded overflow-hidden border border-white/10">
            <canvas ref={canvasRef} className="w-full h-full block" />
        </div>
    );
};

export const DockingCamerasWindow: React.FC<DockingCamerasWindowProps> = ({ world, version = 0 }) => {
    const [views, setViews] = useState<CameraViewConfig[]>(() => [
        { id: 'view-1', spacecraftUuid: null, portId: 'front' }
    ]);

    const spacecraftList: Spacecraft[] = useMemo(() => {
        return world?.getSpacecraftList?.() ?? [];
    }, [world, version]);

    const addView = useCallback(() => {
        setViews(prev => {
            const nextId = `view-${prev.length + 1}`;
            const firstCraft = spacecraftList[0]?.uuid ?? null;
            return [...prev, { id: nextId, spacecraftUuid: firstCraft, portId: 'front' }];
        });
    }, [spacecraftList]);

    const removeView = useCallback((id: string) => {
        setViews(prev => prev.filter(v => v.id !== id));
    }, []);

    const updateView = useCallback((id: string, updates: Partial<CameraViewConfig>) => {
        setViews(prev => prev.map(v => v.id === id ? { ...v, ...updates } : v));
    }, []);

    useEffect(() => {
        // Ensure each view has a valid spacecraft when list changes
        if (!spacecraftList.length) return;
        setViews(prev => prev.map(v => ({
            ...v,
            spacecraftUuid: v.spacecraftUuid ?? spacecraftList[0].uuid
        })));
    }, [spacecraftList]);

    return (
        <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
                <div className="text-sm text-white/70">Add multiple views to monitor docking</div>
                <button
                    className="px-2 py-1 text-xs bg-white/10 hover:bg-white/20 rounded border border-white/20"
                    onClick={addView}
                >
                    + Add View
                </button>
            </div>

            <div className="flex flex-col gap-3">
                {views.map((view) => {
                    const spacecraft = spacecraftList.find(s => s.uuid === view.spacecraftUuid) ?? null;
                    return (
                        <div key={view.id} className="p-2 bg-black/30 rounded border border-white/10">
                            <div className="flex items-center gap-2 mb-2">
                                <select
                                    className="bg-black/40 text-white/90 text-xs rounded px-2 py-1 border border-white/20"
                                    value={view.spacecraftUuid ?? ''}
                                    onChange={(e) => updateView(view.id, { spacecraftUuid: e.target.value })}
                                >
                                    {spacecraftList.map(sc => (
                                        <option key={sc.uuid} value={sc.uuid}>{sc.name}</option>
                                    ))}
                                </select>
                                <select
                                    className="bg-black/40 text-white/90 text-xs rounded px-2 py-1 border border-white/20"
                                    value={view.portId}
                                    onChange={(e) => updateView(view.id, { portId: e.target.value as PortId })}
                                >
                                    <option value="front">Front Port</option>
                                    <option value="back">Back Port</option>
                                </select>
                                <button
                                    className="ml-auto px-2 py-1 text-xs bg-white/10 hover:bg-white/20 rounded border border-white/20"
                                    onClick={() => removeView(view.id)}
                                >
                                    Remove
                                </button>
                            </div>
                            <DockingCameraView
                                world={world as BasicWorld}
                                spacecraft={spacecraft}
                                portId={view.portId}
                            />
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
