import { useState, useRef, useCallback, useEffect } from 'react';
import { BasicWorld } from './core/BasicWorld';
import appConfig from './config/config.json';
import { Spacecraft } from './core/spacecraft';
import { Cockpit } from './components/Cockpit';
import { useElementSize } from './hooks/useElementSize';
import { createLogger } from './utils/logger';

export function App() {
    const log = createLogger('ui:App');
    const [world, setWorld] = useState<BasicWorld | null>(null);
    const [activeSpacecraft, setActiveSpacecraft] = useState<Spacecraft | null>(null);
    const [loadingProgress, setLoadingProgress] = useState<number>(0);
    const [loadingStatus, setLoadingStatus] = useState<string>('Initializing...');
    const [spacecraftListVersion, setSpacecraftListVersion] = useState<number>(0);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const worldRef = useRef<BasicWorld | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const createNewSpacecraft = useCallback(() => {
        if (!world) return;
        const newSpacecraft = world.createNewSpacecraft();
        log.debug('Creating new spacecraft');
        world.setActiveSpacecraft(newSpacecraft);
        return newSpacecraft;
    }, [world]);

    useEffect(() => {
        async function initializeWorld() {
            try {
                if (!canvasRef.current) return;

                // Initialize world with the canvas and app config
                const worldInstance = new BasicWorld(appConfig as any, canvasRef.current);
                worldRef.current = worldInstance;

                // Set loading callbacks
                worldInstance.setLoadingCallbacks(
                    (progress: number) => setLoadingProgress(Math.round(progress)),
                    (status: string) => setLoadingStatus(status)
                );

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
            if (worldRef.current) {
                worldRef.current.cleanup();
                worldRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        if (!world) return;

        const onActiveSpacecraftChange = (spacecraft: Spacecraft) => {
            setActiveSpacecraft(spacecraft);
        };

        const onSpacecraftListChange = (version: number) => {
            setSpacecraftListVersion(version);
        };

        world.setActiveSpacecraftChangeCallback(onActiveSpacecraftChange);
        world.setSpacecraftListChangeCallback(onSpacecraftListChange);

        return () => {
            // Replace with no-ops to avoid stale closures if world persists
            world.setActiveSpacecraftChangeCallback((_s: Spacecraft) => {});
            world.setSpacecraftListChangeCallback((_v: number) => {});
        };
    }, [world]);

    // Reactful resize: observe canvas size and trigger world resize
    const { width: canvasWidth, height: canvasHeight } = useElementSize(canvasRef.current);
    useEffect(() => {
        if (!worldRef.current) return;
        if (canvasWidth > 0 && canvasHeight > 0) {
            worldRef.current.resize();
        }
    }, [canvasWidth, canvasHeight]);

    // Ensure our container can receive key events when the world is ready
    useEffect(() => {
        if (world && containerRef.current) {
            containerRef.current.focus();
        }
    }, [world]);

    return (
        <div
            ref={containerRef}
            tabIndex={-1}
            onKeyDown={(e) => {
                // Ignore typing in inputs/textareas/selects or contenteditable elements
                const target = e.target as HTMLElement | null;
                const tag = target?.tagName;
                const isEditable = !!target && (target.getAttribute?.('contenteditable') === 'true');
                if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || isEditable) return;
                worldRef.current?.onKeyDown(e.nativeEvent);
            }}
            onKeyUp={(e) => {
                const target = e.target as HTMLElement | null;
                const tag = target?.tagName;
                const isEditable = !!target && (target.getAttribute?.('contenteditable') === 'true');
                if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || isEditable) return;
                worldRef.current?.onKeyUp(e.nativeEvent);
            }}
        >
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
                onDoubleClick={(e) => {
                    if (worldRef.current) {
                        worldRef.current.onDoubleClick(e.nativeEvent);
                    }
                }}
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
        </div>
    );
}
