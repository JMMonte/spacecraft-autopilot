import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Cockpit } from './components/Cockpit';
import { BasicWorld } from './js/BasicWorld';

export function App() {
  const [world, setWorld] = useState(null);
  const [activeSpacecraft, setActiveSpacecraft] = useState(null);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingStatus, setLoadingStatus] = useState('Initializing...');
  const [spacecraftListVersion, setSpacecraftListVersion] = useState(0);
  const canvasRef = useRef(null);

  const createNewSpacecraft = useCallback(() => {
    if (!world) return;
    console.log('App: Creating new spacecraft, current count:', world.spacecraft.length);
    world.createNewSpacecraft();
  }, [world]);

  useEffect(() => {
    async function initializeWorld() {
      try {
        // Initialize world with the canvas
        const worldInstance = new BasicWorld({}, canvasRef.current);
        
        // Set loading callbacks
        worldInstance.setLoadingCallbacks(
          (progress) => setLoadingProgress(Math.round(progress)),
          (status) => setLoadingStatus(status)
        );

        // Wait for world initialization
        await worldInstance.initializeWorld();
        
        setWorld(worldInstance);
        setSpacecraftListVersion(worldInstance.spacecraftListVersion);
        setActiveSpacecraft(worldInstance.getActiveSpacecraft());
        console.log('App: World initialized with', worldInstance.spacecraft.length, 'spacecraft');
        
        // Add event listeners for spacecraft changes
        worldInstance.onActiveSpacecraftChange = (spacecraft) => {
          console.log('App: Active spacecraft changed to:', spacecraft.name);
          setActiveSpacecraft(spacecraft);
        };

        worldInstance.onSpacecraftListChange = (version) => {
          console.log('App: Spacecraft list changed, new version:', version, 'count:', worldInstance.spacecraft.length);
          setSpacecraftListVersion(version);
        };
        
        // Start render loop
        worldInstance.startRenderLoop();
      } catch (error) {
        console.error('Error initializing world:', error);
        setLoadingStatus('Error: ' + error.message);
      }
    }

    if (canvasRef.current) {
      initializeWorld();
    }

    return () => {
      if (world) {
        world.cleanup?.();
      }
    };
  }, [canvasRef]);

  return (
    <>
      {/* Loading Overlay */}
      <div 
        className="fixed inset-0 bg-black z-50 flex items-center justify-center"
        style={{ 
          opacity: loadingProgress >= 100 ? 0 : 1,
          visibility: loadingProgress >= 100 ? 'hidden' : 'visible',
          transition: 'opacity 0.5s'
        }}
      >
        <div className="flex flex-col items-center gap-6 max-w-sm mx-auto px-4">
          <div className="text-white/90 text-sm font-mono text-center drop-shadow-md">
            {loadingStatus}
          </div>
          <div className="w-full bg-white/10 rounded-full h-1 overflow-hidden">
            <div 
              className="h-full bg-cyan-300/30 transition-all duration-300 ease-out"
              style={{ width: `${loadingProgress}%` }}
            />
          </div>
        </div>
      </div>

      {/* Main Canvas */}
      <canvas
        ref={canvasRef}
        className="fixed inset-0 w-full h-full"
        style={{ zIndex: 0 }}
      />
      
      {/* Cockpit UI */}
      {activeSpacecraft && (
        <Cockpit
          spacecraft={activeSpacecraft}
          controller={activeSpacecraft.spacecraftController}
          loadingProgress={loadingProgress}
          loadingStatus={loadingStatus}
          onCreateNewSpacecraft={createNewSpacecraft}
          spacecraftListVersion={spacecraftListVersion}
        />
      )}
    </>
  );
} 