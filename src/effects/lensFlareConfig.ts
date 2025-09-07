/**
 * Lens flare effect configuration constants
 */

// Distance-based fading & scaling parameters
export const LENS_FLARE_CONFIG = {
    // Distance fade parameters (in world-space meters)
    FADE_START: 1e7,      // 1 billion meters – start fading far away
    FADE_END: 1e12,       // 10 trillion meters – still visible at 1 AU
    FADE_EXP: 3.0,        // Strong ease-in: keeps bright until very far

    // Size scaling parameters
    MAX_SCALE: 1,       // At / inside FADE_START
    MIN_SCALE: 1e-5,    // At / past FADE_END

    // Use logarithmic distance normalisation
    USE_LOG_DISTANCE: true,

    // Visibility check margins
    VISIBILITY_MARGIN: 0.1,

    // Opacity interpolation speed
    OPACITY_LERP_SPEED: 0.1,
} as const

// Default shader uniforms
export const DEFAULT_LENS_FLARE_UNIFORMS = {
    iTime: { value: 0 },
    iResolution: { value: { x: window.innerWidth, y: window.innerHeight } },
    lensPosition: { value: { x: 0, y: 0 } },
    enabled: { value: true },
    colorGain: { value: { r: 11, g: 11, b: 11 } },
    starPoints: { value: 5.0 },
    glareSize: { value: 1.95 },
    flareSize: { value: 0.1 },
    flareSpeed: { value: 0.004 },
    flareShape: { value: 0.01 },
    haloScale: { value: 0.5 },
    opacity: { value: 0.8 },
    animated: { value: false },
    anamorphic: { value: false },
    secondaryGhosts: { value: true },
    starBurst: { value: true },
    ghostScale: { value: 0.3 },
    aditionalStreaks: { value: false },
    followMouse: { value: false },
} as const 

// Scene layer used by the global, screen-space lens flare mesh.
// Cameras that should render the built-in flare must enable this layer.
// Secondary cameras (e.g., docking views) can omit this layer and draw
// their own per-camera overlay to avoid placement conflicts.
export const LENS_FLARE_LAYER = 31;
