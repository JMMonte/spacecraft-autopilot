import { useRef, useEffect } from 'react'
import * as THREE from 'three'
import { DEFAULT_LENS_FLARE_UNIFORMS } from './lensFlareConfig'

// Import shader files as strings
import fragmentShader from '../shaders/lensFlare.frag?raw'
import vertexShader from '../shaders/lensFlare.vert?raw'

interface LensFlareShaderProps {
    opacity?: number
    enabled?: boolean
}

/**
 * Custom hook to create and manage the lens flare shader material
 * Uses useRef for proper object lifecycle management instead of misusing useMemo
 */
export function useLensFlareShader({ opacity = 0.8, enabled = true }: LensFlareShaderProps = {}) {
    // Use useRef for persistent object lifecycle - created once and reused
    const materialRef = useRef<THREE.ShaderMaterial | null>(null)

    // Create material only once on first render
    if (!materialRef.current) {
        materialRef.current = new THREE.ShaderMaterial({
            uniforms: {
                ...DEFAULT_LENS_FLARE_UNIFORMS,
                enabled: { value: enabled },
                opacity: { value: opacity },
                iResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
                lensPosition: { value: new THREE.Vector2(0, 0) },
                colorGain: { value: new THREE.Color(13, 11, 10) },
            },
            fragmentShader,
            vertexShader,
            transparent: true,
            depthWrite: false,
            depthTest: false,
            blending: THREE.AdditiveBlending,
            name: 'LensFlareShader',
        })
    }

    // Update uniforms when props change
    useEffect(() => {
        if (materialRef.current?.uniforms.opacity) {
            materialRef.current.uniforms.opacity.value = opacity
        }
    }, [opacity])

    useEffect(() => {
        if (materialRef.current?.uniforms.enabled) {
            materialRef.current.uniforms.enabled.value = enabled
        }
    }, [enabled])

    // MEMORY LEAK FIX: Dispose material on unmount
    useEffect(() => {
        return () => {
            if (materialRef.current) {
                materialRef.current.dispose()
                materialRef.current = null
            }
        }
    }, [])

    return materialRef.current
} 