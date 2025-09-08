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
import { SettingsWindow } from './windows/SettingsWindow';
import { DockingWindow } from './windows/DockingWindow';
import { DockingCamerasWindow } from './windows/DockingCamerasWindow';
import { DockingCameraView, PortId as DockingPortId } from './windows/DockingCameraView';
import { Spacecraft } from '../core/spacecraft';
import { useSettings } from '../state/store';
// FOV inputs now live inside DockingCameraView
import { useElementSize } from '../hooks/useElementSize';
import { SpacecraftController } from '../controllers/spacecraftController';

type WindowKey = 'telemetry' | 'horizon' | 'dimensions' | 'rcs' | 'arrows' | 'pid' | 'autopilot' | 'spacecraftList' | 'docking' | 'dockingCameras' | 'settings';

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
    settings: boolean;
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
        dockingCameras: { x: leftX + 270, y: currentLeftY + horizonHeight + padding * 2 },
        settings: { x: rightX, y: currentRightY + titleBarHeight * 5 + padding * 2 },
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
        dockingCameras: false,
        settings: false,
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
        settings:       initialZ + 11,
    });

    const bringWindowToFront = (key: WindowKey) => {
        setWindowZ(prev => ({ ...prev, [key]: zCounter + 1 }));
        setZCounter(prev => prev + 1);
    };

    // Per-camera draggable windows + z-order
    const [cameraWindows, setCameraWindows] = useState<Record<CameraKey, CameraWindowState>>({});
    const [cameraWindowZ, setCameraWindowZ] = useState<Record<CameraKey, number>>({});
    const bringCameraWindowToFront = (key: CameraKey) => {
        setCameraWindowZ(prev => ({ ...prev, [key]: zCounter + 1 }));
        setZCounter(prev => prev + 1);
    };

    // Refs
    const horizonRef = useRef<HTMLCanvasElement>(null);
    const targetMarkerRef = useRef<THREE.LineSegments | null>(null);
    const horizonSceneRef = useRef<THREE.Scene | null>(null);
    const horizonCameraRef = useRef<THREE.PerspectiveCamera | THREE.OrthographicCamera | null>(null);
    const horizonRendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const sphereMeshRef = useRef<THREE.Mesh | null>(null);
    const targetArrowRef = useRef<THREE.Mesh | null>(null);

    // Reactful resize handling using ResizeObserver on the UI container
    const uiContainerRef = useRef<HTMLDivElement>(null);
    const { width: uiWidth } = useElementSize(uiContainerRef.current);
    const { width: horizonCanvasWidth, height: horizonCanvasHeight } = useElementSize(horizonRef.current);
    useEffect(() => {
        if (uiWidth > 0) setWindowPositions(calculateInitialPositions(uiWidth));
    }, [uiWidth]);
    const { attitudeSphereTexture, uiTheme } = useSettings();
    const themeAccentHex = uiTheme === 'b' ? '#94a3b8' : uiTheme === 'c' ? '#7dd3fc' : '#22d3ee';
    const crosshairBaseHex = uiTheme === 'b' ? '#ffffff' : '#ffffff';

    const toggleCameraWindow = useCallback((spacecraftUuid: string, portId: DockingPortId) => {
        setCameraWindows(prev => {
            const key: CameraKey = `${spacecraftUuid}:${portId}`;
            const existing = prev[key];
                if (existing) {
                    const nextOpen = !existing.open;
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

                // Transform direction using the same inverse rotation applied to the sphere
                // Result is horizon-scene camera-space direction aligned with our camera axes
                const cameraSpaceDir = direction.clone().applyMatrix4(rotationMatrix);

                    // Project the direction onto the view plane
                    // Compute edge radius from camera (supports perspective or orthographic)
                    const cam = horizonCameraRef.current!;
                    const planeZ = 0.4;
                    let rEdge = 0.45;
                    if ((cam as any).isPerspectiveCamera) {
                        const pc = cam as THREE.PerspectiveCamera;
                        const d = Math.max(1e-6, pc.position.z - planeZ);
                        const halfH = d * Math.tan(THREE.MathUtils.degToRad(pc.fov * 0.5));
                        const halfW = halfH * Math.max(1e-6, pc.aspect);
                        rEdge = Math.min(halfW, halfH) * 0.98;
                    } else if ((cam as any).isOrthographicCamera) {
                        const oc = cam as THREE.OrthographicCamera;
                        const halfW = (oc.right - oc.left) / 2;
                        const halfH = (oc.top - oc.bottom) / 2;
                        rEdge = Math.min(halfW, halfH) * 0.98;
                    }

                    // Use perspective-like mapping for consistency across camera types
                    const isInFront = cameraSpaceDir.z > 0;
                    const denom = Math.max(1e-6, Math.abs(cameraSpaceDir.z));
                    // Mirror to match sphere texture/yaw flip
                    const projectedX = -(cameraSpaceDir.x / denom) * rEdge;
                    const projectedY = -(cameraSpaceDir.y / denom) * rEdge;

                    const r = Math.hypot(projectedX, projectedY);
                    const angle = Math.atan2(projectedY, projectedX);

                    const arrow = targetArrowRef.current;

                    // Determine visibility and placement
                    const insideCircle = r <= rEdge * 0.95;

                    if (isInFront && insideCircle) {
                        // Show red X at the projected position
                        targetMarkerRef.current.visible = true;
                        targetMarkerRef.current.position.set(projectedX, projectedY, 0.4);

                        // Keep X a consistent size for legibility
                        targetMarkerRef.current.scale.setScalar(1.0);
                        targetMarkerRef.current.rotation.z = 0;

                        if (arrow) arrow.visible = false;
                    } else {
                        // Show an arrow at the edge pointing toward the target
                        targetMarkerRef.current.visible = false;
                        if (arrow) {
                            const clampedR = r > 1e-6 ? rEdge : 0;
                            const edgeX = r > 1e-6 ? (projectedX / r) * clampedR : 0;
                            const edgeY = r > 1e-6 ? (projectedY / r) * clampedR : 0;
                            arrow.visible = true;
                            arrow.position.set(edgeX, edgeY, 0.49);
                            arrow.rotation.z = angle; // arrow tip points outward toward the target
                        }
                    }
                } else {
                    if (targetMarkerRef.current) targetMarkerRef.current.visible = false;
                    if (targetArrowRef.current) targetArrowRef.current.visible = false;
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
            const aspect = w / h;
            if ((camera as any).isPerspectiveCamera) {
                const pc = camera as THREE.PerspectiveCamera;
                pc.aspect = aspect;
                pc.updateProjectionMatrix();
            } else if ((camera as any).isOrthographicCamera) {
                const oc = camera as THREE.OrthographicCamera;
                const size = 1; // world units to show vertically
                oc.top = size;
                oc.bottom = -size;
                oc.left = -size * aspect;
                oc.right = size * aspect;
                oc.updateProjectionMatrix();
            }
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
                const flattenPerspective = true; // flatten the sphere perspective
                if (flattenPerspective) {
                    const aspect = 1;
                    const size = 1; // match sphere radius for a tidy fit
                    const camera = new THREE.OrthographicCamera(
                        -size * aspect,
                        size * aspect,
                        size,
                        -size,
                        0.1,
                        10
                    );
                    camera.position.z = 1.2;
                    horizonCameraRef.current = camera;
                } else {
                    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
                    camera.position.z = 1.2;
                    horizonCameraRef.current = camera;
                }

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
                        attitudeSphereTexture || '/images/textures/rLHbWVB.png',
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
                const mainLineWidth = 10; // Even thicker center cross
                const mainVertices = new Float32Array([
                    -mainLineSize, 0, 0, mainLineSize, 0, 0,  // Horizontal line
                    0, -mainLineSize, 0, 0, mainLineSize, 0   // Vertical line
                ]);
                const mainGeometry = new THREE.BufferGeometry();
                mainGeometry.setAttribute('position', new THREE.BufferAttribute(mainVertices, 3));
                const mainMaterial = new THREE.LineBasicMaterial({
                    color: new THREE.Color(crosshairBaseHex),
                    opacity: 0.9,
                    transparent: true,
                    linewidth: mainLineWidth
                });
                const mainCrosshair = new THREE.LineSegments(mainGeometry, mainMaterial);
                crosshairGroup.add(mainCrosshair);

                // Small dot in the center
                const dotGeometry = new THREE.CircleGeometry(0.005, 32);
                const dotMaterial = new THREE.MeshBasicMaterial({
                    color: new THREE.Color(crosshairBaseHex),
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
                    color: new THREE.Color(crosshairBaseHex),
                    opacity: 0.7,
                    transparent: true,
                    linewidth: 2
                });
                const ticks = new THREE.LineSegments(tickGeometry, tickMaterial);
                crosshairGroup.add(ticks);

                // Create target marker as a red X (initially hidden)
                const targetMarkerSize = 0.08;
                const targetMarkerGeometry = new THREE.BufferGeometry();
                const targetMarkerVertices = new Float32Array([
                    // X shape: two diagonals
                    -targetMarkerSize, -targetMarkerSize, 0,  targetMarkerSize,  targetMarkerSize, 0,
                     targetMarkerSize, -targetMarkerSize, 0, -targetMarkerSize,  targetMarkerSize, 0,
                ]);
                targetMarkerGeometry.setAttribute('position', new THREE.BufferAttribute(targetMarkerVertices, 3));
                const targetMarkerMaterial = new THREE.LineBasicMaterial({
                    color: new THREE.Color(themeAccentHex),
                    opacity: 1.0,
                    transparent: true,
                    linewidth: 6,
                    depthTest: false
                });
                const targetMarker = new THREE.LineSegments(targetMarkerGeometry, targetMarkerMaterial);
                targetMarker.position.z = 0.4;
                targetMarker.visible = false;
                targetMarkerRef.current = targetMarker;
                scene.add(targetMarker);

                // Create out-of-bounds arrow (initially hidden)
                const arrowLength = 0.12;
                const arrowWidth = 0.08;
                const arrowGeometry = new THREE.BufferGeometry();
                const arrowVertices = new Float32Array([
                    // Triangle pointing along +X with tip at origin
                    0, 0, 0,
                    -arrowLength,  arrowWidth / 2, 0,
                    -arrowLength, -arrowWidth / 2, 0,
                ]);
                arrowGeometry.setAttribute('position', new THREE.BufferAttribute(arrowVertices, 3));
                arrowGeometry.setIndex([0, 1, 2]);
                arrowGeometry.computeVertexNormals();
                const arrowMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(themeAccentHex), opacity: 0.95, transparent: true, depthTest: false });
                const arrowMesh = new THREE.Mesh(arrowGeometry, arrowMaterial);
                arrowMesh.position.z = 0.49;
                arrowMesh.visible = false;
                targetArrowRef.current = arrowMesh;
                scene.add(arrowMesh);

                // Position the entire crosshair group
                crosshairGroup.position.z = 0.5;
                scene.add(crosshairGroup);

                // Save crosshair materials for theming updates
                (crosshairGroup as any)._mainMat = mainMaterial;
                (crosshairGroup as any)._dotMat = dotMaterial;
                (crosshairGroup as any)._tickMat = tickMaterial;
            } catch (error) {
                console.error('Error initializing horizon:', error);
            }
        };

        initializeHorizon();
    }, []);

    // Update sphere texture when selection changes after initialization
    useEffect(() => {
        const applyTexture = async () => {
            if (!sphereMeshRef.current || !horizonRendererRef.current) return;
            try {
                const textureLoader = new THREE.TextureLoader();
                const newTexture = await new Promise<THREE.Texture>((resolve, reject) => {
                    textureLoader.load(
                        attitudeSphereTexture || '/images/textures/rLHbWVB.png',
                        resolve,
                        undefined,
                        reject
                    );
                });
                newTexture.mapping = THREE.EquirectangularReflectionMapping;
                newTexture.minFilter = THREE.LinearMipmapLinearFilter;
                newTexture.magFilter = THREE.LinearFilter;
                const maxAnisotropy = horizonRendererRef.current.capabilities.getMaxAnisotropy();
                newTexture.anisotropy = maxAnisotropy;
                newTexture.repeat.x = -1;
                newTexture.offset.x = 1;

                const mat = sphereMeshRef.current.material as THREE.MeshBasicMaterial;
                const oldTex = mat.map;
                mat.map = newTexture;
                mat.needsUpdate = true;
                // Dispose previous to free GPU memory
                if (oldTex) oldTex.dispose();
            } catch (err) {
                console.error('Failed to update sphere texture', err);
            }
        };
        applyTexture();
    }, [attitudeSphereTexture]);

    // Update horizon UI accent and crosshair when theme changes
    useEffect(() => {
        const accent = new THREE.Color(themeAccentHex);
        if (targetMarkerRef.current) {
            const mat = targetMarkerRef.current.material as THREE.LineBasicMaterial;
            mat.color.copy(accent);
            mat.needsUpdate = true;
        }
        if (targetArrowRef.current) {
            const mat = targetArrowRef.current.material as THREE.MeshBasicMaterial;
            mat.color.copy(accent);
            mat.needsUpdate = true;
        }
        // Crosshair colors adjust for light theme
        const scene = horizonSceneRef.current;
        if (scene) {
            scene.traverse(obj => {
                const grp = obj as any;
                if (grp && grp._mainMat && grp._tickMat && grp._dotMat) {
                    const base = new THREE.Color(crosshairBaseHex);
                    (grp._mainMat as THREE.LineBasicMaterial).color.copy(base);
                    (grp._mainMat as THREE.LineBasicMaterial).needsUpdate = true;
                    (grp._tickMat as THREE.LineBasicMaterial).color.copy(base);
                    (grp._tickMat as THREE.LineBasicMaterial).needsUpdate = true;
                    (grp._dotMat as THREE.MeshBasicMaterial).color.copy(base);
                    (grp._dotMat as THREE.MeshBasicMaterial).needsUpdate = true;
                }
            });
        }
    }, [uiTheme]);

    // Removed global FOV overlay; per-camera FOV controls live in DockingCameraView

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
        <div ref={uiContainerRef} className={`relative w-full h-full theme-${uiTheme}`}>
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
                            title="Spacecraft Manager"
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
                            title="Flight Telemetry"
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
                            title="Attitude Indicator"
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
                            title="RCS Thrust"
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
                            title="Visualization Aids"
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
                            title="PID Tuning"
                            defaultPosition={windowPositions.pid}
                            onPositionChange={(pos: WindowPosition) => updateWindowPosition('pid', pos)}
                            isVisible={visibleWindows.pid}
                            zIndex={windowZ.pid}
                            onFocus={() => bringWindowToFront('pid')}
                        >
                            <PIDControllerWindow 
                                controller={controller?.getAutopilot()?.getOrientationPidController() ?? null}
                                rotationCancelController={controller?.getAutopilot()?.getRotationCancelPidController?.() ?? null}
                                linearController={controller?.getAutopilot()?.getLinearPidController() ?? null}
                                momentumController={controller?.getAutopilot()?.getMomentumPidController() ?? null}
                                autopilot={controller?.getAutopilot() ?? null}
                            />
                        </DraggableWindow>
                    )}

                    {visibleWindows.autopilot && (
                        <DraggableWindow
                            title="Autopilot & Targeting"
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
                            title="Docking Guidance"
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
                            title="Docking Cameras & Lights"
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
                    {visibleWindows.settings && (
                        <DraggableWindow
                            title="Display Settings"
                            defaultPosition={windowPositions.settings}
                            onPositionChange={(pos) => updateWindowPosition('settings', pos)}
                            onClose={() => toggleWindow('settings')}
                            initiallyCollapsed={false}
                            isVisible={visibleWindows.settings}
                            zIndex={windowZ.settings}
                            onFocus={() => bringWindowToFront('settings')}
                        >
                            <SettingsWindow />
                        </DraggableWindow>
                    )}
                    {Object.values(cameraWindows).filter(w => w.open).map(w => {
                        const sc = world?.getSpacecraftList?.().find(s => s.uuid === w.spacecraftUuid) ?? null;
                        const title = `Docking Camera: ${sc?.name ?? 'Unknown'} ${w.portId === 'front' ? 'Front' : 'Back'}`;
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

                {/* Per-camera FOV controls are embedded inside each DockingCameraView */}
            </div>

            <KeyboardShortcuts
                isVisible={showKeyboardShortcuts}
                onClose={() => setShowKeyboardShortcuts(false)}
            />
        </div>
    );
}; 
