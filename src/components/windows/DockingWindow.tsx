import { useEffect, useMemo, useState, ChangeEvent } from 'react';
import * as THREE from 'three';
import { Spacecraft } from '../../core/spacecraft';
import { SpacecraftController } from '../../controllers/spacecraftController';
import { DockingPhase } from '../../controllers/docking/DockingController';
import { createLogger } from '../../utils/logger';
import { BasicWorld } from '../../core/BasicWorld';

interface DockingWindowProps {
    spacecraft: Spacecraft | null;
    controller: SpacecraftController | null;
    world?: BasicWorld | null;
    version?: number;
}

interface DockingInfo {
    phase: DockingPhase;
    range: number;
    closingSpeed: number;
    alignmentError: number;
    portAlignmentError: number;
    rollAlignmentError?: number;
    pitchError?: number;
    yawError?: number;
    lateralOffset?: { x: number; y: number };
    relativeMotionPerp?: THREE.Vector3;
    currentWaypoint?: number;
    totalWaypoints?: number;
    waypointThreshold?: number;
    distanceToWaypoint?: number;
}

interface PortSettings {
    our: 'front' | 'back';
    target: 'front' | 'back';
}

interface PortSettingsMap {
    [key: string]: PortSettings;
}

export interface DockingController {
    isDocking: () => boolean;
    getDockingPhase: () => string;
    cancelDocking: () => void;
    startDocking: (target: Spacecraft, ourPort: 'front' | 'back', targetPort: 'front' | 'back') => void;
    undock: () => boolean;
    targetSpacecraft: Spacecraft | null;
    ourPortId: 'front' | 'back' | null;
    targetPortId: 'front' | 'back' | null;
}

export interface AutopilotController {
    getTargetPoint: () => THREE.Vector3;
    getTargetObject: () => Spacecraft | null;
    setTargetObject: (target: Spacecraft | null, targetPoint: 'center' | 'front' | 'back') => void;
}

