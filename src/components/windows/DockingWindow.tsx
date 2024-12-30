import { useEffect, useState, useRef } from 'react';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { Spacecraft } from '../../core/spacecraft';
import { SpacecraftController } from '../../controllers/spacecraftController';

interface DockingWindowProps {
    spacecraft: Spacecraft | null;
    controller: SpacecraftController | null;
}

interface DockingInfo {
    phase: string;
    range: number;
    closingSpeed: number;
    alignmentError: number;
    portAlignmentError: number;
    rollAlignmentError?: number;
    pitchError?: number;
    yawError?: number;
    lateralOffset?: {
        x: number;
        y: number;
    };
    relativeMotionPerp?: THREE.Vector3;
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
    targetSpacecraft: Spacecraft | null;
    ourPortId: 'front' | 'back' | null;
    targetPortId: 'front' | 'back' | null;
}

export interface AutopilotController {
    getTargetPoint: () => THREE.Vector3;
    getTargetObject: () => Spacecraft | null;
    setTargetObject: (target: Spacecraft | null, targetPoint: 'center' | 'front' | 'back') => void;
}

// Helper functions for vector conversions
const cannonToThree = (vec: CANNON.Vec3): THREE.Vector3 => {
    return new THREE.Vector3(vec.x, vec.y, vec.z);
};

