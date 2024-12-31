import { useState, useRef, useCallback, useEffect } from 'react';
import { BasicWorld } from './core/BasicWorld';
import { Spacecraft } from './core/spacecraft';
import { Cockpit } from './components/Cockpit';

export function App() {
    const [world, setWorld] = useState<BasicWorld | null>(null);
    const [activeSpacecraft, setActiveSpacecraft] = useState<Spacecraft | null>(null);
    const [loadingProgress, setLoadingProgress] = useState<number>(0);
    const [loadingStatus, setLoadingStatus] = useState<string>('Initializing...');
    const [spacecraftListVersion, setSpacecraftListVersion] = useState<number>(0);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const createNewSpacecraft = useCallback(() => {
        if (!world) return;
        const newSpacecraft = world.createNewSpacecraft();
        console.log('App: Creating new spacecraft');
        world.setActiveSpacecraft(newSpacecraft);
        return newSpacecraft;
    }, [world]);

    useEffect(() => {
        async function initializeWorld() {
            try {
                if (!canvasRef.current) return;

                // Initialize world with the canvas
                const worldInstance = new BasicWorld({}, canvasRef.current);

                // Set loading callbacks
                worldInstance.setLoadingCallbacks(
                    (progress: number) => setLoadingProgress(Math.round(progress)),
                    (status: string) => setLoadingStatus(status)
                );

                // Set spacecraft list change callback
                worldInstance.setSpacecraftListChangeCallback((version: number) => {
                    setSpacecraftListVersion(version);
                });

                // Wait for world initialization
                await worldInstance.initializeWorld();

                setWorld(worldInstance);
                setSpacecraftListVersion(prev => prev + 1);

                // Set active spacecraft
                const initialSpacecraft = worldInstance.getActiveSpacecraft();
                if (initialSpacecraft) {
                    setActiveSpacecraft(initialSpacecraft);
                }

                // Start render loop
                worldInstance.startRenderLoop();
            } catch (error) {
                console.error('Error initializing world:', error);
                setLoadingStatus(`Error: ${(error as Error).message}`);
            }
        }

        initializeWorld();

        return () => {
            if (world) {
                world.cleanup();
            }
        };
    }, []);

    useEffect(() => {
        if (world) {
            const onActiveSpacecraftChange = (spacecraft: Spacecraft) => {
                setActiveSpacecraft(spacecraft);
            };
            world.setActiveSpacecraftChangeCallback(onActiveSpacecraftChange);
        }
    }, [world]);

    useEffect(() => {
        if (world) {
            const onSpacecraftListChange = (version: number) => {
                setSpacecraftListVersion(version);
            };
            world.setSpacecraftListChangeCallback(onSpacecraftListChange);
        }
    }, [world]);

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
            {activeSpacecraft && activeSpacecraft.spacecraftController && (
                <Cockpit
                    spacecraft={activeSpacecraft}
                    spacecraftController={activeSpacecraft.spacecraftController}
                    loadingProgress={loadingProgress}
                    loadingStatus={loadingStatus}
                    onCreateNewSpacecraft={createNewSpacecraft}
                    spacecraftListVersion={spacecraftListVersion}
                />
            )}
        </>
    );
} 