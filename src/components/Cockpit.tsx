import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import { Command } from 'lucide-react';
import { TopBar } from './TopBar';
import { DraggableWindow, WindowPosition } from './DraggableWindow';
import { KeyboardShortcuts } from './KeyboardShortcuts';
import { LoadingOverlay } from './LoadingOverlay';

// Import window components
import { TelemetryWindow } from './windows/TelemetryWindow';
import { ArtificialHorizonWindow } from './windows/ArtificialHorizonWindow';
import { DimensionsWindow } from './windows/DimensionsWindow';
import { RCSControlsWindow } from './windows/RCSControlsWindow';
import { HelperArrowsWindow } from './windows/HelperArrowsWindow';
import { PIDControllerWindow } from './windows/PIDControllerWindow';
import { AutopilotWindow } from './windows/AutopilotWindow';
import { SpacecraftListWindow } from './windows/SpacecraftListWindow';
import { DockingWindow } from './windows/DockingWindow';
import { Spacecraft } from '../core/spacecraft';
import { SpacecraftController } from '../controllers/spacecraftController';

type WindowKey = 'telemetry' | 'horizon' | 'dimensions' | 'rcs' | 'arrows' | 'pid' | 'autopilot' | 'spacecraftList' | 'docking';

interface WindowStates extends Record<string, boolean> {
    telemetry: boolean;
    horizon: boolean;
    dimensions: boolean;
    rcs: boolean;
    arrows: boolean;
    pid: boolean;
    autopilot: boolean;
    spacecraftList: boolean;
    docking: boolean;
}

interface WindowPositions {
    [key: string]: WindowPosition;
}

interface CockpitProps {
    spacecraft: Spacecraft;
    spacecraftController: SpacecraftController;
    loadingProgress?: number;
    loadingStatus?: string;
    onCreateNewSpacecraft?: () => void;
    spacecraftListVersion?: number;
}

interface TelemetryValues {
    position: THREE.Vector3;
    velocity: THREE.Vector3;
    orientation: THREE.Quaternion;
    angularVelocity: THREE.Vector3;
    mass: number;
    thrusterStatus: boolean[];
}

interface AutopilotState {
    pointToPosition: boolean;
    goToPosition: boolean;
}

const calculateInitialPositions = (): WindowPositions => {
    const padding = 10;
    const topBarHeight = 10;
    const titleBarHeight = 32;
    const windowWidth = 250;
    const horizonHeight = 240;

    let currentLeftY = topBarHeight + padding;
    const leftX = padding;

    const rightX = window.innerWidth - windowWidth - padding;
    let currentRightY = topBarHeight + padding;

    return {
        telemetry: { x: leftX, y: currentLeftY },
        horizon: { x: leftX, y: currentLeftY },
        dimensions: { x: rightX, y: currentRightY },
        rcs: { x: rightX, y: currentRightY + titleBarHeight },
        pid: { x: rightX, y: currentRightY + titleBarHeight * 2 },
        arrows: { x: rightX, y: currentRightY + titleBarHeight * 3 },
        autopilot: { x: rightX, y: currentRightY + titleBarHeight * 4 + padding * 2 },
        spacecraftList: { x: rightX, y: currentRightY },
        docking: { x: leftX, y: currentLeftY + horizonHeight + padding * 2 }
    };
};

