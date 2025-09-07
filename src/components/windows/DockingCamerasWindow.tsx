import React, { useMemo } from 'react';
import { BasicWorld } from '../../core/BasicWorld';
import { Spacecraft } from '../../core/spacecraft';
import type { PortId } from './DockingCameraView';

interface DockingCamerasWindowProps {
    world: BasicWorld | null;
    version?: number;
    onToggleCamera?: (spacecraftUuid: string, portId: PortId) => void;
    openCameraKeys?: string[]; // keys as `${uuid}:${portId}`
}

export const DockingCamerasWindow: React.FC<DockingCamerasWindowProps> = ({ world, version = 0, onToggleCamera, openCameraKeys = [] }) => {
    const spacecraftList: Spacecraft[] = useMemo(() => {
        return world?.getSpacecraftList?.() ?? [];
    }, [world, version]);

    const isOpen = (uuid: string, portId: PortId) => openCameraKeys.includes(`${uuid}:${portId}`);

    return (
        <div className="flex flex-col gap-2">
            <div className="text-sm text-white/70">Click a camera to toggle its window</div>
            <div className="divide-y divide-white/10 rounded border border-white/10 overflow-hidden">
                {spacecraftList.length === 0 && (
                    <div className="px-3 py-2 text-white/60 text-xs">No spacecraft available</div>
                )}
                {spacecraftList.map((sc) => (
                    <div key={sc.uuid} className="px-3 py-2 bg-black/30">
                        <div className="text-white/90 text-xs font-semibold mb-2">{sc.name}</div>
                        <div className="flex gap-2">
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
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};