const nullableVectorToThree = (vec: THREE.Vector3 | null): THREE.Vector3 => {
    if (!vec) return new THREE.Vector3();
    return vec;
};

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
        if (!spacecraft || !targetSpacecraft) {
            return false;
        }

        // Check if already docking
        if (spacecraft.dockingController?.isDocking()) {
            return true; // Allow canceling
        }

        // Check if ports are available
        if (!isPortAvailable('our', selectedPorts.our) || !isPortAvailable('target', selectedPorts.target)) {
            return false;
        }

        // Check if in range (50 meters)
        const ourPortPos = spacecraft.getDockingPortWorldPosition(selectedPorts.our);
        const targetPortPos = targetSpacecraft.getDockingPortWorldPosition(selectedPorts.target);
        if (!ourPortPos || !targetPortPos) {
            return false;
        }
        const range = ourPortPos.distanceTo(targetPortPos);
        return range <= 50;
    };

    // Draw vertical bar with logarithmic scale and arrows for out of bounds
    const drawVerticalBar = (
        ctx: CanvasRenderingContext2D,
        x: number,
        y: number,
        height: number,
        value: number,
        maxValue: number,
        label: string,
        unit: string = ''
    ) => {
        // Draw bar background
        ctx.strokeStyle = '#003300';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + height);
        ctx.stroke();

        // Calculate logarithmic position
        const logMax = Math.log10(maxValue + 1);
        const logValue = Math.log10(Math.abs(value) + 1);
        let normalizedPos = (logValue / logMax);
        if (value < 0) normalizedPos = -normalizedPos;
        
        // Clamp position to bar limits
        const clampedPos = Math.max(-1, Math.min(1, normalizedPos));
        const barY = y + height/2 - (clampedPos * height/2);

        // Draw indicator
        ctx.fillStyle = '#00ff00';
        if (Math.abs(value) > maxValue) {
            // Draw arrow for out of bounds
            const arrowSize = 5;
            ctx.beginPath();
            if (value > maxValue) {
                ctx.moveTo(x - arrowSize, y + arrowSize);
                ctx.lineTo(x, y);
                ctx.lineTo(x + arrowSize, y + arrowSize);
            } else {
                ctx.moveTo(x - arrowSize, y + height - arrowSize);
                ctx.lineTo(x, y + height);
                ctx.lineTo(x + arrowSize, y + height - arrowSize);
            }
            ctx.stroke();
        } else {
            // Draw normal indicator
            ctx.fillRect(x - 5, barY - 2, 10, 4);
        }

        // Draw label and value
        ctx.fillStyle = '#00ff00';
        ctx.font = '12px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(label, x - 10, y - 8);
        ctx.textAlign = 'left';
        ctx.fillText(`${value.toFixed(1)}${unit}`, x + 10, y - 8);

        // Draw scale marks with logarithmic spacing
        ctx.textAlign = 'left';
        const scalePoints = [-maxValue, -maxValue/2, 0, maxValue/2, maxValue];
        scalePoints.forEach(point => {
            const logPoint = Math.log10(Math.abs(point) + 1);
            const normalizedPoint = point < 0 ? -logPoint/logMax : logPoint/logMax;
            const scaleY = y + height/2 - (normalizedPoint * height/2);
            ctx.fillText(point.toFixed(1), x + 12, scaleY + 4);
            ctx.fillRect(x - 4, scaleY, 8, 1);
        });
    };

    // Draw docking visualization
    const drawDockingDisplay = (
        canvas: HTMLCanvasElement,
        range: number,
        closingSpeed: number,
        alignmentError: number,
        portAlignmentError: number,
        rollAlignmentError: number,
        relativeMotionPerp?: THREE.Vector3
    ) => {
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const width = canvas.width;
        const height = canvas.height;
        
        // Clear canvas with a solid black background
        ctx.fillStyle = 'rgb(0, 0, 0)';
        ctx.fillRect(0, 0, width, height);

        // Draw title bar
        ctx.fillStyle = '#00ff00';
        ctx.font = '14px monospace';
        ctx.textAlign = 'left';
        ctx.fillText('APPR/DOCK', 10, 20);
        ctx.fillText('IDS', 100, 20);
        ctx.fillText(`NAV2 ${(137.40).toFixed(2)}kHz`, width - 150, 20);

        // Draw center radar display
        const centerX = width/2;
        const centerY = height/2;
        const radarRadius = 120;

        // Draw radar circles
        ctx.strokeStyle = '#003300';
        for (let r = radarRadius/3; r <= radarRadius; r += radarRadius/3) {
            ctx.beginPath();
            ctx.arc(centerX, centerY, r, 0, Math.PI * 2);
            ctx.stroke();
        }

        // Draw radar crosshairs
        ctx.beginPath();
        ctx.moveTo(centerX - radarRadius, centerY);
        ctx.lineTo(centerX + radarRadius, centerY);
        ctx.moveTo(centerX, centerY - radarRadius);
        ctx.lineTo(centerX, centerY + radarRadius);
        ctx.stroke();

        // Draw target marker with roll indicator
        ctx.strokeStyle = '#00ff00';
        ctx.lineWidth = 2;
        
        // Center the target marker in the radar display
        const targetX = centerX;
        const targetY = centerY;
        
        // Draw target triangle
        const triangleSize = 12;
        ctx.beginPath();
        ctx.moveTo(targetX, targetY - triangleSize);
        ctx.lineTo(targetX + triangleSize, targetY + triangleSize);
        ctx.lineTo(targetX - triangleSize, targetY + triangleSize);
        ctx.closePath();
        ctx.stroke();

        // Draw roll alignment indicator (larger circle)
        const rollRadius = triangleSize * 4;
        ctx.beginPath();
        ctx.arc(targetX, targetY, rollRadius, 0, Math.PI * 2);
        ctx.stroke();

        // Draw roll alignment marker (larger)
        const rollMarkerSize = 6;
        const rollMarkerX = targetX + Math.cos(rollAlignmentError * Math.PI/180) * rollRadius;
        const rollMarkerY = targetY + Math.sin(rollAlignmentError * Math.PI/180) * rollRadius;
        ctx.beginPath();
        ctx.arc(rollMarkerX, rollMarkerY, rollMarkerSize, 0, Math.PI * 2);
        ctx.fill();

        // Draw port alignment vector (showing misalignment with target port)
        const alignmentVector = radarRadius * 0.8;
        const alignX = targetX + Math.sin(portAlignmentError * Math.PI/180) * alignmentVector;
        const alignY = targetY - Math.cos(portAlignmentError * Math.PI/180) * alignmentVector;
        
        ctx.beginPath();
        ctx.moveTo(targetX, targetY);
        ctx.lineTo(alignX, alignY);
        ctx.stroke();

        // Draw overall alignment error indicator
        const alignmentErrorRadius = radarRadius * 0.6;
        ctx.strokeStyle = alignmentError > 10 ? '#ff0000' : '#00ff00';
        ctx.beginPath();
        ctx.arc(targetX, targetY, alignmentErrorRadius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillText(`ALN ${alignmentError.toFixed(1)}°`, targetX - 30, targetY + alignmentErrorRadius + 20);

        // Draw relative motion vector
        if (relativeMotionPerp) {
            const motionScale = 40;
            const motionMagnitude = relativeMotionPerp.length();
            if (motionMagnitude > 0.01) {
                const normalizedMotion = relativeMotionPerp.clone().normalize();
                ctx.strokeStyle = '#ffff00';
                ctx.beginPath();
                ctx.moveTo(targetX, targetY);
                ctx.lineTo(
                    targetX + normalizedMotion.x * motionScale * motionMagnitude,
                    targetY + normalizedMotion.y * motionScale * motionMagnitude
                );
                ctx.stroke();
            }
        }

        // Draw vertical bars with logarithmic scales
        const barHeight = height - 100;
        const startY = 50;

        // Range bar (logarithmic from 0.1m to 100m)
        drawVerticalBar(ctx, width - 40, startY, barHeight, range, 100, 'DST', 'm');

        // Velocity bar (logarithmic from -1m/s to 1m/s)
        drawVerticalBar(ctx, width - 120, startY, barHeight, closingSpeed, 1, 'CVEL', 'm/s');

        // Port alignment bar (logarithmic from -45° to 45°)
        drawVerticalBar(ctx, 40, startY, barHeight, portAlignmentError, 45, 'PERR', '°');
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
        if (!spacecraft || !targetSpacecraft) return;

        const dockingController = spacecraft.dockingController;
        if (!dockingController) {
            console.warn('No docking controller found on spacecraft');
            return;
        }

        if (dockingController.isDocking()) {
            console.log('Canceling docking');
            dockingController.cancelDocking();
        } else {
            console.log('Starting docking with ports:', selectedPorts.our, selectedPorts.target);
            // Cast to any to bypass type checking since we know the spacecraft has all required properties
            dockingController.startDocking(
                targetSpacecraft as any,
                selectedPorts.our,
                selectedPorts.target
            );
        }
    };

    // Update docking information
    useEffect(() => {
        if (!spacecraft) return;

        const updateInterval = setInterval(() => {
            const dockingController = spacecraft.dockingController;

            // Get target either from docking controller or autopilot
            const target = dockingController?.isDocking()
                ? dockingController.targetSpacecraft
                : controller?.getAutopilot()?.getTargetObject();

            if (!target) {
                setDockingInfo({
                    phase: dockingController?.getDockingPhase() || 'idle',
                    range: 0,
                    closingSpeed: 0,
                    alignmentError: 0,
                    portAlignmentError: 0
                });
                return;
            }

            // Calculate relative position and velocity
            const ourVel = cannonToThree(spacecraft.objects.boxBody.velocity);
            const targetVel = cannonToThree(target.objects.boxBody.velocity);

            // Get positions based on active ports (either from docking controller or selected)
            const ourPortId = dockingController?.isDocking() ? dockingController.ourPortId : selectedPorts.our;
            const targetPortId = dockingController?.isDocking() ? dockingController.targetPortId : selectedPorts.target;

            const ourRefPos = spacecraft.getDockingPortWorldPosition(ourPortId || 'front');
            const targetRefPos = target.getDockingPortWorldPosition(targetPortId || 'back');

            if (!ourRefPos || !targetRefPos) {
                setDockingInfo({
                    phase: dockingController?.getDockingPhase() || 'idle',
                    range: 0,
                    closingSpeed: 0,
                    alignmentError: 0,
                    portAlignmentError: 0
                });
                return;
            }

            // Calculate range and closing speed
            const range = ourRefPos.distanceTo(targetRefPos);
            const relativeVel = new THREE.Vector3().subVectors(ourVel, targetVel);
            const rangeVector = new THREE.Vector3().subVectors(targetRefPos, ourRefPos).normalize();
            const closingSpeed = relativeVel.dot(rangeVector);

            // Create base info object
            const newInfo: DockingInfo = {
                phase: dockingController?.getDockingPhase() || 'idle',
                range: range,
                closingSpeed: closingSpeed,
                alignmentError: 0,
                portAlignmentError: 0,
                rollAlignmentError: 0,
                pitchError: 0,
                yawError: 0,
                lateralOffset: { x: 0, y: 0 }
            };

            // Calculate alignment errors
            const ourPortDir = nullableVectorToThree(spacecraft.getDockingPortWorldDirection(ourPortId || 'front'));
            const targetPortDir = nullableVectorToThree(target.getDockingPortWorldDirection(targetPortId || 'back'));

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

            setDockingInfo(newInfo);

            // Draw docking visualization
            drawDockingDisplay(
                canvasRef.current!,
                newInfo.range,
                newInfo.closingSpeed,
                newInfo.alignmentError,
                newInfo.portAlignmentError,
                newInfo.rollAlignmentError,
                newInfo.relativeMotionPerp
            );
        }, 1000 / 60);

        return () => clearInterval(updateInterval);
    }, [spacecraft, controller?.getAutopilot, selectedPorts]);

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
                className={`w-full px-2 py-1 rounded ${spacecraft?.dockingController?.isDocking() ? 'bg-red-500/30 border-red-500/50' : 'bg-cyan-500/30 border-cyan-500/50'} border text-white/90 text-sm font-mono`}
                onClick={handleDock}
                disabled={!canDock()}
            >
                {spacecraft?.dockingController?.isDocking() ? 'Cancel Docking' : 'Start Docking'}
            </button>

            {targetSpacecraft && (
                <div className="text-cyan-400 text-xs">
                    Target: {targetSpacecraft.name}
                </div>
            )}
        </div>
    );
} 