export const Cockpit: React.FC<CockpitProps> = ({
    spacecraft,
    spacecraftController: controller,
    loadingProgress = 100,
    loadingStatus = '',
    onCreateNewSpacecraft,
    spacecraftListVersion = 0
}) => {
    // Get the world instance directly from the spacecraft
    const world = spacecraft?.basicWorld ?? null;

    // State
    const [visibleWindows, setVisibleWindows] = useState<WindowStates>({
        telemetry: false,
        horizon: true,
        dimensions: false,
        rcs: false,
        arrows: false,
        pid: false,
        autopilot: true,
        spacecraftList: true,
        docking: true
    });
    const [windowPositions, setWindowPositions] = useState<WindowPositions>(calculateInitialPositions());
    const [telemetryValues, setTelemetryValues] = useState<TelemetryValues>({
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        orientation: new THREE.Quaternion(),
        angularVelocity: new THREE.Vector3(),
        mass: 0,
        thrusterStatus: []
    });
    const [showKeyboardShortcuts, setShowKeyboardShortcuts] = useState(false);

    // Refs
    const horizonRef = useRef<HTMLCanvasElement>(null);
    const targetMarkerRef = useRef<THREE.LineSegments | null>(null);
    const horizonSceneRef = useRef<THREE.Scene | null>(null);
    const horizonCameraRef = useRef<THREE.PerspectiveCamera | null>(null);
    const horizonRendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const sphereMeshRef = useRef<THREE.Mesh | null>(null);

    // Window resize handler
    useEffect(() => {
        const handleResize = () => {
            setWindowPositions(calculateInitialPositions());
        };

        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const updateTelemetry = useCallback(() => {
        if (spacecraft?.objects?.box) {
            // Get velocity from the physics body
            const velocity = spacecraft.objects.boxBody?.velocity ?? { x: 0, y: 0, z: 0 };
            const angularVelocity = spacecraft.objects.boxBody?.angularVelocity ?? { x: 0, y: 0, z: 0 };
            const quaternion = spacecraft.objects.box?.quaternion ?? { x: 0, y: 0, z: 0, w: 1 };

            // Update telemetry values for display
            setTelemetryValues({
                position: spacecraft.objects.box.position,
                velocity: new THREE.Vector3(
                    Number(velocity.x?.toFixed(2)) ?? 0,
                    Number(velocity.y?.toFixed(2)) ?? 0,
                    Number(velocity.z?.toFixed(2)) ?? 0
                ),
                orientation: new THREE.Quaternion(
                    quaternion.x ?? 0,
                    quaternion.y ?? 0,
                    quaternion.z ?? 0,
                    quaternion.w ?? 1
                ),
                angularVelocity: new THREE.Vector3(
                    Number(angularVelocity.x?.toFixed(2)) ?? 0,
                    Number(angularVelocity.y?.toFixed(2)) ?? 0,
                    Number(angularVelocity.z?.toFixed(2)) ?? 0
                ),
                mass: spacecraft.objects.boxBody?.mass ?? 0,
                thrusterStatus: spacecraft.getThrusterStatus() ?? []
            });

            // Update horizon directly for smoother motion
            if (sphereMeshRef.current && horizonRendererRef.current && horizonSceneRef.current && horizonCameraRef.current) {
                const renderer = horizonRendererRef.current;
                const scene = horizonSceneRef.current;
                const camera = horizonCameraRef.current;

                // Create a rotation matrix from the raw quaternion
                const rotationMatrix = new THREE.Matrix4().makeRotationFromQuaternion(
                    new THREE.Quaternion(quaternion.x, quaternion.y, quaternion.z, quaternion.w)
                );

                // Apply the inverse rotation to show the horizon from spacecraft's perspective
                rotationMatrix.invert();
                sphereMeshRef.current.setRotationFromMatrix(rotationMatrix);

                // Update target marker if point-to-position is active
                const autopilot = controller?.getAutopilot();
                const autopilotState = autopilot?.getActiveAutopilots() as AutopilotState | undefined;
                const targetPosition = autopilot?.getTargetPosition();
                const currentPosition = spacecraft?.objects?.boxBody?.position;

                if ((autopilotState?.pointToPosition || autopilotState?.goToPosition) && targetPosition && currentPosition && targetMarkerRef.current) {
                    // Convert CANNON.Vec3 to THREE.Vector3
                    const targetVec = new THREE.Vector3(targetPosition.x, targetPosition.y, targetPosition.z);
                    const currentVec = new THREE.Vector3(currentPosition.x, currentPosition.y, currentPosition.z);

                    // Calculate direction to target in world space
                    const direction = new THREE.Vector3()
                        .subVectors(targetVec, currentVec)
                        .normalize();

                    // Transform direction to camera space using the same inverse rotation as the sphere
                    const cameraSpaceDir = direction.clone().applyMatrix4(rotationMatrix);

                    // Project the direction onto the view plane
                    const distance = 0.45;
                    const projectedX = -(cameraSpaceDir.x / Math.abs(cameraSpaceDir.z)) * distance;
                    const projectedY = -(cameraSpaceDir.y / Math.abs(cameraSpaceDir.z)) * distance;

                    // Check if target is in front or behind
                    if (cameraSpaceDir.z > 0) {
                        targetMarkerRef.current.visible = true;
                        targetMarkerRef.current.position.set(projectedX, projectedY, 0.4);

                        // Scale marker based on distance from center
                        const distanceFromCenter = Math.sqrt(projectedX * projectedX + projectedY * projectedY);
                        const scale = Math.min(1.5, 1 / (distanceFromCenter + 0.5));
                        targetMarkerRef.current.scale.setScalar(scale);

                        // Rotate marker to point towards center
                        const angle = Math.atan2(projectedY, projectedX);
                        targetMarkerRef.current.rotation.z = angle + Math.PI / 4;
                    } else {
                        targetMarkerRef.current.visible = false;
                    }
                } else if (targetMarkerRef.current) {
                    targetMarkerRef.current.visible = false;
                }

                // Render the horizon
                renderer.render(scene, camera);
            }
        }
    }, [spacecraft, controller]);

    // Remove the separate horizon update effect since we're now updating it in the animation frame
    useEffect(() => {
        let animationFrameId: number;

        const animate = () => {
            updateTelemetry();
            animationFrameId = requestAnimationFrame(animate);
        };

        animate();

        return () => {
            cancelAnimationFrame(animationFrameId);
            if (horizonRendererRef.current) {
                horizonRendererRef.current.dispose();
            }
        };
    }, [spacecraft, controller, updateTelemetry]);

    // Initialize horizon canvas size
    useEffect(() => {
        if (horizonRef.current) {
            horizonRef.current.width = 200;
            horizonRef.current.height = 200;
        }
    }, []);

    // Initialize horizon
    useEffect(() => {
        const initializeHorizon = async () => {
            try {
                if (!horizonRef.current) return;

                // Setup scene
                const scene = new THREE.Scene();
                horizonSceneRef.current = scene;

                // Setup camera
                const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
                camera.position.z = 1.2;
                horizonCameraRef.current = camera;

                // Initialize renderer
                const renderer = new THREE.WebGLRenderer({
                    canvas: horizonRef.current,
                    alpha: true,
                    antialias: true
                });
                renderer.setSize(200, 200);
                renderer.setClearColor(0x000000, 0.2);
                horizonRendererRef.current = renderer;

                // Create sphere with texture
                const textureLoader = new THREE.TextureLoader();
                const texture = await new Promise<THREE.Texture>((resolve, reject) => {
                    textureLoader.load(
                        '/images/textures/rLHbWVB.png',
                        resolve,
                        undefined,
                        reject
                    );
                });

                texture.mapping = THREE.EquirectangularReflectionMapping;
                texture.minFilter = THREE.LinearMipmapLinearFilter;
                texture.magFilter = THREE.LinearFilter;

                // Add anisotropic filtering
                const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
                texture.anisotropy = maxAnisotropy;

                // Flip the texture horizontally to match original orientation
                texture.repeat.x = -1;
                texture.offset.x = 1;

                const sphereGeometry = new THREE.SphereGeometry(1, 64, 64);
                const sphereMaterial = new THREE.MeshBasicMaterial({
                    map: texture,
                    side: THREE.BackSide,
                    transparent: true,
                    opacity: 1
                });

                // Create and add sphere
                const sphereMesh = new THREE.Mesh(sphereGeometry, sphereMaterial);
                sphereMesh.rotation.y = Math.PI;
                sphereMeshRef.current = sphereMesh;
                scene.add(sphereMesh);

                // Create target crosshair
                const crosshairGroup = new THREE.Group();

                // Main crosshair lines
                const mainLineSize = 0.15;
                const mainLineWidth = 3;
                const mainVertices = new Float32Array([
                    -mainLineSize, 0, 0, mainLineSize, 0, 0,  // Horizontal line
                    0, -mainLineSize, 0, 0, mainLineSize, 0   // Vertical line
                ]);
                const mainGeometry = new THREE.BufferGeometry();
                mainGeometry.setAttribute('position', new THREE.BufferAttribute(mainVertices, 3));
                const mainMaterial = new THREE.LineBasicMaterial({
                    color: 0xffffff,
                    opacity: 0.9,
                    transparent: true,
                    linewidth: mainLineWidth
                });
                const mainCrosshair = new THREE.LineSegments(mainGeometry, mainMaterial);
                crosshairGroup.add(mainCrosshair);

                // Small dot in the center
                const dotGeometry = new THREE.CircleGeometry(0.005, 32);
                const dotMaterial = new THREE.MeshBasicMaterial({
                    color: 0xffffff,
                    opacity: 0.9,
                    transparent: true
                });
                const dot = new THREE.Mesh(dotGeometry, dotMaterial);
                crosshairGroup.add(dot);

                // Small tick marks
                const tickSize = 0.05;
                const tickVertices = new Float32Array([
                    // Left tick
                    -mainLineSize - tickSize, 0, 0, -mainLineSize, 0, 0,
                    // Right tick
                    mainLineSize, 0, 0, mainLineSize + tickSize, 0, 0,
                    // Top tick
                    0, mainLineSize, 0, 0, mainLineSize + tickSize, 0,
                    // Bottom tick
                    0, -mainLineSize - tickSize, 0, 0, -mainLineSize, 0
                ]);
                const tickGeometry = new THREE.BufferGeometry();
                tickGeometry.setAttribute('position', new THREE.BufferAttribute(tickVertices, 3));
                const tickMaterial = new THREE.LineBasicMaterial({
                    color: 0xffffff,
                    opacity: 0.7,
                    transparent: true,
                    linewidth: 2
                });
                const ticks = new THREE.LineSegments(tickGeometry, tickMaterial);
                crosshairGroup.add(ticks);

                // Create target marker (initially hidden)
                const targetMarkerSize = 0.08;
                const targetMarkerGeometry = new THREE.BufferGeometry();
                const targetMarkerVertices = new Float32Array([
                    // Diamond shape
                    0, targetMarkerSize, 0, targetMarkerSize, 0, 0,
                    targetMarkerSize, 0, 0, 0, -targetMarkerSize, 0,
                    0, -targetMarkerSize, 0, -targetMarkerSize, 0, 0,
                    -targetMarkerSize, 0, 0, 0, targetMarkerSize, 0
                ]);
                targetMarkerGeometry.setAttribute('position', new THREE.BufferAttribute(targetMarkerVertices, 3));
                const targetMarkerMaterial = new THREE.LineBasicMaterial({
                    color: 0xff0000,
                    opacity: 1.0,
                    transparent: true,
                    linewidth: 3,
                    depthTest: false
                });
                const targetMarker = new THREE.LineSegments(targetMarkerGeometry, targetMarkerMaterial);
                targetMarker.position.z = 0.4;
                targetMarker.visible = false;
                targetMarkerRef.current = targetMarker;
                scene.add(targetMarker);

                // Position the entire crosshair group
                crosshairGroup.position.z = 0.5;
                scene.add(crosshairGroup);
            } catch (error) {
                console.error('Error initializing horizon:', error);
            }
        };

        initializeHorizon();
    }, []);

    const toggleWindow = (windowName: string) => {
        setVisibleWindows(prev => ({
            ...prev,
            [windowName]: !prev[windowName as WindowKey]
        }));
    };

    const updateWindowPosition = (key: string, position: WindowPosition) => {
        setWindowPositions(prev => ({
            ...prev,
            [key]: position
        }));
    };

    const handleSelectSpacecraft = (selectedSpacecraft: Spacecraft) => {
        if (selectedSpacecraft && selectedSpacecraft !== spacecraft && world) {
            world.setActiveSpacecraft(selectedSpacecraft);
        }
    };

    const handleDeleteSpacecraft = (spacecraftToDelete: Spacecraft) => {
        if (spacecraftToDelete === spacecraft) return; // Don't delete active spacecraft
        if (world) {
            world.deleteSpacecraft(spacecraftToDelete);
        }
    };

    return (
        <div className="relative w-full h-full">
            {loadingProgress < 100 && (
                <LoadingOverlay progress={loadingProgress} status={loadingStatus} />
            )}
            <div className="fixed inset-0 text-xs pt-8 font-['Menlo','Monaco','Courier_New',monospace] pointer-events-none">
                <div className="pointer-events-auto">
                    <TopBar
                        visibleWindows={visibleWindows}
                        onToggleWindow={toggleWindow}
                        onCreateNewSpacecraft={onCreateNewSpacecraft ?? (() => { })}
                    />
                </div>

                <div className="pointer-events-none">
                    {visibleWindows.spacecraftList && (
                        <DraggableWindow
                            title="Spacecraft List"
                            defaultPosition={windowPositions.spacecraftList}
                            onPositionChange={(pos: WindowPosition) => updateWindowPosition('spacecraftList', pos)}
                            initiallyCollapsed={false}
                            isVisible={visibleWindows.spacecraftList}
                        >
                            <SpacecraftListWindow
                                world={world}
                                activeSpacecraft={spacecraft}
                                onCreateSpacecraft={onCreateNewSpacecraft ?? (() => { })}
                                onSelectSpacecraft={handleSelectSpacecraft}
                                onDeleteSpacecraft={handleDeleteSpacecraft}
                                version={spacecraftListVersion}
                            />
                        </DraggableWindow>
                    )}

                    {visibleWindows.telemetry && (
                        <DraggableWindow
                            title="Telemetry"
                            defaultPosition={windowPositions.telemetry}
                            onPositionChange={(pos: WindowPosition) => updateWindowPosition('telemetry', pos)}
                            initiallyCollapsed={false}
                            isVisible={visibleWindows.telemetry}
                        >
                            <TelemetryWindow telemetry={telemetryValues} />
                        </DraggableWindow>
                    )}

                    {visibleWindows.horizon && (
                        <DraggableWindow
                            title="Artificial Horizon"
                            defaultPosition={windowPositions.horizon}
                            onPositionChange={(pos: WindowPosition) => updateWindowPosition('horizon', pos)}
                            initiallyCollapsed={false}
                            isVisible={visibleWindows.horizon}
                        >
                            <ArtificialHorizonWindow horizonRef={horizonRef} />
                        </DraggableWindow>
                    )}

                    {visibleWindows.dimensions && (
                        <DraggableWindow
                            title="Spacecraft Dimensions"
                            defaultPosition={windowPositions.dimensions}
                            onPositionChange={(pos: WindowPosition) => updateWindowPosition('dimensions', pos)}
                            isVisible={visibleWindows.dimensions}
                        >
                            <DimensionsWindow spacecraft={spacecraft} />
                        </DraggableWindow>
                    )}

                    {visibleWindows.rcs && (
                        <DraggableWindow
                            title="RCS Controls"
                            defaultPosition={windowPositions.rcs}
                            onPositionChange={(pos: WindowPosition) => updateWindowPosition('rcs', pos)}
                            isVisible={visibleWindows.rcs}
                        >
                            <RCSControlsWindow spacecraft={spacecraft} />
                        </DraggableWindow>
                    )}

                    {visibleWindows.arrows && (
                        <DraggableWindow
                            title="Helper Arrows"
                            defaultPosition={windowPositions.arrows}
                            onPositionChange={(pos: WindowPosition) => updateWindowPosition('arrows', pos)}
                            isVisible={visibleWindows.arrows}
                        >
                            <HelperArrowsWindow spacecraft={spacecraft} />
                        </DraggableWindow>
                    )}

                    {visibleWindows.pid && (
                        <DraggableWindow
                            title="PID Controller"
                            defaultPosition={windowPositions.pid}
                            onPositionChange={(pos: WindowPosition) => updateWindowPosition('pid', pos)}
                            isVisible={visibleWindows.pid}
                        >
                            <PIDControllerWindow 
                                controller={controller?.getAutopilot()?.getOrientationPidController() ?? null}
                                linearController={controller?.getAutopilot()?.getLinearPidController() ?? null}
                                momentumController={controller?.getAutopilot()?.getMomentumPidController() ?? null}
                            />
                        </DraggableWindow>
                    )}

                    {visibleWindows.autopilot && (
                        <DraggableWindow
                            title="Autopilot"
                            defaultPosition={windowPositions.autopilot}
                            onPositionChange={(pos: WindowPosition) => updateWindowPosition('autopilot', pos)}
                            initiallyCollapsed={false}
                            isVisible={visibleWindows.autopilot}
                        >
                            <AutopilotWindow
                                spacecraft={spacecraft}
                                controller={controller}
                                world={world}
                                version={spacecraftListVersion}
                            />
                        </DraggableWindow>
                    )}

                    {visibleWindows.docking && (
                        <DraggableWindow
                            title="Docking"
                            defaultPosition={windowPositions.docking}
                            onPositionChange={(pos) => updateWindowPosition('docking', pos)}
                            onClose={() => toggleWindow('docking')}
                        >
                            <DockingWindow
                                spacecraft={spacecraft}
                                controller={controller}
                            />
                        </DraggableWindow>
                    )}
                </div>

                <button
                    className="fixed bottom-2 right-2 w-6 h-6 bg-black/60 rounded flex items-center justify-center text-white/90 cursor-pointer text-xs hover:bg-white/20 transition-colors duration-200 border border-white/20 pointer-events-auto drop-shadow-md"
                    onClick={() => setShowKeyboardShortcuts(true)}
                >
                    <Command size={14} />
                </button>
            </div>

            <KeyboardShortcuts
                isVisible={showKeyboardShortcuts}
                onClose={() => setShowKeyboardShortcuts(false)}
            />
        </div>
    );
}; 