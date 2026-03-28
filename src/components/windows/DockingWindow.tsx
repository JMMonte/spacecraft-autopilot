import { useEffect, useMemo, useState, ChangeEvent } from 'react';
import type { JSX } from 'react';
import * as THREE from 'three';
import { Spacecraft } from '../../core/spacecraft';
import { SpacecraftController } from '../../controllers/spacecraftController';
import { DockingPhase } from '../../controllers/docking/DockingController';
import { createLogger } from '../../utils/logger';
import { EMPTY_STATE, INPUT_BASE } from '../ui/styles';
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
    intent?: string;
    modes?: { orientationMatch: boolean; cancelRotation: boolean; cancelLinearMotion: boolean; pointToPosition: boolean; goToPosition: boolean };
}

interface PortSettings {
    our: string;
    target: string;
}

interface PortSettingsMap {
    [key: string]: PortSettings;
}

export interface DockingController {
    isDocking: () => boolean;
    getDockingPhase: () => string;
    cancelDocking: () => void;
    startDocking: (target: Spacecraft, ourPort: string, targetPort: string) => void;
    undock: () => boolean;
    targetSpacecraft: Spacecraft | null;
    ourPortId: string | null;
    targetPortId: string | null;
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

    // Get port IDs for a spacecraft
    const getPortIds = (craft: Spacecraft | null): string[] => {
        if (!craft?.dockingPorts) return [];
        return Object.keys(craft.dockingPorts);
    };

    const ourPorts = useMemo(() => getPortIds(spacecraft), [spacecraft, version]);
    const targetPorts = useMemo(() => getPortIds(selectedTarget), [selectedTarget, version]);

