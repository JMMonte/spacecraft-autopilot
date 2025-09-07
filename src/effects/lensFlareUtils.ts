import * as THREE from 'three'
import { LENS_FLARE_CONFIG } from './lensFlareConfig'

/**
 * Check if an object should be ignored for occlusion calculations
 * @param obj The mesh object to check
 * @returns Whether the object should be ignored
 */
function shouldIgnoreForOcclusion(obj: THREE.Mesh): boolean {
    let current = obj as THREE.Object3D
    while (current) {
        if (current.userData?.lensflare === 'no-occlusion') {
            return true
        }
        if (current.name?.includes('Sun') || current.name?.includes('star')) {
            return true
        }
        current = current.parent as THREE.Object3D
    }
    return false
}

/**
 * Calculate occlusion value for a material
 * @param material The material to check
 * @returns Occlusion value (0 = no occlusion, 1 = full occlusion)
 */
function calculateMaterialOcclusion(material: THREE.Material & {
    transmission?: number
    transparent?: boolean
    opacity?: number
}): number {
    // Check for transmission (glass-like materials)
    if (material.transmission !== undefined) {
        return material.transmission > 0.2 ? 1.0 - material.transmission : 1.0
    }
    
    // Check for transparency (clouds, rings, atmospheres)
    if (material.transparent && material.opacity !== undefined) {
        return material.opacity < 0.98 ? material.opacity : 1.0
    }
    
    // Opaque materials cause full occlusion
    return 1.0
}

/**
 * Get user-defined transmission value if present
 * @param obj The mesh object
 * @returns User transmission value or undefined
 */
function getUserTransmission(obj: THREE.Mesh): number | undefined {
    const udTransmission = (obj.userData as { lensflareTransmission?: number } | undefined)?.lensflareTransmission
    return typeof udTransmission === 'number' && !Number.isNaN(udTransmission) ? udTransmission : undefined
}

/**
 * Accumulate occlusion from multiple transparent layers
 * @param totalOcclusion Current total occlusion
 * @param objectOcclusion New object's occlusion
 * @returns New total occlusion
 */
function accumulateOcclusion(totalOcclusion: number, objectOcclusion: number): number {
    const remainingLight = 1.0 - totalOcclusion
    const newTotal = totalOcclusion + remainingLight * objectOcclusion
    return newTotal >= 0.99 ? 1.0 : newTotal
}

/**
 * Check transparency and occlusion for lens flare effect
 * @param intersects Array of raycaster intersections
 * @returns Occlusion value (0 = visible, 1 = hidden)
 */
export function calculateOcclusion(intersects: THREE.Intersection[]): number {
    if (intersects.length === 0) {
        return 0.0
    }

    let totalOcclusion = 0.0

    for (const intersection of intersects) {
        const obj = intersection.object as THREE.Mesh
        if (!obj.material) continue

        // Skip objects marked as no-occlusion
        if (shouldIgnoreForOcclusion(obj)) {
            continue
        }

        const material = obj.material as THREE.Material & {
            transmission?: number
            transparent?: boolean
            opacity?: number
        }

        // Check for user-defined transmission override
        const userTransmission = getUserTransmission(obj)
        const objectOcclusion = userTransmission !== undefined 
            ? 1.0 - THREE.MathUtils.clamp(userTransmission, 0, 1)
            : calculateMaterialOcclusion(material)

        // Accumulate occlusion (layered transparency)
        totalOcclusion = accumulateOcclusion(totalOcclusion, objectOcclusion)

        // Early exit if fully occluded
        if (totalOcclusion >= 1.0) {
            break
        }
    }

    return totalOcclusion
}

/**
 * Calculate distance-based opacity for lens flare
 * @param sunDistance Distance to the sun in world units
 * @returns Opacity value (0 = bright, 1 = faded)
 */
export function calculateDistanceOpacity(sunDistance: number): number {
    const { FADE_START, FADE_END, FADE_EXP, USE_LOG_DISTANCE } = LENS_FLARE_CONFIG

    let dNorm: number

    if (USE_LOG_DISTANCE) {
        const logStart = Math.log10(FADE_START)
        const logEnd = Math.log10(FADE_END)
        const logDist = Math.log10(THREE.MathUtils.clamp(sunDistance, FADE_START, FADE_END))
        dNorm = (logDist - logStart) / (logEnd - logStart)
    } else {
        dNorm = (sunDistance - FADE_START) / (FADE_END - FADE_START)
    }

    dNorm = THREE.MathUtils.clamp(dNorm, 0, 1)

    // Fade curve: opacity = dNorm ^ FADE_EXP (ease-in-like)
    return Math.pow(dNorm, FADE_EXP)
}

/**
 * Calculate distance-based scale for lens flare
 * @param sunDistance Distance to the sun in world units
 * @returns Scale factor
 */
export function calculateDistanceScale(sunDistance: number): number {
    const { FADE_START, FADE_END, MAX_SCALE, MIN_SCALE, USE_LOG_DISTANCE } = LENS_FLARE_CONFIG

    let dNorm: number

    if (USE_LOG_DISTANCE) {
        const logStart = Math.log10(FADE_START)
        const logEnd = Math.log10(FADE_END)
        const logDist = Math.log10(THREE.MathUtils.clamp(sunDistance, FADE_START, FADE_END))
        dNorm = (logDist - logStart) / (logEnd - logStart)
    } else {
        dNorm = (sunDistance - FADE_START) / (FADE_END - FADE_START)
    }

    dNorm = THREE.MathUtils.clamp(dNorm, 0, 1)

    return THREE.MathUtils.lerp(MAX_SCALE, MIN_SCALE, dNorm)
}

/**
 * Check if the sun is visible on screen
 * @param projectedPosition Projected sun position
 * @returns Whether the sun is visible
 */
export function isSunVisible(projectedPosition: THREE.Vector3): boolean {
    const { VISIBILITY_MARGIN } = LENS_FLARE_CONFIG

    return projectedPosition.z <= 1.0 &&
        Math.abs(projectedPosition.x) <= (1.0 + VISIBILITY_MARGIN) &&
        Math.abs(projectedPosition.y) <= (1.0 + VISIBILITY_MARGIN)
} 