import { useEffect, useState, useRef } from 'react';
import * as THREE from 'three';
import { Spacecraft } from '../../core/spacecraft';
import { SpacecraftController } from '../../controllers/spacecraftController';
import { DockingPhase } from '../../controllers/docking/DockingController';

interface DockingWindowProps {
    spacecraft: Spacecraft | null;
    controller: SpacecraftController | null;
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

export function DockingWindow({ spacecraft, controller }: DockingWindowProps): JSX.Element {
    const canvasRef = useRef<HTMLCanvasElement>(null);
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

    // Get target spacecraft from autopilot if available
    const targetSpacecraft = controller?.getAutopilot()?.getTargetObject();

    // Check if port is available
    const isPortAvailable = (craftId: 'our' | 'target', portId: 'front' | 'back'): boolean => {
        // Basic validation
        if (!spacecraft || !targetSpacecraft || spacecraft === targetSpacecraft) {
            return false;
        }
        
        // Get the correct spacecraft
        const craft = craftId === 'our' ? spacecraft : targetSpacecraft;
        
        // Check if the port exists and is available
        if (!craft.dockingPorts || !craft.dockingPorts[portId]) {
            console.warn(`Port ${portId} not found on ${craftId === 'our' ? 'our' : 'target'} spacecraft`);
            return false;
        }
        
        // Check if the port is occupied
        const isOccupied = craft.dockingPorts[portId].isOccupied;
        if (isOccupied) {
            console.log(`Port ${portId} on ${craftId === 'our' ? 'our' : 'target'} spacecraft is occupied`);
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
        if (!targetSpacecraft) {
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

        // If we have a target, update the autopilot target point
        if (targetSpacecraft && controller) {
            controller.getAutopilot().setTargetObject(targetSpacecraft, newPorts.target);
        }
    };

    // Handle port selection
    const handlePortSelect = (type: 'our' | 'target', port: 'front' | 'back') => {
        const newPorts = {
            ...selectedPorts,
            [type]: port
        };
        setSelectedPorts(newPorts);
        saveSettings(newPorts);

        // Update autopilot target point if we're changing target port
        if (type === 'target' && controller && targetSpacecraft) {
            controller.getAutopilot().setTargetObject(targetSpacecraft, port);
        }

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
            console.warn('No docking controller found on spacecraft');
            return;
        }

        if (dockingController.getDockingPhase() === 'docked') {
            console.log('Undocking');
            dockingController.undock();
        } else if (dockingController.isDocking()) {
            console.log('Canceling docking');
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
            // Update autopilot target to maintain target selection
            if (targetSpacecraft && controller) {
                controller.getAutopilot().setTargetObject(targetSpacecraft, selectedPorts.target);
            }
        } else if (targetSpacecraft) {
            console.log('Starting docking with ports:', selectedPorts.our, selectedPorts.target);
            dockingController.startDocking(
                targetSpacecraft as any,
                selectedPorts.our,
                selectedPorts.target
            );
        }
    };

    // Update docking information
    useEffect(() => {
        const updateInterval = setInterval(() => {
            if (!spacecraft || !targetSpacecraft) return;

            const dockingController = spacecraft.dockingController;
            if (!dockingController) return;

            // Get positions and velocities
            const ourVel = new THREE.Vector3(
                spacecraft.objects.boxBody.velocity.x,
                spacecraft.objects.boxBody.velocity.y,
                spacecraft.objects.boxBody.velocity.z
            );
            const targetVel = new THREE.Vector3(
                targetSpacecraft.objects.boxBody.velocity.x,
                targetSpacecraft.objects.boxBody.velocity.y,
                targetSpacecraft.objects.boxBody.velocity.z
            );

            // Get port positions
            const ourPortId = dockingController.isDocking() ? dockingController.ourPortId : selectedPorts.our;
            const targetPortId = dockingController.isDocking() ? dockingController.targetPortId : selectedPorts.target;
            const ourRefPos = spacecraft.getDockingPortWorldPosition(ourPortId || 'front');
            const targetRefPos = targetSpacecraft.getDockingPortWorldPosition(targetPortId || 'back');

            if (!ourRefPos || !targetRefPos) return;

            // Calculate range and closing speed
            const range = ourRefPos.distanceTo(targetRefPos);
            const relativeVel = new THREE.Vector3().subVectors(ourVel, targetVel);
            const rangeVector = new THREE.Vector3().subVectors(targetRefPos, ourRefPos).normalize();
            const closingSpeed = relativeVel.dot(rangeVector);

            // Get trajectory information
            const trajectory = dockingController.getTrajectory();
            const currentWaypoint = dockingController.getCurrentWaypointIndex();
            const totalWaypoints = trajectory ? trajectory.getWaypoints().length : 0;
            const waypointThreshold = dockingController.getCurrentWaypointThreshold();
            const distanceToWaypoint = dockingController.getDistanceToWaypoint() || 0;

            // Create base info object
            const newInfo: DockingInfo = {
                phase: dockingController.getDockingPhase(),
                range,
                closingSpeed,
                alignmentError: 0,
                portAlignmentError: 0,
                rollAlignmentError: 0,
                pitchError: 0,
                yawError: 0,
                lateralOffset: { x: 0, y: 0 },
                currentWaypoint,
                totalWaypoints,
                waypointThreshold,
                distanceToWaypoint
            };

            // Calculate alignment errors
            const ourPortDir = spacecraft.getDockingPortWorldDirection(ourPortId || 'front');
            const targetPortDir = targetSpacecraft.getDockingPortWorldDirection(targetPortId || 'back');
            
            if (ourPortDir && targetPortDir) {
                // Port alignment error (angle between port directions)
                const portAlignmentError = Math.acos(Math.min(1, Math.max(-1, ourPortDir.dot(targetPortDir.negate()))));
                
                // Calculate relative position vector
                const relativePos = new THREE.Vector3().subVectors(targetRefPos, ourRefPos);
                
                // Calculate pitch and yaw errors
                // Project onto vertical plane for pitch
                const pitchPlaneNormal = new THREE.Vector3(1, 0, 0); // X-axis for pitch
                const pitchProjected = new THREE.Vector3().copy(ourPortDir)
                    .projectOnPlane(pitchPlaneNormal).normalize();
                const targetPitchProjected = new THREE.Vector3().copy(targetPortDir)
                    .projectOnPlane(pitchPlaneNormal).normalize();
                const pitchError = Math.acos(Math.min(1, Math.max(-1, pitchProjected.dot(targetPitchProjected))));
                
                // Project onto horizontal plane for yaw
                const yawPlaneNormal = new THREE.Vector3(0, 1, 0); // Y-axis for yaw
                const yawProjected = new THREE.Vector3().copy(ourPortDir)
                    .projectOnPlane(yawPlaneNormal).normalize();
                const targetYawProjected = new THREE.Vector3().copy(targetPortDir)
                    .projectOnPlane(yawPlaneNormal).normalize();
                const yawError = Math.acos(Math.min(1, Math.max(-1, yawProjected.dot(targetYawProjected))));

                // Calculate lateral offset (perpendicular to target port direction)
                const lateralOffset = new THREE.Vector3().copy(relativePos);
                const alongPort = targetPortDir.multiplyScalar(relativePos.dot(targetPortDir));
                lateralOffset.sub(alongPort);

                // Calculate roll alignment error using right vectors
                const worldUp = new THREE.Vector3(0, 1, 0);
                const ourRight = new THREE.Vector3().crossVectors(ourPortDir, worldUp).normalize();
                const targetRight = new THREE.Vector3().crossVectors(targetPortDir, worldUp).normalize();
                const rollAlignmentError = Math.acos(Math.min(1, Math.max(-1, ourRight.dot(targetRight))));

                // Update info with calculated values
                newInfo.portAlignmentError = THREE.MathUtils.radToDeg(portAlignmentError);
                newInfo.rollAlignmentError = THREE.MathUtils.radToDeg(rollAlignmentError);
                newInfo.pitchError = THREE.MathUtils.radToDeg(pitchError) * Math.sign(ourPortDir.y - targetPortDir.y);
                newInfo.yawError = THREE.MathUtils.radToDeg(yawError) * Math.sign(ourPortDir.x - targetPortDir.x);
                newInfo.lateralOffset = {
                    x: lateralOffset.x,
                    y: lateralOffset.y
                };

                // Calculate relative motion perpendicular to docking axis
                const relativeMotionPerp = new THREE.Vector3().copy(relativeVel);
                const motionAlongPort = targetPortDir.multiplyScalar(relativeVel.dot(targetPortDir));
                relativeMotionPerp.sub(motionAlongPort);
                newInfo.relativeMotionPerp = relativeMotionPerp;
            }

            setDockingInfo(newInfo);
        }, 100);

        return () => clearInterval(updateInterval);
    }, [spacecraft, targetSpacecraft, selectedPorts]);

    return (
        <div className="flex flex-col gap-2 p-2 font-mono text-xs">
            <div className="grid grid-cols-3 gap-2 text-cyan-400">
                <div>Phase: {dockingInfo.phase}</div>
                <div>Range: {dockingInfo.range.toFixed(2)}m</div>
                <div>Speed: {dockingInfo.closingSpeed.toFixed(2)}m/s</div>
                <div>Pitch: {dockingInfo.pitchError?.toFixed(1)}°</div>
                <div>Yaw: {dockingInfo.yawError?.toFixed(1)}°</div>
                <div>Roll: {dockingInfo.rollAlignmentError?.toFixed(1)}°</div>
                <div>X-off: {dockingInfo.lateralOffset?.x.toFixed(2)}m</div>
                <div>Y-off: {dockingInfo.lateralOffset?.y.toFixed(2)}m</div>
                <div>PERR: {dockingInfo.portAlignmentError?.toFixed(1)}°</div>
                <div>Waypoint: {dockingInfo.currentWaypoint !== undefined ? dockingInfo.currentWaypoint + 1 : '-'}/{dockingInfo.totalWaypoints || '-'}</div>
                <div>Threshold: {dockingInfo.waypointThreshold?.toFixed(2)}m</div>
                <div>To WP: {dockingInfo.distanceToWaypoint?.toFixed(2)}m</div>
            </div>

            <canvas 
                ref={canvasRef}
                width={400}
                height={300}
                className="bg-black border border-white/20 rounded"
            />

            <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1">
                    <div className="text-white/50">Our Port:</div>
                    <div className="flex gap-1">
                        <button
                            className={`flex-1 px-2 py-1 rounded ${selectedPorts.our === 'front' ? 'bg-cyan-500/30 border-cyan-500/50' : 'bg-black/60 border-white/20'} border text-white/90 text-xs font-mono ${
                                isPortAvailable('our', 'front') ? '' : 'text-red-400'
                            }`}
                            onClick={() => handlePortSelect('our', 'front')}
                        >
                            Front
                        </button>
                        <button
                            className={`flex-1 px-2 py-1 rounded ${selectedPorts.our === 'back' ? 'bg-cyan-500/30 border-cyan-500/50' : 'bg-black/60 border-white/20'} border text-white/90 text-xs font-mono ${
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
                            className={`flex-1 px-2 py-1 rounded ${selectedPorts.target === 'front' ? 'bg-cyan-500/30 border-cyan-500/50' : 'bg-black/60 border-white/20'} border text-white/90 text-xs font-mono ${
                                !targetSpacecraft ? 'opacity-50' :
                                isPortAvailable('target', 'front') ? '' : 'text-red-400'
                            }`}
                            onClick={() => handlePortSelect('target', 'front')}
                            disabled={!targetSpacecraft}
                        >
                            Front
                        </button>
                        <button
                            className={`flex-1 px-2 py-1 rounded ${selectedPorts.target === 'back' ? 'bg-cyan-500/30 border-cyan-500/50' : 'bg-black/60 border-white/20'} border text-white/90 text-xs font-mono ${
                                !targetSpacecraft ? 'opacity-50' :
                                isPortAvailable('target', 'back') ? '' : 'text-red-400'
                            }`}
                            onClick={() => handlePortSelect('target', 'back')}
                            disabled={!targetSpacecraft}
                        >
                            Back
                        </button>
                    </div>
                </div>
            </div>

            <button
                className={`w-full px-2 py-1 rounded ${
                    spacecraft?.dockingController?.getDockingPhase() === 'docked'
                        ? 'bg-yellow-500/30 border-yellow-500/50'
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

            {targetSpacecraft && (
                <div className="text-cyan-400 text-xs">
                    Target: {targetSpacecraft.name}
                </div>
            )}
        </div>
    );
} 