    // Check if port is available
    const isPortAvailable = (craftId: 'our' | 'target', portId: string): boolean => {
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
            const defaultOur = ourPorts[0] || 'front';
            const defaultTarget = targetPorts.length > 1 ? targetPorts[1] : targetPorts[0] || 'back';
            const savedSettings = portSettings[spacecraft.name] || {
                our: defaultOur,
                target: defaultTarget,
            };
            setSelectedPorts(savedSettings);
        }
    }, [spacecraft?.name, portSettings, ourPorts, targetPorts]);

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
    const handlePortSelect = (type: 'our' | 'target', port: string) => {
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

        const isDocked = (spacecraft.getDockedSpacecrafts?.() || []).length > 0 || dockingController.getDockingPhase() === 'docked';
        if (isDocked) {
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
                selectedPorts.our as any,
                selectedPorts.target as any
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

            // Guidance status
            const guidance = (dockingController as any).getGuidanceStatus?.();

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
                distanceToWaypoint,
                intent: guidance?.intent || undefined,
                modes: guidance?.modes || undefined
            };

            setDockingInfo(newInfo);
        }, 100);

        return () => clearInterval(updateInterval);
    }, [spacecraft, selectedTarget, selectedPorts]);

    const portLabel = (id: string) => id.charAt(0).toUpperCase() + id.slice(1);
    const isDocked = (spacecraft?.getDockedSpacecrafts?.() || []).length > 0 || spacecraft?.dockingController?.getDockingPhase() === 'docked';
    const isActive = spacecraft?.dockingController?.isDocking();

    return (
        <div className="flex flex-col gap-1.5 p-1 text-[10px]">
            {/* Phase status */}
            <div className={`font-medium ${dockingInfo.phase === 'idle' ? 'text-white/50' : dockingInfo.phase === 'docked' ? 'text-green-400' : 'text-yellow-400'}`}>
                Phase: {dockingInfo.phase.toUpperCase()}
                {dockingInfo.intent && <span className="ml-2 font-normal text-white/60">{dockingInfo.intent}</span>}
            </div>

            {/* === Setup: Target + Ports === */}
            <div className="flex flex-col gap-1">
                {/* Target spacecraft selector */}
                {otherSpacecraft.length > 0 ? (
                    <select
                        className={INPUT_BASE}
                        value={selectedTarget?.name || ''}
                        onChange={(e: ChangeEvent<HTMLSelectElement>) => {
                            const target = otherSpacecraft.find(s => s.name === e.target.value) || null;
                            setSelectedTarget(target);
                        }}
                    >
                        <option value="">Select target...</option>
                        {otherSpacecraft.map(s => (
                            <option key={s.name} value={s.name}>{s.name} ({Object.keys(s.dockingPorts).length}p)</option>
                        ))}
                    </select>
                ) : (
                    <div className={EMPTY_STATE}>No other spacecraft</div>
                )}

                {/* Port selectors — compact dropdowns that scale to any port count */}
                <div className="grid grid-cols-2 gap-1.5">
                    <div>
                        <div className="text-white/40 mb-0.5">Our port</div>
                        <select
                            className={INPUT_BASE}
                            value={selectedPorts.our}
                            onChange={(e: ChangeEvent<HTMLSelectElement>) => handlePortSelect('our', e.target.value)}
                        >
                            {ourPorts.map(id => (
                                <option key={id} value={id} disabled={!isPortAvailable('our', id)}>
                                    {portLabel(id)}{!isPortAvailable('our', id) ? ' (used)' : ''}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <div className="text-white/40 mb-0.5">Target port</div>
                        <select
                            className={INPUT_BASE}
                            value={selectedPorts.target}
                            onChange={(e: ChangeEvent<HTMLSelectElement>) => handlePortSelect('target', e.target.value)}
                            disabled={!selectedTarget}
                        >
                            {targetPorts.length > 0 ? targetPorts.map(id => (
                                <option key={id} value={id} disabled={!isPortAvailable('target', id)}>
                                    {portLabel(id)}{!isPortAvailable('target', id) ? ' (used)' : ''}
                                </option>
                            )) : <option value="">--</option>}
                        </select>
                    </div>
                </div>

                {/* Dock / Cancel / Undock button */}
                <button
                    className={`w-full px-2 py-1 rounded border text-white/90 ${
                        isDocked ? 'bg-green-500/30 border-green-500/50'
                            : isActive ? 'bg-red-500/30 border-red-500/50'
                            : 'bg-cyan-500/30 border-cyan-500/50'
                    } ${!isActive && !canDock() && !isDocked ? 'opacity-50' : ''}`}
                    onClick={handleDock}
                    disabled={!isActive && !canDock() && !isDocked}
                >
                    {isDocked ? 'Undock' : isActive ? 'Cancel Docking' : 'Start Docking'}
                </button>
            </div>

            {/* === Telemetry === */}
            <div className="grid grid-cols-3 gap-x-2 gap-y-0.5 text-cyan-300/90">
                <div className={Math.abs(dockingInfo.closingSpeed) > 0.5 ? 'text-red-400' : ''}>
                    Range: {dockingInfo.range.toFixed(2)}m
                </div>
                <div className={Math.abs(dockingInfo.closingSpeed) > 0.5 ? 'text-red-400' : ''}>
                    Spd: {dockingInfo.closingSpeed.toFixed(2)}m/s
                </div>
                <div className={Math.abs(dockingInfo.portAlignmentError || 0) > 5 ? 'text-red-400' : ''}>
                    Err: {(dockingInfo.portAlignmentError || 0).toFixed(1)}°
                </div>
                <div className={Math.abs(dockingInfo.pitchError || 0) > 5 ? 'text-red-400' : ''}>
                    P: {(dockingInfo.pitchError || 0).toFixed(1)}°
                </div>
                <div className={Math.abs(dockingInfo.yawError || 0) > 5 ? 'text-red-400' : ''}>
                    Y: {(dockingInfo.yawError || 0).toFixed(1)}°
                </div>
                <div className={Math.abs(dockingInfo.rollAlignmentError || 0) > 5 ? 'text-red-400' : ''}>
                    R: {(dockingInfo.rollAlignmentError || 0).toFixed(1)}°
                </div>
                <div className={Math.abs(dockingInfo.lateralOffset?.x || 0) > 0.5 ? 'text-red-400' : ''}>
                    Lx: {(dockingInfo.lateralOffset?.x || 0).toFixed(2)}m
                </div>
                <div className={Math.abs(dockingInfo.lateralOffset?.y || 0) > 0.5 ? 'text-red-400' : ''}>
                    Ly: {(dockingInfo.lateralOffset?.y || 0).toFixed(2)}m
                </div>
                <div className="text-white/50">
                    WP: {dockingInfo.currentWaypoint !== undefined ? dockingInfo.currentWaypoint + 1 : '-'}/{dockingInfo.totalWaypoints || '-'}
                </div>
            </div>

            {/* Autopilot mode indicators */}
            {dockingInfo.modes && (
                <div className="flex gap-1.5 text-white/40 flex-wrap">
                    {(['goToPosition', 'orientationMatch', 'cancelLinearMotion', 'cancelRotation', 'pointToPosition'] as const).map(m => (
                        <span key={m} className={dockingInfo.modes![m] ? 'text-cyan-300/90' : ''}>
                            {m === 'goToPosition' ? 'GoTo' : m === 'orientationMatch' ? 'Orient' : m === 'cancelLinearMotion' ? 'Hold' : m === 'cancelRotation' ? 'NoSpin' : 'Point'}
                        </span>
                    ))}
                </div>
            )}

            {/* Lights — compact row */}
            <div className="flex items-center gap-2 text-white/40">
                <span>Lights:</span>
                {ourPorts.map(portId => (
                    <label key={portId} className="flex items-center gap-0.5 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={!!spacecraft?.isDockingLightOn?.(portId)}
                            onChange={(e) => spacecraft?.setDockingLight?.(portId, e.target.checked)}
                            className="w-2.5 h-2.5 rounded border-white/20 bg-black/40 checked:bg-cyan-300/40 checked:border-cyan-300/60 focus:ring-0 focus:ring-offset-0"
                        />
                        <span className="capitalize">{portId.slice(0, 1).toUpperCase()}</span>
                    </label>
                ))}
            </div>
        </div>
    );
} 