export function DockingWindow({ spacecraft, world, version }: DockingWindowProps): JSX.Element {
    const log = createLogger('ui:DockingWindow');
    const [dockingInfo, setDockingInfo] = useState<DockingInfo>({
        phase: 'idle',
        range: 0,
        closingSpeed: 0,
        alignmentError: 0,
        portAlignmentError: 0
    });
    const [portSettings, setPortSettings] = useState<PortSettingsMap>({});
    const [selectedPorts, setSelectedPorts] = useState<PortSettings>({
        our: 'front',
        target: 'back'
    });

    // Manage independent target selection for docking
    const [selectedTarget, setSelectedTarget] = useState<Spacecraft | null>(null);
    const otherSpacecraft = useMemo(() => {
        const w = world ?? spacecraft?.basicWorld ?? null;
        return w?.getSpacecraftList()?.filter(s => s !== spacecraft) ?? [];
    }, [world, spacecraft, version]);

    // Keep selected target reference in sync if list refreshes
    useEffect(() => {
        if (!selectedTarget) return;
        const stillExists = otherSpacecraft.find(s => s.name === selectedTarget.name) || null;
        if (!stillExists) {
            setSelectedTarget(null);
        }
    }, [otherSpacecraft, selectedTarget]);

    // Check if port is available
    const isPortAvailable = (craftId: 'our' | 'target', portId: 'front' | 'back'): boolean => {
        // Basic validation
        if (!spacecraft || !selectedTarget || spacecraft === selectedTarget) {
            return false;
        }
        
        // Get the correct spacecraft
        const craft = craftId === 'our' ? spacecraft : selectedTarget;
        
        // Check if the port exists and is available
        if (!craft.dockingPorts || !craft.dockingPorts[portId]) {
            log.warn(`Port ${portId} not found on ${craftId === 'our' ? 'our' : 'target'} spacecraft`);
            return false;
        }
        
        // Check if the port is occupied
        const isOccupied = craft.dockingPorts[portId].isOccupied;
        if (isOccupied) {
            log.info(`Port ${portId} on ${craftId === 'our' ? 'our' : 'target'} spacecraft is occupied`);
        }
        
        return !isOccupied;
    };

    // Check if docking is possible
    const canDock = () => {
        if (!spacecraft) {
            return false;
        }

        // If we're already docking or docked, always allow the button
        if (spacecraft.dockingController?.isDocking() || spacecraft.dockingController?.getDockingPhase() === 'docked') {
            return true;
        }

        // For starting new docking, check all conditions
        if (!selectedTarget) {
            return false;
        }

        // Check if ports are available
        if (!isPortAvailable('our', selectedPorts.our) || !isPortAvailable('target', selectedPorts.target)) {
            return false;
        }

        return true;
    };

    // Load settings when spacecraft changes
    useEffect(() => {
        if (spacecraft?.name) {
            const savedSettings = portSettings[spacecraft.name] || {
                our: 'front',
                target: 'back'
            };
            setSelectedPorts(savedSettings);
        }
    }, [spacecraft?.name, portSettings]);

    // Save settings whenever they change
    const saveSettings = (newPorts: PortSettings) => {
        if (!spacecraft?.name) return;

        const updatedSettings = {
            ...portSettings,
            [spacecraft.name]: newPorts
        };
        setPortSettings(updatedSettings);

        // Do not modify Autopilot's target from Docking UI
    };

    // Handle port selection
    const handlePortSelect = (type: 'our' | 'target', port: 'front' | 'back') => {
        const newPorts = {
            ...selectedPorts,
            [type]: port
        };
        setSelectedPorts(newPorts);
        saveSettings(newPorts);

        // If we're already docking, update the ports
        if (spacecraft?.dockingController?.isDocking()) {
            handleDock(); // This will restart docking with new ports
        }
    };

    // Handle starting/stopping docking
    const handleDock = () => {
        if (!spacecraft) return;
        
        const dockingController = spacecraft.dockingController;
        if (!dockingController) {
            log.warn('No docking controller found on spacecraft');
            return;
        }

        if (dockingController.getDockingPhase() === 'docked') {
            log.info('Undocking');
            dockingController.undock();
        } else if (dockingController.isDocking()) {
            log.info('Canceling docking');
            dockingController.cancelDocking();
            // Force update the docking info to reflect the cancelled state
            setDockingInfo(prev => ({
                ...prev,
                phase: 'idle',
                range: 0,
                closingSpeed: 0,
                alignmentError: 0,
                portAlignmentError: 0
            }));
        } else if (selectedTarget) {
            log.info('Starting docking with ports:', selectedPorts.our, selectedPorts.target);
            dockingController.startDocking(
                selectedTarget as any,
                selectedPorts.our,
                selectedPorts.target
            );
        }
    };

    // Update docking information
    useEffect(() => {
        const updateInterval = setInterval(() => {
            if (!spacecraft || !selectedTarget) return;

            const dockingController = spacecraft.dockingController;
            if (!dockingController) return;

            // Get basic info
            const phase = dockingController.getDockingPhase();
            const range = dockingController.getRange() ?? 0;
            const closingSpeed = dockingController.getClosingSpeed() ?? 0;

            // Get alignment info
            const alignmentInfo = dockingController.getPortAlignmentInfo();

            // Get trajectory info
            const trajectory = dockingController.getTrajectory();
            const currentWaypoint = dockingController.getCurrentWaypointIndex();
            const totalWaypoints = trajectory ? trajectory.getWaypoints().length : 0;
            const waypointThreshold = dockingController.getCurrentWaypointThreshold();
            const distanceToWaypoint = dockingController.getDistanceToWaypoint() ?? 0;

            // Create info object
            const newInfo: DockingInfo = {
                phase,
                range,
                closingSpeed,
                alignmentError: 0,
                portAlignmentError: alignmentInfo?.portAlignmentError ?? 0,
                rollAlignmentError: alignmentInfo?.rollError ?? 0,
                pitchError: alignmentInfo?.pitchError ?? 0,
                yawError: alignmentInfo?.yawError ?? 0,
                lateralOffset: alignmentInfo ? {
                    x: alignmentInfo.lateralOffset.x,
                    y: alignmentInfo.lateralOffset.y
                } : { x: 0, y: 0 },
                currentWaypoint,
                totalWaypoints,
                waypointThreshold,
                distanceToWaypoint
            };

            setDockingInfo(newInfo);
        }, 100);

        return () => clearInterval(updateInterval);
    }, [spacecraft, selectedTarget, selectedPorts]);

    return (
        <div className="flex flex-col gap-0.5 p-1 font-mono text-[10px]">
            <div className="grid grid-cols-3 gap-2 text-cyan-400">
                <div className={`col-span-3 ${dockingInfo.phase === 'idle' ? 'text-white/50' : dockingInfo.phase === 'docked' ? 'text-green-400' : 'text-yellow-400'}`}>
                    Phase: {dockingInfo.phase.toUpperCase()}
                </div>
                
                <div className={`${Math.abs(dockingInfo.closingSpeed) > 0.5 ? 'text-red-400' : 'text-cyan-400'}`}>
                    Range: {dockingInfo.range.toFixed(2)}m
                </div>
                <div className={`${Math.abs(dockingInfo.closingSpeed) > 0.5 ? 'text-red-400' : 'text-cyan-400'}`}>
                    Speed: {dockingInfo.closingSpeed.toFixed(2)}m/s
                </div>
                <div className={`${Math.abs(dockingInfo.portAlignmentError || 0) > 5 ? 'text-red-400' : 'text-cyan-400'}`}>
                    PERR: {(dockingInfo.portAlignmentError || 0).toFixed(1)}°
                </div>

                <div className={`${Math.abs(dockingInfo.pitchError || 0) > 5 ? 'text-red-400' : 'text-cyan-400'}`}>
                    Pitch: {(dockingInfo.pitchError || 0).toFixed(1)}°
                </div>
                <div className={`${Math.abs(dockingInfo.yawError || 0) > 5 ? 'text-red-400' : 'text-cyan-400'}`}>
                    Yaw: {(dockingInfo.yawError || 0).toFixed(1)}°
                </div>
                <div className={`${Math.abs(dockingInfo.rollAlignmentError || 0) > 5 ? 'text-red-400' : 'text-cyan-400'}`}>
                    Roll: {(dockingInfo.rollAlignmentError || 0).toFixed(1)}°
                </div>

                <div className={`${Math.abs(dockingInfo.lateralOffset?.x || 0) > 0.5 ? 'text-red-400' : 'text-cyan-400'}`}>
                    X-off: {(dockingInfo.lateralOffset?.x || 0).toFixed(2)}m
                </div>
                <div className={`${Math.abs(dockingInfo.lateralOffset?.y || 0) > 0.5 ? 'text-red-400' : 'text-cyan-400'}`}>
                    Y-off: {(dockingInfo.lateralOffset?.y || 0).toFixed(2)}m
                </div>
                <div className="text-white/50">
                    WP: {dockingInfo.currentWaypoint !== undefined ? dockingInfo.currentWaypoint + 1 : '-'}/{dockingInfo.totalWaypoints || '-'}
                </div>
            </div>

            <div className="grid grid-cols-2 gap-2 mt-2">
                <div className="flex flex-col gap-1">
                    <div className="text-white/50">Our Port:</div>
                    <div className="flex gap-1">
                        <button
                            className={`flex-1 px-1 py-0.5 rounded ${selectedPorts.our === 'front' ? 'bg-cyan-500/30 border-cyan-500/50' : 'bg-black/40 border-white/20'} border text-white/90 text-[10px] font-mono ${
                                isPortAvailable('our', 'front') ? '' : 'text-red-400'
                            }`}
                            onClick={() => handlePortSelect('our', 'front')}
                        >
                            Front
                        </button>
                        <button
                            className={`flex-1 px-1 py-0.5 rounded ${selectedPorts.our === 'back' ? 'bg-cyan-500/30 border-cyan-500/50' : 'bg-black/40 border-white/20'} border text-white/90 text-[10px] font-mono ${
                                isPortAvailable('our', 'back') ? '' : 'text-red-400'
                            }`}
                            onClick={() => handlePortSelect('our', 'back')}
                        >
                            Back
                        </button>
                    </div>
                </div>

                <div className="flex flex-col gap-1">
                    <div className="text-white/50">Target Port:</div>
                    <div className="flex gap-1">
                        <button
                            className={`flex-1 px-1 py-0.5 rounded ${selectedPorts.target === 'front' ? 'bg-cyan-500/30 border-cyan-500/50' : 'bg-black/40 border-white/20'} border text-white/90 text-[10px] font-mono ${
                                !selectedTarget ? 'opacity-50' :
                                isPortAvailable('target', 'front') ? '' : 'text-red-400'
                            }`}
                            onClick={() => handlePortSelect('target', 'front')}
                            disabled={!selectedTarget}
                        >
                            Front
                        </button>
                        <button
                            className={`flex-1 px-1 py-0.5 rounded ${selectedPorts.target === 'back' ? 'bg-cyan-500/30 border-cyan-500/50' : 'bg-black/40 border-white/20'} border text-white/90 text-[10px] font-mono ${
                                !selectedTarget ? 'opacity-50' :
                                isPortAvailable('target', 'back') ? '' : 'text-red-400'
                            }`}
                            onClick={() => handlePortSelect('target', 'back')}
                            disabled={!selectedTarget}
                        >
                            Back
                        </button>
                    </div>
                </div>
            </div>

            <button
                className={`w-full mt-2 px-2 py-1 rounded ${
                    spacecraft?.dockingController?.getDockingPhase() === 'docked'
                        ? 'bg-green-500/30 border-green-500/50'
                        : spacecraft?.dockingController?.isDocking()
                            ? 'bg-red-500/30 border-red-500/50'
                            : 'bg-cyan-500/30 border-cyan-500/50'
                } border text-white/90 text-sm font-mono ${
                    spacecraft?.dockingController?.isDocking() ? '' : !canDock() ? 'opacity-50' : ''
                }`}
                onClick={handleDock}
                disabled={!spacecraft?.dockingController?.isDocking() && !canDock()}
            >
                {spacecraft?.dockingController?.getDockingPhase() === 'docked'
                    ? 'Undock'
                    : spacecraft?.dockingController?.isDocking()
                        ? 'Cancel Docking'
                        : 'Start Docking'}
            </button>

            {/* Target selection */}
            <div className="mt-2 space-y-0.5">
                <div className="text-white/50">Target Spacecraft:</div>
                {otherSpacecraft.length > 0 ? (
                    <select
                        className="w-full px-1 py-0.5 bg-black/60 text-white/90 border border-white/20 text-[10px] font-mono focus:outline-none focus:border-cyan-500/50"
                        value={selectedTarget?.name || ''}
                        onChange={(e: ChangeEvent<HTMLSelectElement>) => {
                            const name = e.target.value;
                            const target = otherSpacecraft.find(s => s.name === name) || null;
                            setSelectedTarget(target);
                        }}
                    >
                        <option value="">Select Spacecraft</option>
                        {otherSpacecraft.map(s => (
                            <option key={s.name} value={s.name}>{s.name}</option>
                        ))}
                    </select>
                ) : (
                    <div className="text-white/50 italic text-center bg-black/40 p-1 text-[10px] border border-white/10">
                        No other spacecraft available
                    </div>
                )}
            </div>

            {selectedTarget && (
                <div className="text-cyan-400 text-[10px] mt-1">
                    Target: {selectedTarget.name}
                </div>
            )}
        </div>
    );
} 
