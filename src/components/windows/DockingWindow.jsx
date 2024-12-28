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

    // Debug logging
    console.log('DockingWindow: Rendering with version:', version);
    console.log('DockingWindow: World instance:', worldInstance ? 'exists' : 'undefined');
    console.log('DockingWindow: Current target:', worldInstance?.currentTarget ? 'exists' : 'undefined');
    console.log('DockingWindow: Controller target:', controller?.autopilot?.targetObject?.name);
    console.log('DockingWindow: Controller target point:', controller?.autopilot?.targetPoint);

    // Load settings when active spacecraft changes or when autopilot target changes
    useEffect(() => {
        console.log('DockingWindow: Settings effect triggered');
        console.log('DockingWindow: Spacecraft name:', spacecraft?.name);
        console.log('DockingWindow: Autopilot target point:', controller?.autopilot?.targetPoint);
        
        if (spacecraft?.name && controller?.autopilot) {
            // Get the target port from autopilot if it's targeting a docking port
            const targetPoint = controller.autopilot.targetPoint;
            const isTargetingDockingPort = targetPoint === 'front' || targetPoint === 'back';
            
            console.log('DockingWindow: Target point:', targetPoint);
            console.log('DockingWindow: Is targeting docking port:', isTargetingDockingPort);
            
            const savedSettings = portSettings[spacecraft.name] || {
                our: 'front',
                target: isTargetingDockingPort ? targetPoint : 'back'
            };
            
            setSelectedPorts(prev => ({
                ...prev,
                target: isTargetingDockingPort ? targetPoint : prev.target
            }));
            
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
        
        setPortSettings(prev => ({
            ...prev,
            [spacecraft.name]: newPorts
        }));
    };

    // Update docking information
    useEffect(() => {
        if (!spacecraft || !worldInstance) return;

        const updateInterval = setInterval(() => {
            const controller = spacecraft.dockingController;
            // Update currentTarget from autopilot if available
            const currentTarget = controller?.autopilot?.targetObject;
            const target = currentTarget ? 
                worldInstance.spacecraft.find(s => 
                    s.objects.box.uuid === currentTarget.objects.box.uuid && 
                    s !== spacecraft
                ) : 
                null;
            
            console.log('DockingWindow: Update interval - Current target:', currentTarget?.name);
            console.log('DockingWindow: Update interval - Found target:', target?.name);
            
            if (!target) {
                setDockingInfo({
                    phase: 'idle',
                    range: 0,
                    closingSpeed: 0,
                    alignmentError: 0,
                    portAlignmentError: 0
                });
                return;
            }

            // Calculate relative position and velocity
            const ourPos = spacecraft.objects.boxBody.position;
            const targetPos = target.objects.boxBody.position;
            const ourVel = spacecraft.objects.boxBody.velocity;
            const targetVel = target.objects.boxBody.velocity;

            // Get positions based on docking state
            let ourRefPos, targetRefPos;
            if (controller.isDocking()) {
                ourRefPos = spacecraft.getDockingPortWorldPosition(controller.ourPortId);
                targetRefPos = target.getDockingPortWorldPosition(controller.targetPortId);
            } else {
                ourRefPos = new THREE.Vector3().copy(ourPos);
                targetRefPos = new THREE.Vector3().copy(targetPos);
            }

            // Calculate range and closing speed
            const range = ourRefPos.distanceTo(targetRefPos);
            const relativeVel = new THREE.Vector3().subVectors(ourVel, targetVel);
            const rangeVector = new THREE.Vector3().subVectors(targetRefPos, ourRefPos).normalize();
            const closingSpeed = relativeVel.dot(rangeVector);

            // Calculate alignment errors if in docking mode
            let alignmentError = 0;
            let portAlignmentError = 0;
            
            if (controller.isDocking()) {
                const ourPortDir = spacecraft.getDockingPortWorldDirection(controller.ourPortId);
                const targetPortDir = target.getDockingPortWorldDirection(controller.targetPortId);
                
                // Port alignment error (angle between port directions)
                portAlignmentError = Math.acos(ourPortDir.dot(targetPortDir.negate()));
                
                // General alignment error (how well we're pointed at the target)
                const desiredDir = new THREE.Vector3().subVectors(targetRefPos, ourRefPos).normalize();
                alignmentError = Math.acos(ourPortDir.dot(desiredDir));
            }

            setDockingInfo({
                phase: controller.getDockingPhase(),
                range: range,
                closingSpeed: closingSpeed,
                alignmentError: THREE.MathUtils.radToDeg(alignmentError),
                portAlignmentError: THREE.MathUtils.radToDeg(portAlignmentError)
            });

            // Draw docking visualization
            drawDockingDisplay(
                canvasRef.current, 
                range,
                closingSpeed,
                alignmentError,
                portAlignmentError
            );

        }, 1000/30); // 30fps update rate

        return () => clearInterval(updateInterval);
    }, [spacecraft, worldInstance]);

    // Draw docking visualization
    const drawDockingDisplay = (canvas, range, closingSpeed, alignmentError, portAlignmentError) => {
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;
        
        // Clear canvas
        ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
        ctx.fillRect(0, 0, width, height);
        
        // Draw grid
        ctx.strokeStyle = '#1a1a1a';
        ctx.lineWidth = 1;
        const gridSize = 20;
        for (let x = 0; x <= width; x += gridSize) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();
        }
        for (let y = 0; y <= height; y += gridSize) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
        }

        // Center of the display
        const centerX = width / 2;
        const centerY = height / 2;

        // Draw target marker (center circle)
        ctx.strokeStyle = '#00ff00';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(centerX, centerY, 5, 0, Math.PI * 2);
        ctx.stroke();

        // Draw approach vector
        const vectorLength = Math.min(range * 10, width/4);
        const vectorAngle = alignmentError * Math.PI / 180;
        
        ctx.strokeStyle = '#00ff00';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.lineTo(
            centerX + Math.cos(vectorAngle) * vectorLength,
            centerY + Math.sin(vectorAngle) * vectorLength
        );
        ctx.stroke();

        // Draw velocity vector
        const velScale = 50;
        const velLength = Math.abs(closingSpeed) * velScale;
        ctx.strokeStyle = closingSpeed < 0 ? '#00ff00' : '#ff0000';
        ctx.beginPath();
        ctx.moveTo(width - 40, height/2);
        ctx.lineTo(width - 40, height/2 - velLength);
        ctx.stroke();

        // Draw alignment indicator
        const alignScale = 2;
        const alignOffset = portAlignmentError * alignScale;
        ctx.strokeStyle = alignOffset < 10 ? '#00ff00' : '#ff0000';
        ctx.beginPath();
        ctx.moveTo(20, height/2);
        ctx.lineTo(20, height/2 - alignOffset);
        ctx.stroke();
    };

    // Handle starting/stopping docking
    const handleDock = () => {
        const controller = spacecraft.dockingController;
        if (controller.isDocking()) {
            controller.cancelDocking();
        } else if (worldInstance?.currentTarget) {
            const targetSpacecraft = worldInstance.spacecraft.find(
                s => s.objects.box.uuid === worldInstance.currentTarget.uuid && 
                    s !== spacecraft
            );
            if (targetSpacecraft) {
                controller.startDocking(
                    targetSpacecraft,
                    selectedPorts.our,
                    selectedPorts.target
                );
            }
        }
    };

    // Get target spacecraft from autopilot if available
    const targetSpacecraft = controller?.autopilot?.targetObject;

    // Check port availability
    const isPortAvailable = (craftId, portId) => {
        if (!spacecraft || !targetSpacecraft || spacecraft === targetSpacecraft) return false;
        
        const craft = craftId === 'our' ? spacecraft : targetSpacecraft;
        if (!craft.dockingPorts || !craft.dockingPorts[portId]) return false;
        
        return !craft.dockingPorts[portId].isOccupied;
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
            {/* Target selection status */}
            {!targetSpacecraft && (
                <div className="text-white/50 italic text-center bg-black/40 p-2 rounded border border-white/10">
                    Select target in Autopilot MFD
                </div>
            )}

            {/* Docking visualization */}
            <canvas 
                ref={canvasRef}
                width={300}
                height={200}
                className="bg-black/80 border border-white/20 rounded"
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
                        (!worldInstance?.currentTarget || !isPortAvailable('our', selectedPorts.our) || !isPortAvailable('target', selectedPorts.target))
                        ? 'opacity-50 cursor-not-allowed'
                        : ''
                    }`}
                    onClick={handleDock}
                    disabled={!worldInstance?.currentTarget || 
                        !isPortAvailable('our', selectedPorts.our) || 
                        !isPortAvailable('target', selectedPorts.target)}
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