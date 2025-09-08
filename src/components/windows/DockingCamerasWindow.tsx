import React, { useMemo, useCallback, useState } from 'react';
import { BasicWorld } from '../../core/BasicWorld';
import { Spacecraft } from '../../core/spacecraft';
import type { PortId } from './DockingCameraView';
import { RangeInput } from '../ui/RangeInput';

interface DockingCamerasWindowProps {
    world: BasicWorld | null;
    version?: number;
    onToggleCamera?: (spacecraftUuid: string, portId: PortId) => void;
    openCameraKeys?: string[]; // keys as `${uuid}:${portId}`
}

export const DockingCamerasWindow: React.FC<DockingCamerasWindowProps> = ({ world, version = 0, onToggleCamera, openCameraKeys = [] }) => {
    const [, forceRender] = useState(0);
    const spacecraftList: Spacecraft[] = useMemo(() => {
        return world?.getSpacecraftList?.() ?? [];
    }, [world, version]);

    const isOpen = (uuid: string, portId: PortId) => openCameraKeys.includes(`${uuid}:${portId}`);

    const handleStrengthChange = useCallback((sc: Spacecraft, e: React.ChangeEvent<HTMLInputElement>) => {
        const intensity = parseFloat(e.target.value);
        if (!isFinite(intensity)) return;
        sc.setDockingLightParams({ intensity });
        // Keep the slider responsive
        forceRender((n) => n + 1);
    }, []);

    const handleApertureChange = useCallback((sc: Spacecraft, e: React.ChangeEvent<HTMLInputElement>) => {
        const deg = parseFloat(e.target.value);
        if (!isFinite(deg)) return;
        // Convert degrees (UI) to radians (Three.js uses half-angle in radians)
        const angle = (Math.PI / 180) * deg;
        sc.setDockingLightParams({ angle });
        forceRender((n) => n + 1);
    }, []);

    return (
        <div className="flex flex-col gap-2">
            <div className="divide-y divide-white/10 rounded border border-white/10 overflow-hidden">
                {spacecraftList.length === 0 && (
                    <div className="px-3 py-2 text-white/60 text-xs">No spacecraft available</div>
                )}
                {spacecraftList.map((sc) => (
                    <div key={sc.uuid} className="px-3 py-2 bg-black/30">
                        <div className="text-white/90 text-xs font-semibold mb-2">{sc.name}</div>
                        <div className="flex gap-2 mb-2 items-center">
                            {(['front','back'] as PortId[]).map((port) => {
                                const open = isOpen(sc.uuid, port);
                                return (
                                    <button
                                        key={`${sc.uuid}:${port}`}
                                        className={`px-2 py-1 text-xs rounded border transition-colors duration-150 ${open ? 'bg-emerald-500/20 border-emerald-400/40 text-emerald-200' : 'bg-white/10 border-white/20 text-white/90 hover:bg-white/20'}`}
                                        onClick={() => onToggleCamera?.(sc.uuid, port)}
                                    >
                                        {port === 'front' ? 'Front' : 'Back'} {open ? '• Open' : ''}
                                    </button>
                                );
                            })}
                            {/* Quick light toggles */}
                            <div className="ml-2 flex items-center gap-3">
                                {(['front','back'] as PortId[]).map((port) => (
                                    <label key={`toggle-${sc.uuid}-${port}`} className="flex items-center gap-1 text-[10px] text-white/70 font-mono">
                                        <input
                                            type="checkbox"
                                            checked={!!sc.isDockingLightOn?.(port)}
                                            onChange={(e) => sc.setDockingLight?.(port, e.target.checked)}
                                            className="w-3 h-3 rounded border-white/30 bg-black/40 checked:bg-cyan-300/40 checked:border-cyan-300/60 focus:ring-0 focus:ring-offset-0"
                                        />
                                        {port === 'front' ? 'Front Light' : 'Back Light'}
                                    </label>
                                ))}
                            </div>
                        </div>
                        {/* Docking flashlight controls */}
                        <div className="grid grid-cols-2 gap-3">
                            {(() => {
                                const p = sc.getDockingLightParams?.();
                                const intensity = p?.intensity ?? 10;
                                const angleDeg = ((p?.angle ?? Math.PI / 8) * 180) / Math.PI;
                                return (
                                    <>
                                        <RangeInput
                                            label="Flash Strength"
                                            value={intensity}
                                            onChange={(e) => handleStrengthChange(sc, e)}
                                            min={0}
                                            max={30}
                                            step={0.5}
                                            className=""
                                        />
                                        <RangeInput
                                            label="Aperture (deg)"
                                            value={angleDeg}
                                            onChange={(e) => handleApertureChange(sc, e)}
                                            min={5}
                                            max={60}
                                            step={1}
                                            className=""
                                        />
                                    </>
                                );
                            })()}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};
