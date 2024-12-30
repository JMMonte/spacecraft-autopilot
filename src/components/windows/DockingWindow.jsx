import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { ChevronDown } from 'lucide-react';

export function DockingWindow({ spacecraft, world, controller, version }) {
    const canvasRef = useRef(null);
    const [dockingInfo, setDockingInfo] = useState({
        phase: 'idle',
        range: 0,
        closingSpeed: 0,
        alignmentError: 0,
        portAlignmentError: 0
    });
    
    // Store port settings per spacecraft using their names as keys
    const [portSettings, setPortSettings] = useState({});
    const [selectedPorts, setSelectedPorts] = useState({
        our: 'front',
        target: 'back'
    });

    // Get the world instance from the spacecraft
    const worldInstance = spacecraft?.world;
    // Load settings when active spacecraft changes or when autopilot target changes
    useEffect(() => {
        if (spacecraft?.name && controller?.autopilot) {
            // Get the target port from autopilot if it's targeting a docking port
            const targetPoint = controller.autopilot.targetPoint;
            const isTargetingDockingPort = targetPoint === 'front' || targetPoint === 'back';

            // Load saved settings or use defaults
            const savedSettings = portSettings[spacecraft.name] || {
                our: 'front',
                target: 'back'
            };

            // Update selected ports
            setSelectedPorts({
                our: savedSettings.our,
                target: isTargetingDockingPort ? targetPoint : savedSettings.target
            });
            
            // Save settings if we're targeting a docking port
            if (isTargetingDockingPort) {
                saveSettings({
                    ...savedSettings,
                    target: targetPoint
                });
            }
        }
    }, [spacecraft?.name, controller?.autopilot?.targetPoint, version]);

    // Save settings whenever they change
    const saveSettings = (newPorts) => {
        if (!spacecraft?.name) return;
        
        const updatedSettings = {
            ...portSettings,
            [spacecraft.name]: newPorts
        };
        setPortSettings(updatedSettings);
        
        // If we have a target, update the autopilot target point
        if (targetSpacecraft && controller?.autopilot) {
            controller.autopilot.setTargetObject(targetSpacecraft, newPorts.target);
        }
    };

    // Get target spacecraft from autopilot if available
    const targetSpacecraft = controller?.autopilot?.targetObject;

    // Update docking information
    useEffect(() => {
        if (!spacecraft) return;

        const updateInterval = setInterval(() => {
            const dockingController = spacecraft.dockingController;
            
            // Get target either from docking controller or autopilot
            const target = dockingController?.isDocking() 
                ? dockingController.targetSpacecraft 
                : controller?.autopilot?.targetObject;
            
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
            const ourPos = new THREE.Vector3().copy(spacecraft.objects.boxBody.position);
            const targetPos = new THREE.Vector3().copy(target.objects.boxBody.position);
            const ourVel = new THREE.Vector3().copy(spacecraft.objects.boxBody.velocity);
            const targetVel = new THREE.Vector3().copy(target.objects.boxBody.velocity);

            // Get positions based on active ports (either from docking controller or selected)
            const ourPortId = dockingController?.isDocking() ? dockingController.ourPortId : selectedPorts.our;
            const targetPortId = dockingController?.isDocking() ? dockingController.targetPortId : selectedPorts.target;
            
            const ourRefPos = spacecraft.getDockingPortWorldPosition(ourPortId);
            const targetRefPos = target.getDockingPortWorldPosition(targetPortId);

            // Calculate range and closing speed
            const range = ourRefPos.distanceTo(targetRefPos);
            const relativeVel = new THREE.Vector3().subVectors(ourVel, targetVel);
            const rangeVector = new THREE.Vector3().subVectors(targetRefPos, ourRefPos).normalize();
            const closingSpeed = relativeVel.dot(rangeVector);

            // Create base info object
            const newInfo = {
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
            const ourPortDir = spacecraft.getDockingPortWorldDirection(ourPortId);
            const targetPortDir = target.getDockingPortWorldDirection(targetPortId);
            
            // Port alignment error (angle between port directions)
            const portAlignmentError = Math.acos(Math.min(1, Math.max(-1, ourPortDir.dot(targetPortDir.negate()))));
            
            // Calculate relative position vector
            const relativePos = new THREE.Vector3().subVectors(targetRefPos, ourRefPos);
            const distance = relativePos.length();
            const desiredDir = relativePos.clone().normalize();

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

            // Calculate relative motion in perpendicular plane
            const relativeMotionPerp = new THREE.Vector3().copy(relativeVel);
            // Remove velocity component along port direction
            relativeMotionPerp.sub(ourPortDir.multiplyScalar(relativeMotionPerp.dot(ourPortDir)));
            newInfo.relativeMotionPerp = relativeMotionPerp;

            setDockingInfo(newInfo);

            // Draw docking visualization
            drawDockingDisplay(
                canvasRef.current, 
                newInfo.range,
                newInfo.closingSpeed,
                newInfo.alignmentError,
                newInfo.portAlignmentError,
                newInfo.rollAlignmentError,
                newInfo.relativeMotionPerp
            );

        }, 1000/60); // 60fps update rate

        return () => clearInterval(updateInterval);
    }, [spacecraft, controller?.autopilot, selectedPorts]); // Add dependencies

    // Draw vertical bar with logarithmic scale and arrows for out of bounds
    const drawVerticalBar = (ctx, x, y, height, value, maxValue, label, unit = '') => {
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
    const drawDockingDisplay = (canvas, range, closingSpeed, alignmentError, portAlignmentError, rollAlignmentError, relativeMotionPerp) => {
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
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

    // Handle starting/stopping docking
    const handleDock = () => {
        if (!spacecraft || !targetSpacecraft) return;
        
        const dockingController = spacecraft.dockingController;
        if (!dockingController) {
            console.warn('No docking controller found on spacecraft');
            return;
        }

        if (dockingController.isDocking()) {
            dockingController.cancelDocking();
        } else {
            console.log('Starting docking with ports:', selectedPorts.our, selectedPorts.target);
            dockingController.startDocking(
                targetSpacecraft,
                selectedPorts.our,
                selectedPorts.target
            );
        }
    };

    // Check port availability
    const isPortAvailable = (craftId, portId) => {
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

    // Separate port selectors state
    const [showOurPortSelect, setShowOurPortSelect] = useState(false);
    const [showTargetPortSelect, setShowTargetPortSelect] = useState(false);

    // Handle port selection
    const handlePortSelect = (type, port) => {
        const newPorts = {
            ...selectedPorts,
            [type]: port
        };
        setSelectedPorts(newPorts);
        saveSettings(newPorts);
        
        // Update autopilot target point if we're changing target port
        if (type === 'target' && controller?.autopilot) {
            controller.autopilot.setTargetObject(targetSpacecraft, port);
        }
        
        // If we're already docking, update the ports
        if (spacecraft?.dockingController?.isDocking()) {
            handleDock(); // This will restart docking with new ports
        }
    };

    return (
        <div className="flex flex-col gap-2 p-2 font-mono text-xs">
            {/* Status information */}
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

            {/* Docking visualization */}
            <canvas 
                ref={canvasRef}
                width={400}
                height={300}
                className="bg-black border border-white/20 rounded"
            />

            {/* Port selection */}
            <div className="grid grid-cols-2 gap-2 mt-1">
                {/* Our port selection */}
                <div className="flex flex-col gap-1">
                    <div className="text-white/50">Our Port:</div>
                    <div className="relative">
                        <button
                            className="w-full px-2 py-1 bg-black/60 border border-white/20 rounded flex items-center justify-between hover:bg-white/10 transition-colors"
                            onClick={() => setShowOurPortSelect(prev => !prev)}
                        >
                            <span className={isPortAvailable('our', selectedPorts.our) ? 'text-cyan-400' : 'text-red-400'}>
                                {selectedPorts.our}
                            </span>
                            <ChevronDown size={14} />
                        </button>
                        {showOurPortSelect && (
                            <div className="absolute top-full left-0 w-full mt-1 bg-black/90 border border-white/20 rounded overflow-hidden z-10">
                                {['front', 'back'].map(port => (
                                    <button
                                        key={port}
                                        className={`w-full px-2 py-1 text-left hover:bg-white/10 transition-colors ${
                                            isPortAvailable('our', port) ? 'text-cyan-400' : 'text-red-400'
                                        }`}
                                        onClick={() => {
                                            handlePortSelect('our', port);
                                            setShowOurPortSelect(false);
                                        }}
                                    >
                                        {port}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Target port selection */}
                <div className="flex flex-col gap-1">
                    <div className="text-white/50">Target Port:</div>
                    <div className="relative">
                        <button
                            className={`w-full px-2 py-1 bg-black/60 border border-white/20 rounded flex items-center justify-between transition-colors ${
                                targetSpacecraft ? 'hover:bg-white/10' : 'opacity-50 cursor-not-allowed'
                            }`}
                            onClick={() => targetSpacecraft && setShowTargetPortSelect(prev => !prev)}
                            disabled={!targetSpacecraft}
                        >
                            <span className={
                                !targetSpacecraft ? 'text-white/50' :
                                isPortAvailable('target', selectedPorts.target) ? 'text-cyan-400' : 'text-red-400'
                            }>
                                {selectedPorts.target}
                            </span>
                            <ChevronDown size={14} />
                        </button>
                        {showTargetPortSelect && targetSpacecraft && (
                            <div className="absolute top-full left-0 w-full mt-1 bg-black/90 border border-white/20 rounded overflow-hidden z-10">
                                {['front', 'back'].map(port => (
                                    <button
                                        key={port}
                                        className={`w-full px-2 py-1 text-left hover:bg-white/10 transition-colors ${
                                            isPortAvailable('target', port) ? 'text-cyan-400' : 'text-red-400'
                                        }`}
                                        onClick={() => {
                                            handlePortSelect('target', port);
                                            setShowTargetPortSelect(false);
                                        }}
                                    >
                                        {port}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Controls */}
            <div className="flex gap-2 mt-2">
                <button
                    className={`px-2 py-1 rounded text-xs ${
                        spacecraft?.dockingController?.isDocking()
                            ? 'bg-red-500/30 hover:bg-red-500/50 border-red-500/50'
                            : 'bg-cyan-500/30 hover:bg-cyan-500/50 border-cyan-500/50'
                    } border transition-colors duration-200 ${
                        (!spacecraft?.dockingController?.isDocking() && 
                         (!targetSpacecraft || !isPortAvailable('our', selectedPorts.our) || !isPortAvailable('target', selectedPorts.target)))
                        ? 'opacity-50 cursor-not-allowed'
                        : ''
                    }`}
                    onClick={handleDock}
                    disabled={!spacecraft?.dockingController?.isDocking() && 
                        (!targetSpacecraft || 
                         !isPortAvailable('our', selectedPorts.our) || 
                         !isPortAvailable('target', selectedPorts.target))}
                >
                    {spacecraft?.dockingController?.isDocking() ? 'Cancel Docking' : 'Start Docking'}
                </button>

                {targetSpacecraft && (
                    <div className="text-cyan-400">
                        Target: {targetSpacecraft.name}
                    </div>
                )}
            </div>
        </div>
    );
} 