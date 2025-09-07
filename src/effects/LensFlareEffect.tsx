import { useMemo, useRef, useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useLensFlareShader } from './useLensFlareShader'
import { calculateOcclusion, calculateDistanceOpacity, calculateDistanceScale, isSunVisible } from './lensFlareUtils'
import { LENS_FLARE_CONFIG } from './lensFlareConfig'
// Note: This component is not currently used by the app runtime.
// Keep it self-contained to avoid build-time type errors.

interface LensFlareEffectProps {
    /** Current world-space position of the Sun (mutated in-place every physics tick). */
    sun: THREE.Vector3
    /** Lens flare opacity (0-1) */
    opacity?: number
    /** Enable/disable the effect */
    enabled?: boolean
}

/**
 * Custom hook for lens flare positioning and visibility calculation
 */
function useLensFlareState(sun: THREE.Vector3, enabled: boolean) {
    const { camera, scene } = useThree()

    // Pre-allocated objects for performance
    const projectedPosition = useRef(new THREE.Vector3())
    const screenCoords = useRef(new THREE.Vector2())
    const raycaster = useRef(new THREE.Raycaster())
    const frameCounter = useRef(0)
    const lastOcclusionOpacity = useRef(0)
    const occludersRef = useRef<THREE.Object3D[]>([])

    const state = useRef({
        internalOpacity: 0,
        scale: 1,
        lensPosition: new THREE.Vector2(),
        time: 0
    })

    // Build occluder list once and refresh occasionally to capture scene graph changes
    useEffect(() => {
        const rebuild = () => {
            const list: THREE.Object3D[] = []
            const celestialRoot = scene.getObjectByName('CelestialSystem')
            const roots = celestialRoot ? celestialRoot.children : scene.children
            for (const child of roots) {
                if (child.name && child.name.endsWith('-system')) {
                    list.push(child)
                }
            }
            occludersRef.current = list
        }
        rebuild()
    }, [scene])

    useFrame((_, delta) => {
        if (!enabled) return

        frameCounter.current++
        state.current.time += delta

        // Project sun position to screen space
        projectedPosition.current.copy(sun).project(camera)
        const isVisible = isSunVisible(projectedPosition.current)

        if (isVisible) {
            // Update lens position
            state.current.lensPosition.set(
                projectedPosition.current.x,
                projectedPosition.current.y
            )

            // Calculate distance-based effects
            const sunDistance = camera.position.distanceTo(sun)
            const distanceOpacity = calculateDistanceOpacity(sunDistance)
            state.current.scale = calculateDistanceScale(sunDistance)

            // Throttled occlusion testing (every 3rd frame ~20 fps)
            if (frameCounter.current % 3 === 0) {
                screenCoords.current.set(projectedPosition.current.x, projectedPosition.current.y)
                raycaster.current.setFromCamera(screenCoords.current, camera)

                // Prefer selective occluders (planet systems); fall back to scene children if empty
                const occludingObjects = occludersRef.current.length > 0
                    ? occludersRef.current
                    : scene.children.filter(child => child.userData?.lensflare !== 'no-occlusion')
                const intersects = raycaster.current.intersectObjects(occludingObjects, true)

                lastOcclusionOpacity.current = intersects.length > 0
                    ? calculateOcclusion(intersects)
                    : 0
            }

            // Combine opacities (use the worst case)
            state.current.internalOpacity = Math.max(
                lastOcclusionOpacity.current,
                distanceOpacity
            )
        } else {
            // Sun not visible - fully hidden
            state.current.internalOpacity = 1.0
        }
    })

    return state.current
}

/**
 * R3F-idiomatic lens flare effect component
 * Uses declarative JSX patterns and custom hooks for clean separation of concerns
 */
export default function LensFlareEffect({ sun, opacity = 0.8, enabled = true }: LensFlareEffectProps) {
    const showLensFlares = true
    const viewport = useRef(new THREE.Vector4())
    const viewportUpdateFrameCounterRef = useRef(0)
    const lastViewportRef = useRef(new THREE.Vector4())

    // Custom hook handles all the lens flare calculations
    const flareState = useLensFlareState(sun, enabled && showLensFlares)

    // Declarative shader material
    const material = useLensFlareShader({ opacity, enabled })

    // Declarative geometry (automatically cleaned up by r3f)
    const geometry = useMemo(() => new THREE.PlaneGeometry(2, 2, 1, 1), [])

    // Mesh ref for camera-facing behavior
    const meshRef = useRef<THREE.Mesh>(null)

    // Update shader uniforms and mesh orientation in useFrame (throttled)
    useFrame(({ camera, gl }) => {
        if (!enabled || !showLensFlares || !material) return

        const mesh = meshRef.current
        if (mesh) {
            // Always face the camera (r3f pattern)
            mesh.lookAt(camera.position)
            // Disable raycasting to prevent self-occlusion
            mesh.raycast = () => { /* no-op */ }
        }

        // Throttle expensive viewport uniform updates to every 2nd frame
        viewportUpdateFrameCounterRef.current++
        if (viewportUpdateFrameCounterRef.current % 2 === 0) {
            gl.getCurrentViewport(viewport.current)
            if (!viewport.current.equals(lastViewportRef.current)) {
                lastViewportRef.current.copy(viewport.current)
                material.uniforms.iResolution.value.set(viewport.current.z, viewport.current.w)
            }
        }

        // Update shader uniforms
        material.uniforms.enabled.value = enabled && showLensFlares
        material.uniforms.lensPosition.value.copy(flareState.lensPosition)
        material.uniforms.iTime.value = flareState.time

        // Smooth opacity interpolation
        const currentOpacity = material.uniforms.opacity.value
        const targetOpacity = flareState.internalOpacity
        material.uniforms.opacity.value = THREE.MathUtils.lerp(
            currentOpacity,
            targetOpacity,
            LENS_FLARE_CONFIG.OPACITY_LERP_SPEED
        )
    })

    if (!enabled || !showLensFlares) return null

    return (
        <mesh
            ref={meshRef}
            geometry={geometry}
            material={material}
            renderOrder={1000}
            scale={flareState.scale}
        />
    )
} 
