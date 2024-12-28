import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Cockpit } from './components/Cockpit';
import { BasicWorld } from './js/BasicWorld';

export function App() {
  const [world, setWorld] = useState(null);
  const [activeSpacecraft, setActiveSpacecraft] = useState(null);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingStatus, setLoadingStatus] = useState('Initializing...');
  const canvasRef = useRef(null);

  const createNewSpacecraft = useCallback(() => {
    if (!world) return;
    const newSpacecraft = world.createNewSpacecraft();
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
        
        // Get active spacecraft
        const active = worldInstance.spacecraft.find(s => s.spacecraftController.isActive);
        setActiveSpacecraft(active);

        // Add an event listener for spacecraft changes
        const handleSpacecraftChange = () => {
          const active = worldInstance.spacecraft.find(s => s.spacecraftController.isActive);
          setActiveSpacecraft(active);
        };

        // Add event listener for double click
        worldInstance.onSpacecraftChange = handleSpacecraftChange;
        
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
        />
      )}
    </>
  );
} 