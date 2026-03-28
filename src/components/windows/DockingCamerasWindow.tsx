import React, { useMemo, useCallback, useState } from 'react';
import { BasicWorld } from '../../core/BasicWorld';
import { Spacecraft } from '../../core/spacecraft';
import type { PortId } from './DockingCameraView';
import { RangeInput } from '../ui/RangeInput';
import { CHECKBOX, FIELD_LABEL } from '../ui/styles';

interface DockingCamerasWindowProps {
    world: BasicWorld | null;
    version?: number;
    onToggleCamera?: (spacecraftUuid: string, portId: PortId) => void;
    openCameraKeys?: string[]; // keys as `${uuid}:${portId}`
}

export const DockingCamerasWindow: React.FC<DockingCamerasWindowProps> = ({ world, version = 0, onToggleCamera, openCameraKeys = [] }) => {
    // Local state for light params so sliders re-render without a forceRender hack
    const [lightParams, setLightParams] = useState<Record<string, { intensity: number; angle: number }>>({});

    const spacecraftList: Spacecraft[] = useMemo(() => {
        return world?.getSpacecraftList?.() ?? [];
    }, [world, version]);

    const isOpen = (uuid: string, portId: PortId) => openCameraKeys.includes(`${uuid}:${portId}`);

    const getLightParams = (sc: Spacecraft) => {
        if (lightParams[sc.uuid]) return lightParams[sc.uuid];
        const p = sc.getDockingLightParams?.();
        return { intensity: p?.intensity ?? 10, angle: p?.angle ?? Math.PI / 8 };
    };

    const handleStrengthChange = useCallback((sc: Spacecraft, e: React.ChangeEvent<HTMLInputElement>) => {
        const intensity = parseFloat(e.target.value);
        if (!isFinite(intensity)) return;
        sc.setDockingLightParams({ intensity });
        setLightParams(prev => ({
            ...prev,
            [sc.uuid]: { ...getLightParamsFromSc(sc), intensity },
        }));
    }, []);

    const handleApertureChange = useCallback((sc: Spacecraft, e: React.ChangeEvent<HTMLInputElement>) => {
        const deg = parseFloat(e.target.value);
        if (!isFinite(deg)) return;
        const angle = (Math.PI / 180) * deg;
        sc.setDockingLightParams({ angle });
        setLightParams(prev => ({
            ...prev,
            [sc.uuid]: { ...getLightParamsFromSc(sc), angle },
        }));
    }, []);

    return (
        <div className="flex flex-col gap-2">
            <div className="divide-y divide-white/10 rounded border border-white/10 overflow-hidden">
                {spacecraftList.length === 0 && (
                    <div className="px-3 py-2 text-white/60 text-xs">No spacecraft available</div>
                )}
                {spacecraftList.map((sc) => {
                    const params = getLightParams(sc);
                    const angleDeg = (params.angle * 180) / Math.PI;
                    return (
                        <div key={sc.uuid} className="px-3 py-2 bg-black/30">
                            <div className="text-white/90 text-xs font-semibold mb-2">{sc.name}</div>
                            <div className="flex gap-2 mb-2 items-center">
                                {(['front', 'back'] as PortId[]).map((port) => {
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
                                <div className="ml-2 flex items-center gap-3">
                                    {(['front', 'back'] as PortId[]).map((port) => (
                                        <label key={`toggle-${sc.uuid}-${port}`} className={`flex items-center gap-1 ${FIELD_LABEL}`}>
                                            <input
                                                type="checkbox"
                                                checked={sc.isDockingLightOn?.(port) ?? false}
                                                onChange={(e) => sc.setDockingLight?.(port, e.target.checked)}
                                                className={CHECKBOX}
                                            />
                                            {port === 'front' ? 'Front Light' : 'Back Light'}
                                        </label>
                                    ))}
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <RangeInput
                                    label="Flash Strength"
                                    value={params.intensity}
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
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

// Helper to read current params from spacecraft (outside React state)
function getLightParamsFromSc(sc: Spacecraft): { intensity: number; angle: number } {
    const p = sc.getDockingLightParams?.();
    return { intensity: p?.intensity ?? 10, angle: p?.angle ?? Math.PI / 8 };
}
