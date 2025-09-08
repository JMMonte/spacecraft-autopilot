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
import { DockingCamerasWindow } from './windows/DockingCamerasWindow';
import { DockingCameraView, PortId as DockingPortId } from './windows/DockingCameraView';
import { Spacecraft } from '../core/spacecraft';
import { RangeInput } from './ui/RangeInput';
import { NumberInput } from './ui/NumberInput';
import { useElementSize } from '../hooks/useElementSize';
import { SpacecraftController } from '../controllers/spacecraftController';

type WindowKey = 'telemetry' | 'horizon' | 'dimensions' | 'rcs' | 'arrows' | 'pid' | 'autopilot' | 'spacecraftList' | 'docking' | 'dockingCameras';

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
    dockingCameras: boolean;
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

type CameraKey = string; // `${spacecraftUuid}:${DockingPortId}`
interface CameraWindowState {
    key: CameraKey;
    spacecraftUuid: string;
    portId: DockingPortId;
    open: boolean;
    position: WindowPosition;
    size: { width?: number; height?: number };
}

const calculateInitialPositions = (viewportWidth: number): WindowPositions => {
    const padding = 10;
    const topBarHeight = 10;
    const titleBarHeight = 32;
    const windowWidth = 250;
    const horizonHeight = 240;

    let currentLeftY = topBarHeight + padding;
    const leftX = padding;

    const rightX = viewportWidth - windowWidth - padding;
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
        docking: { x: leftX, y: currentLeftY + horizonHeight + padding * 2 },
        dockingCameras: { x: leftX + 270, y: currentLeftY + horizonHeight + padding * 2 }
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
        docking: true,
        dockingCameras: false
    });
    const [windowPositions, setWindowPositions] = useState<WindowPositions>(calculateInitialPositions(typeof window !== 'undefined' ? window.innerWidth : 1024));
    const [telemetryValues, setTelemetryValues] = useState<TelemetryValues>({
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        orientation: new THREE.Quaternion(),
        angularVelocity: new THREE.Vector3(),
        mass: 0,
        thrusterStatus: []
    });
    const [showKeyboardShortcuts, setShowKeyboardShortcuts] = useState(false);

    // Z-order management for draggable windows
    const initialZ = 100;
    const [zCounter, setZCounter] = useState<number>(initialZ + 10);
    const [windowZ, setWindowZ] = useState<Record<WindowKey, number>>({
        spacecraftList: initialZ + 1,
        telemetry:      initialZ + 2,
        horizon:        initialZ + 3,
        dimensions:     initialZ + 4,
        rcs:            initialZ + 5,
        arrows:         initialZ + 6,
        pid:            initialZ + 7,
        autopilot:      initialZ + 8,
        docking:        initialZ + 9,
        dockingCameras: initialZ + 10,
    });

    const bringWindowToFront = (key: WindowKey) => {
        setWindowZ(prev => ({ ...prev, [key]: zCounter + 1 }));
        setZCounter(prev => prev + 1);
    };

    // Per-camera draggable windows + z-order
    const [cameraWindows, setCameraWindows] = useState<Record<CameraKey, CameraWindowState>>({});
    const [cameraWindowZ, setCameraWindowZ] = useState<Record<CameraKey, number>>({});
    const [activeCameraKey, setActiveCameraKey] = useState<CameraKey | null>(null);
    const [fovValue, setFovValue] = useState<number | null>(null);
    const bringCameraWindowToFront = (key: CameraKey) => {
        setCameraWindowZ(prev => ({ ...prev, [key]: zCounter + 1 }));
        setZCounter(prev => prev + 1);
        setActiveCameraKey(key);
    };

    // Refs
    const horizonRef = useRef<HTMLCanvasElement>(null);
    const targetMarkerRef = useRef<THREE.LineSegments | null>(null);
    const horizonSceneRef = useRef<THREE.Scene | null>(null);
    const horizonCameraRef = useRef<THREE.PerspectiveCamera | null>(null);
    const horizonRendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const sphereMeshRef = useRef<THREE.Mesh | null>(null);

    // Reactful resize handling using ResizeObserver on the UI container
    const uiContainerRef = useRef<HTMLDivElement>(null);
    const { width: uiWidth } = useElementSize(uiContainerRef.current);
    const { width: horizonCanvasWidth, height: horizonCanvasHeight } = useElementSize(horizonRef.current);
    useEffect(() => {
        if (uiWidth > 0) setWindowPositions(calculateInitialPositions(uiWidth));
    }, [uiWidth]);

    const toggleCameraWindow = useCallback((spacecraftUuid: string, portId: DockingPortId) => {
        setCameraWindows(prev => {
            const key: CameraKey = `${spacecraftUuid}:${portId}`;
            const existing = prev[key];
            if (existing) {
                const nextOpen = !existing.open;
                if (nextOpen) setActiveCameraKey(key);
                return { ...prev, [key]: { ...existing, open: nextOpen } };
            }
            // New window: position it near the docking cameras window by default
            const basePos = windowPositions.dockingCameras || { x: 20, y: 20 };
            const openCount = Object.values(prev).filter(w => w.open).length;
            const offset = openCount * 30;
            const newWin: CameraWindowState = {
                key,
                spacecraftUuid,
                portId,
                open: true,
                position: { x: basePos.x + 280 + offset, y: basePos.y + offset },
                size: { width: 320, height: 200 },
            };
            setActiveCameraKey(key);
            return { ...prev, [key]: newWin };
        });
        setCameraWindowZ(prev => {
            const key: CameraKey = `${spacecraftUuid}:${portId}`;
            if (prev[key] != null) return prev;
            return { ...prev, [key]: zCounter + 1 };
        });
        setZCounter(prev => prev + 1);
    }, [windowPositions.dockingCameras, zCounter]);

    const setCameraWindowPosition = useCallback((key: CameraKey, pos: WindowPosition) => {
        setCameraWindows(prev => prev[key] ? { ...prev, [key]: { ...prev[key], position: pos } } : prev);
    }, []);

    const setCameraWindowSize = useCallback((key: CameraKey, size: { width?: number; height?: number }) => {
        setCameraWindows(prev => prev[key] ? { ...prev, [key]: { ...prev[key], size: { ...prev[key].size, ...size } } } : prev);
    }, []);

    const updateTelemetry = useCallback(() => {
        if (spacecraft?.objects?.box) {
            // Avoid calling into Rapier from this separate RAF. Read the cached
            // values synchronized by SpacecraftModel.update() after the physics step.
            const v = spacecraft.objects?.boxBody?.velocity ?? new THREE.Vector3();
            const av = spacecraft.objects?.boxBody?.angularVelocity ?? new THREE.Vector3();
            const quaternion = spacecraft.objects.box?.quaternion ?? { x: 0, y: 0, z: 0, w: 1 };

            // Update telemetry values for display
            setTelemetryValues({
                position: spacecraft.objects.box.position,
                velocity: new THREE.Vector3(
                    Number((v.x ?? 0).toFixed?.(2) ?? v.x ?? 0),
                    Number((v.y ?? 0).toFixed?.(2) ?? v.y ?? 0),
                    Number((v.z ?? 0).toFixed?.(2) ?? v.z ?? 0)
                ),
                orientation: new THREE.Quaternion(
                    quaternion.x ?? 0,
                    quaternion.y ?? 0,
                    quaternion.z ?? 0,
                    quaternion.w ?? 1
                ),
                angularVelocity: new THREE.Vector3(
                    Number((av.x ?? 0).toFixed?.(2) ?? av.x ?? 0),
                    Number((av.y ?? 0).toFixed?.(2) ?? av.y ?? 0),
                    Number((av.z ?? 0).toFixed?.(2) ?? av.z ?? 0)
                ),
                mass: spacecraft.getMass() ?? 0,
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
                const wp = spacecraft?.getWorldPosition();

                if ((autopilotState?.pointToPosition || autopilotState?.goToPosition) && targetPosition && wp && targetMarkerRef.current) {
                    const targetVec = new THREE.Vector3(targetPosition.x, targetPosition.y, targetPosition.z);
                    const currentVec = new THREE.Vector3(wp.x, wp.y, wp.z);

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

    // Keep horizon renderer in sync with canvas size
    useEffect(() => {
        const renderer = horizonRendererRef.current;
        const camera = horizonCameraRef.current;
        if (!renderer || !camera) return;

        const w = Math.max(1, Math.floor(horizonCanvasWidth || 0));
        const h = Math.max(1, Math.floor(horizonCanvasHeight || 0));
        if (w > 0 && h > 0) {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            renderer.setPixelRatio(dpr);
            renderer.setSize(w, h, false);
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
        }
    }, [horizonCanvasWidth, horizonCanvasHeight]);

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
                    antialias: true,
                    logarithmicDepthBuffer: true
                });
                // Size to current canvas CSS box
                const cw = Math.max(1, Math.floor(horizonRef.current.clientWidth || 200));
                const ch = Math.max(1, Math.floor(horizonRef.current.clientHeight || 200));
                const dpr = Math.min(window.devicePixelRatio || 1, 2);
                renderer.setPixelRatio(dpr);
                renderer.setSize(cw, ch, false);
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

    // Sync global FOV UI with the active camera's FOV
    useEffect(() => {
        if (!activeCameraKey) { setFovValue(null); return; }
        const [uuid, port] = activeCameraKey.split(':') as [string, DockingPortId];
        const sc = world?.getSpacecraftList?.().find(s => s.uuid === uuid) ?? null;
        const cam = sc?.getDockingPortCamera(port);
        if (cam) setFovValue(cam.fov);
        else setFovValue(null);
    }, [activeCameraKey, world, spacecraftListVersion]);

    const handleFovSlider = (e: React.ChangeEvent<HTMLInputElement>) => {
        const v = Math.min(120, Math.max(20, Number(e.target.value)));
        setFovValue(v);
        if (!activeCameraKey) return;
        const [uuid, port] = activeCameraKey.split(':') as [string, DockingPortId];
        const sc = world?.getSpacecraftList?.().find(s => s.uuid === uuid) ?? null;
        const cam = sc?.getDockingPortCamera(port);
        if (cam) { cam.fov = v; cam.updateProjectionMatrix(); }
    };

    const handleFovInput = (e: React.ChangeEvent<HTMLInputElement>) => {
        const raw = Number(e.target.value);
        if (!Number.isFinite(raw)) return;
        const v = Math.min(120, Math.max(20, raw));
        setFovValue(v);
        if (!activeCameraKey) return;
        const [uuid, port] = activeCameraKey.split(':') as [string, DockingPortId];
        const sc = world?.getSpacecraftList?.().find(s => s.uuid === uuid) ?? null;
        const cam = sc?.getDockingPortCamera(port);
        if (cam) { cam.fov = v; cam.updateProjectionMatrix(); }
    };

    const toggleWindow = (windowName: string) => {
        setVisibleWindows(prev => {
            const key = windowName as WindowKey;
            const next = !prev[key];
            if (next) bringWindowToFront(key);
            return { ...prev, [windowName]: next } as WindowStates;
        });
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
        <div ref={uiContainerRef} className="relative w-full h-full">
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
                            zIndex={windowZ.spacecraftList}
                            onFocus={() => bringWindowToFront('spacecraftList')}
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
                            zIndex={windowZ.telemetry}
                            onFocus={() => bringWindowToFront('telemetry')}
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
                            zIndex={windowZ.horizon}
                            onFocus={() => bringWindowToFront('horizon')}
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
                            zIndex={windowZ.dimensions}
                            onFocus={() => bringWindowToFront('dimensions')}
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
                            zIndex={windowZ.rcs}
                            onFocus={() => bringWindowToFront('rcs')}
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
                            zIndex={windowZ.arrows}
                            onFocus={() => bringWindowToFront('arrows')}
                        >
                            <HelperArrowsWindow spacecraft={spacecraft} world={world} />
                        </DraggableWindow>
                    )}

                    {visibleWindows.pid && (
                        <DraggableWindow
                            title="PID Controller"
                            defaultPosition={windowPositions.pid}
                            onPositionChange={(pos: WindowPosition) => updateWindowPosition('pid', pos)}
                            isVisible={visibleWindows.pid}
                            zIndex={windowZ.pid}
                            onFocus={() => bringWindowToFront('pid')}
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
                            zIndex={windowZ.autopilot}
                            onFocus={() => bringWindowToFront('autopilot')}
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
                            zIndex={windowZ.docking}
                            onFocus={() => bringWindowToFront('docking')}
                        >
                        <DockingWindow
                            spacecraft={spacecraft}
                            controller={controller}
                            world={world}
                            version={spacecraftListVersion}
                        />
                        </DraggableWindow>
                    )}

                    {visibleWindows.dockingCameras && (
                        <DraggableWindow
                            title="Docking Cameras"
                            defaultPosition={windowPositions.dockingCameras}
                            onPositionChange={(pos) => updateWindowPosition('dockingCameras', pos)}
                            onClose={() => toggleWindow('dockingCameras')}
                            zIndex={windowZ.dockingCameras}
                            onFocus={() => bringWindowToFront('dockingCameras')}
                        >
                            <DockingCamerasWindow 
                                world={world} 
                                version={spacecraftListVersion}
                                onToggleCamera={toggleCameraWindow}
                                openCameraKeys={Object.values(cameraWindows).filter(w => w.open).map(w => w.key)}
                            />
                        </DraggableWindow>
                    )}
                    {Object.values(cameraWindows).filter(w => w.open).map(w => {
                        const sc = world?.getSpacecraftList?.().find(s => s.uuid === w.spacecraftUuid) ?? null;
                        const title = `Camera: ${sc?.name ?? 'Unknown'} ${w.portId === 'front' ? 'Front' : 'Back'}`;
                        return (
                            <DraggableWindow
                                key={w.key}
                                title={title}
                                defaultPosition={w.position}
                                onPositionChange={(pos) => setCameraWindowPosition(w.key, pos)}
                                initiallyCollapsed={false}
                                isVisible={true}
                                resizable={true}
                                defaultSize={w.size}
                                onSizeChange={(size) => setCameraWindowSize(w.key, size)}
                                onClose={() => toggleCameraWindow(w.spacecraftUuid, w.portId)}
                                zIndex={cameraWindowZ[w.key]}
                                onFocus={() => bringCameraWindowToFront(w.key)}
                            >
                                <div className="w-full h-full">
                                    <DockingCameraView 
                                        world={world ?? null}
                                        spacecraft={sc}
                                        portId={w.portId}
                                    />
                                </div>
                            </DraggableWindow>
                        );
                    })}
                </div>

                <button
                    className="fixed bottom-2 right-2 w-6 h-6 bg-black/60 rounded flex items-center justify-center text-white/90 cursor-pointer text-xs hover:bg-white/20 transition-colors duration-200 border border-white/20 pointer-events-auto drop-shadow-md"
                    onClick={() => setShowKeyboardShortcuts(true)}
                >
                    <Command size={14} />
                </button>

                {/* Global FOV control fixed at bottom of the window */}
                {Object.values(cameraWindows).some(w => w.open) && (
                    <div
                        className="fixed left-2 right-10 bottom-2 pointer-events-none"
                        style={{ zIndex: zCounter + 100 }}
                    >
                        <div className="flex items-end gap-2 bg-black/60 backdrop-blur px-2 py-2 rounded border border-white/20 pointer-events-auto">
                            <div className="flex-1 min-w-[180px]">
                                <RangeInput
                                    label="FOV"
                                    unit="deg"
                                    value={fovValue}
                                    onChange={handleFovSlider}
                                    min={20}
                                    max={120}
                                    step={1}
                                    className="text-[10px]"
                                />
                            </div>
                            <div className="w-20">
                                <NumberInput
                                    value={Number.isFinite(fovValue as number) ? Number((fovValue ?? 60).toFixed(1)) : 60}
                                    onChange={handleFovInput}
                                    step={1}
                                    className="text-[10px]"
                                />
                            </div>
                        </div>
                    </div>
                )}
            </div>

            <KeyboardShortcuts
                isVisible={showKeyboardShortcuts}
                onClose={() => setShowKeyboardShortcuts(false)}
            />
        </div>
    );
}; 
