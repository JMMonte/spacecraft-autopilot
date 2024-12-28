import React, { useState, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { Command } from 'lucide-react';
import { TopBar } from './TopBar';
import { DraggableWindow } from './DraggableWindow';
import { KeyboardShortcuts } from './KeyboardShortcuts';
import { LoadingOverlay } from './LoadingOverlay';
import { INITIAL_WINDOW_STATE } from '../constants';

// Import window components
import { TelemetryWindow } from './windows/TelemetryWindow';
import { ArtificialHorizonWindow } from './windows/ArtificialHorizonWindow';
import { DimensionsWindow } from './windows/DimensionsWindow';
import { RCSControlsWindow } from './windows/RCSControlsWindow';
import { HelperArrowsWindow } from './windows/HelperArrowsWindow';
import { PIDControllerWindow } from './windows/PIDControllerWindow';
import { AutopilotWindow } from './windows/AutopilotWindow';
import { SpacecraftListWindow } from './windows/SpacecraftListWindow';

export function Cockpit({ spacecraft, controller, loadingProgress, loadingStatus, onCreateNewSpacecraft }) {
  const calculateInitialPositions = () => {
    const padding = 20;
    const topBarHeight = 40;
    const titleBarHeight = 32; // Height of window title bar
    const windowWidth = 250;
    const telemetryHeight = 180; // Approximate height of telemetry window when open
    const horizonHeight = 240;   // Height of horizon window when open (200px canvas + padding)
    const autopilotHeight = 150; // Height of autopilot window when open

    // Left side windows
    let currentLeftY = topBarHeight + padding;
    const leftX = padding;
    
    // Right side windows - start from top
    const rightX = window.innerWidth - windowWidth - padding;
    let currentRightY = topBarHeight + padding;

    return {
      // Left column - windows attached to each other
      telemetry: { x: leftX, y: currentLeftY },
      horizon: { x: leftX, y: currentLeftY + telemetryHeight },

      // Right column - windows attached to each other from top
      dimensions: { x: rightX, y: currentRightY },
      rcs: { x: rightX, y: currentRightY + titleBarHeight },
      pid: { x: rightX, y: currentRightY + titleBarHeight * 2 },
      arrows: { x: rightX, y: currentRightY + titleBarHeight * 3 },
      autopilot: { x: rightX, y: currentRightY + titleBarHeight * 4 },
      spacecraftList: { x: leftX, y: currentLeftY + telemetryHeight + horizonHeight + padding }
    };
  };

  const [visibleWindows, setVisibleWindows] = useState(INITIAL_WINDOW_STATE);
  const [windowPositions, setWindowPositions] = useState(calculateInitialPositions);
  const [telemetryValues, setTelemetryValues] = useState({
    velocity: { x: 0, y: 0, z: 0 },
    angularVelocity: { x: 0, y: 0, z: 0 },
    orientation: { x: 0, y: 0, z: 0, w: 1 }
  });
  const [showKeyboardShortcuts, setShowKeyboardShortcuts] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const horizonRef = useRef(null);
  const targetMarkerRef = useRef(null);

  // Recalculate positions on window resize
  useEffect(() => {
    const handleResize = () => {
      setWindowPositions(calculateInitialPositions());
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    let animationFrameId;
    let horizonScene, horizonCamera, horizonRenderer;
    let sphereMesh;

    async function initializeHorizon() {
      try {
        // Initialize horizon renderer
        if (horizonRef.current) {
          // Setup scene
          horizonScene = new THREE.Scene();
          
          // Setup camera
          horizonCamera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
          horizonCamera.position.z = 1.2;
          
          // Setup renderer
          horizonRenderer = new THREE.WebGLRenderer({
            canvas: horizonRef.current,
            alpha: true,
            antialias: true
          });
          horizonRenderer.setSize(200, 200);
          horizonRenderer.setClearColor(0x000000, 0.2);

          // Create sphere with texture
          const textureLoader = new THREE.TextureLoader();
          const texture = await new Promise((resolve, reject) => {
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
          const maxAnisotropy = horizonRenderer.capabilities.getMaxAnisotropy();
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
          sphereMesh = new THREE.Mesh(sphereGeometry, sphereMaterial);
          sphereMesh.rotation.y = Math.PI;
          horizonScene.add(sphereMesh);

          // Create target crosshair
          const crosshairGroup = new THREE.Group();

          // Main crosshair lines
          const mainLineSize = 0.15;
          const mainLineWidth = 3;
          const mainVertices = new Float32Array([
            -mainLineSize, 0, 0,  mainLineSize, 0, 0,  // Horizontal line
            0, -mainLineSize, 0,  0, mainLineSize, 0   // Vertical line
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

          // Small dot in the center
          const dotGeometry = new THREE.CircleGeometry(0.005, 32);
          const dotMaterial = new THREE.MeshBasicMaterial({ 
            color: 0xffffff,
            opacity: 0.9,
            transparent: true
          });
          const dot = new THREE.Mesh(dotGeometry, dotMaterial);

          // Small tick marks
          const tickSize = 0.05;
          const tickOffset = 0.1;
          const tickVertices = new Float32Array([
            // Left tick
            -mainLineSize - tickSize, 0, 0,  -mainLineSize, 0, 0,
            // Right tick
            mainLineSize, 0, 0,  mainLineSize + tickSize, 0, 0,
            // Top tick
            0, mainLineSize, 0,  0, mainLineSize + tickSize, 0,
            // Bottom tick
            0, -mainLineSize - tickSize, 0,  0, -mainLineSize, 0
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

          // Create target marker (initially hidden)
          const targetMarkerSize = 0.08;
          const targetMarkerGeometry = new THREE.BufferGeometry();
          const targetMarkerVertices = new Float32Array([
            // Diamond shape
            0, targetMarkerSize, 0,    targetMarkerSize, 0, 0,
            targetMarkerSize, 0, 0,    0, -targetMarkerSize, 0,
            0, -targetMarkerSize, 0,   -targetMarkerSize, 0, 0,
            -targetMarkerSize, 0, 0,   0, targetMarkerSize, 0
          ]);
          targetMarkerGeometry.setAttribute('position', new THREE.BufferAttribute(targetMarkerVertices, 3));
          const targetMarkerMaterial = new THREE.LineBasicMaterial({
            color: 0xff0000,
            opacity: 1.0,
            transparent: true,
            linewidth: 3,
            depthTest: false
          });
          targetMarkerRef.current = new THREE.LineSegments(targetMarkerGeometry, targetMarkerMaterial);
          targetMarkerRef.current.position.z = 0.4;
          targetMarkerRef.current.visible = false;
          horizonScene.add(targetMarkerRef.current);

          // Add all elements to the group
          crosshairGroup.add(mainCrosshair);
          crosshairGroup.add(dot);
          crosshairGroup.add(ticks);
          
          // Position the entire crosshair group
          crosshairGroup.position.z = 0.5;
          horizonScene.add(crosshairGroup);
          
          setIsLoading(false);
        }
      } catch (error) {
        console.error('Error initializing horizon:', error);
      }
    }

    initializeHorizon();

    const updateTelemetry = () => {
      if (spacecraft?.objects?.box) {
        // Get velocity from the physics body
        const velocity = spacecraft.objects.boxBody?.velocity ?? { x: 0, y: 0, z: 0 };
        const angularVelocity = spacecraft.objects.boxBody?.angularVelocity ?? { x: 0, y: 0, z: 0 };
        const quaternion = spacecraft.objects.box?.quaternion ?? { x: 0, y: 0, z: 0, w: 1 };

        setTelemetryValues({
          velocity: {
            x: velocity.x?.toFixed(2) ?? '0.00',
            y: velocity.y?.toFixed(2) ?? '0.00',
            z: velocity.z?.toFixed(2) ?? '0.00'
          },
          angularVelocity: {
            x: angularVelocity.x?.toFixed(2) ?? '0.00',
            y: angularVelocity.y?.toFixed(2) ?? '0.00',
            z: angularVelocity.z?.toFixed(2) ?? '0.00'
          },
          orientation: {
            x: quaternion.x?.toFixed(2) ?? '0.00',
            y: quaternion.y?.toFixed(2) ?? '0.00',
            z: quaternion.z?.toFixed(2) ?? '0.00',
            w: quaternion.w?.toFixed(2) ?? '1.00'
          }
        });

        // Update artificial horizon
        if (sphereMesh && horizonCamera && horizonRenderer) {
          // Create a rotation matrix from the quaternion
          const rotationMatrix = new THREE.Matrix4().makeRotationFromQuaternion(
            new THREE.Quaternion(quaternion.x, quaternion.y, quaternion.z, quaternion.w)
          );
          
          // Apply the inverse rotation to show the horizon from spacecraft's perspective
          rotationMatrix.invert();
          sphereMesh.setRotationFromMatrix(rotationMatrix);

          // Update target marker if point-to-position is active
          if (controller?.autopilot?.activeAutopilots?.pointToPosition || controller?.autopilot?.activeAutopilots?.goToPosition) {
            const targetPosition = controller?.autopilot?.targetPosition;
            const currentPosition = spacecraft?.objects?.boxBody?.position;
            
            if (targetPosition && currentPosition && targetMarkerRef.current) {
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
              const projectedX = -(cameraSpaceDir.x / Math.abs(cameraSpaceDir.z)) * distance;  // Add back negation
              const projectedY = -(cameraSpaceDir.y / Math.abs(cameraSpaceDir.z)) * distance;  // Add back negation

              // Check if target is in front or behind (z > 0 means in front with our coordinate system)
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
            }
          } else if (targetMarkerRef.current) {
            targetMarkerRef.current.visible = false;
          }
          
          // Render horizon
          horizonRenderer.render(horizonScene, horizonCamera);
        }
      }

      animationFrameId = requestAnimationFrame(updateTelemetry);
    };

    updateTelemetry();
    return () => {
      cancelAnimationFrame(animationFrameId);
      if (horizonRenderer) {
        horizonRenderer.dispose();
      }
    };
  }, [spacecraft, controller]);

  useEffect(() => {
    if (horizonRef.current) {
      horizonRef.current.width = 200;
      horizonRef.current.height = 200;
    }
  }, []);

  const toggleWindow = (key) => {
    setVisibleWindows(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  const updateWindowPosition = (key, position) => {
    setWindowPositions(prev => ({
      ...prev,
      [key]: position
    }));
  };

  const handleSelectSpacecraft = (selectedSpacecraft) => {
    if (selectedSpacecraft && selectedSpacecraft !== spacecraft) {
      selectedSpacecraft.world.setActiveSpacecraft(selectedSpacecraft);
    }
  };

  const handleDeleteSpacecraft = (spacecraftToDelete) => {
    if (spacecraftToDelete === spacecraft) return; // Don't delete active spacecraft
    
    // Remove from world's spacecraft list
    const index = spacecraftToDelete.world.spacecraft.indexOf(spacecraftToDelete);
    if (index > -1) {
      spacecraftToDelete.world.spacecraft.splice(index, 1);
      spacecraftToDelete.cleanup?.();
    }
  };

  return (
    <>
      {isLoading && (
        <LoadingOverlay progress={loadingProgress} status={loadingStatus} />
      )}
      <div className="fixed inset-0 text-xs pt-8 font-['Menlo','Monaco','Courier_New',monospace] pointer-events-none">
        <div className="pointer-events-auto">
          <TopBar 
            visibleWindows={visibleWindows} 
            onToggleWindow={toggleWindow} 
            onCreateNewSpacecraft={onCreateNewSpacecraft}
          />
        </div>

        <div className="pointer-events-none">
          <DraggableWindow 
            title="Spacecraft List"
            defaultPosition={windowPositions.spacecraftList}
            isVisible={visibleWindows.spacecraftList}
            onPositionChange={(position) => updateWindowPosition('spacecraftList', position)}
            initiallyCollapsed={false}
          >
            <SpacecraftListWindow 
              world={spacecraft.world}
              activeSpacecraft={spacecraft}
              onCreateSpacecraft={onCreateNewSpacecraft}
              onSelectSpacecraft={handleSelectSpacecraft}
              onDeleteSpacecraft={handleDeleteSpacecraft}
            />
          </DraggableWindow>

          <DraggableWindow 
            title="Telemetry" 
            defaultPosition={windowPositions.telemetry}
            isVisible={visibleWindows.telemetry}
            onPositionChange={(position) => updateWindowPosition('telemetry', position)}
            initiallyCollapsed={false}
          >
            <TelemetryWindow telemetryValues={telemetryValues} />
          </DraggableWindow>

          <DraggableWindow 
            title="Artificial Horizon"
            defaultPosition={windowPositions.horizon}
            isVisible={visibleWindows.horizon}
            onPositionChange={(position) => updateWindowPosition('horizon', position)}
            initiallyCollapsed={false}
          >
            <ArtificialHorizonWindow horizonRef={horizonRef} />
          </DraggableWindow>

          <DraggableWindow 
            title="Spacecraft Dimensions"
            defaultPosition={windowPositions.dimensions}
            isVisible={visibleWindows.dimensions}
            onPositionChange={(position) => updateWindowPosition('dimensions', position)}
          >
            <DimensionsWindow spacecraft={spacecraft} />
          </DraggableWindow>

          <DraggableWindow 
            title="RCS Controls"
            defaultPosition={windowPositions.rcs}
            isVisible={visibleWindows.rcs}
            onPositionChange={(position) => updateWindowPosition('rcs', position)}
          >
            <RCSControlsWindow spacecraft={spacecraft} />
          </DraggableWindow>

          <DraggableWindow 
            title="Helper Arrows"
            defaultPosition={windowPositions.arrows}
            isVisible={visibleWindows.arrows}
            onPositionChange={(position) => updateWindowPosition('arrows', position)}
          >
            <HelperArrowsWindow spacecraft={spacecraft} />
          </DraggableWindow>

          <DraggableWindow 
            title="PID Controller"
            defaultPosition={windowPositions.pid}
            isVisible={visibleWindows.pid}
            onPositionChange={(position) => updateWindowPosition('pid', position)}
          >
            <PIDControllerWindow controller={controller} />
          </DraggableWindow>

          <DraggableWindow 
            title="Autopilot"
            defaultPosition={windowPositions.autopilot}
            isVisible={visibleWindows.autopilot}
            onPositionChange={(position) => updateWindowPosition('autopilot', position)}
            initiallyCollapsed={false}
          >
            <AutopilotWindow controller={controller} world={spacecraft.world} />
          </DraggableWindow>
        </div>

        <button 
          className="fixed bottom-2 right-2 w-6 h-6 bg-black/60 rounded flex items-center justify-center text-white/90 cursor-pointer text-xs hover:bg-white/20 transition-colors duration-200 border border-white/20 pointer-events-auto drop-shadow-md"
          onClick={() => setShowKeyboardShortcuts(true)}
        >
          <Command size={14} />
        </button>

        <KeyboardShortcuts 
          isVisible={showKeyboardShortcuts} 
          onClose={() => setShowKeyboardShortcuts(false)} 
        />
      </div>
    </>
  );
} 