/**
 * AsteroidLODCache — Loads each asteroid _LOD.fbx once, caches geometry at
 * multiple detail levels, and provides shared materials with downscaled textures.
 *
 * Only 4 model IDs exist ('1a','1e','2a','2b'), so total cache is small.
 *
 * Each _LOD.fbx contains 6 named meshes: LOD0 (full) through LOD5 (lowest).
 * We pick 3 tiers for THREE.LOD usage:
 *   - Near  (LOD0): full geometry + MeshPhysicalMaterial + 2K textures
 *   - Mid   (LOD3): ~12% verts + MeshStandardMaterial + downscaled textures
 *   - Far   (LOD5): ~3% verts  + MeshLambertMaterial + flat color, no textures
 */

import * as THREE from 'three';
// @ts-ignore
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { createLogger } from '../utils/logger';
import type { AsteroidModelId } from './AsteroidModel';

const log = createLogger('objects:AsteroidLODCache');

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LODTier {
    geometry: THREE.BufferGeometry; // centered, unit-scale (needs per-instance scaling)
    material: THREE.Material;
    /** Recommended distance threshold for THREE.LOD.addLevel() */
    distance: number;
}

export interface CachedAsteroidLOD {
    tiers: LODTier[];       // [near, mid, far] — sorted by distance ascending
    gmax: number;           // max extent of LOD0 geometry (for diameter scaling)
    gcenter: THREE.Vector3; // center offset of LOD0 bounding box
}

// ─── Texture downscaling ─────────────────────────────────────────────────────

/** Downscale a texture to targetSize using an offscreen canvas. Returns a new texture. */
function downscaleTexture(source: THREE.Texture, targetSize: number): THREE.Texture {
    const canvas = document.createElement('canvas');
    canvas.width = targetSize;
    canvas.height = targetSize;
    const ctx = canvas.getContext('2d');
    if (!ctx || !source.image) return source;
    ctx.drawImage(source.image as CanvasImageSource, 0, 0, targetSize, targetSize);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = source.colorSpace;
    tex.wrapS = source.wrapS;
    tex.wrapT = source.wrapT;
    tex.needsUpdate = true;
    return tex;
}

// ─── Silent texture loader ───────────────────────────────────────────────────

function makeSilentTextureLoader(): THREE.TextureLoader {
    const mgr = new THREE.LoadingManager();
    mgr.onError = () => {};
    return new THREE.TextureLoader(mgr);
}

// ─── The cache ───────────────────────────────────────────────────────────────

const cache = new Map<AsteroidModelId, Promise<CachedAsteroidLOD>>();
const fbxLoader = new FBXLoader();

/**
 * Get (or start loading) cached LOD data for a model.
 * Returns a promise that resolves once the FBX and textures are ready.
 */
export function getAsteroidLOD(modelId: AsteroidModelId): Promise<CachedAsteroidLOD> {
    const existing = cache.get(modelId);
    if (existing) return existing;

    const promise = loadAndCache(modelId);
    cache.set(modelId, promise);
    return promise;
}

/** Pre-warm the cache for all model IDs. */
export function preloadAllAsteroidLODs(): Promise<CachedAsteroidLOD[]> {
    const ids: AsteroidModelId[] = ['1a', '1e', '2a', '2b'];
    return Promise.all(ids.map(getAsteroidLOD));
}

// ─── Internal loading ────────────────────────────────────────────────────────

/** LOD mesh names we pick from the FBX (in order: near, mid, far). */
const TIER_SUFFIXES = ['LOD0', 'LOD3', 'LOD5'];
/** Distance multipliers: applied to asteroid diameter to get LOD switch distances. */
const DISTANCE_MULTIPLIERS = [0, 8, 25];

async function loadAndCache(modelId: AsteroidModelId): Promise<CachedAsteroidLOD> {
    const lodPath = `/Asteroid_${modelId}_FBX/Asteroid_${modelId}_LOD.fbx`;

    // Load LOD FBX
    const group = await new Promise<THREE.Group>((resolve, reject) => {
        fbxLoader.load(lodPath, resolve, undefined, (err: unknown) => {
            reject(new Error(`Failed to load ${lodPath}: ${err instanceof Error ? err.message : err}`));
        });
    });

    // Extract the 3 tier meshes by name
    const meshByName = new Map<string, THREE.Mesh>();
    group.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
            meshByName.set(child.name, child as THREE.Mesh);
        }
    });

    const tierMeshes: THREE.Mesh[] = [];
    for (const suffix of TIER_SUFFIXES) {
        const name = `Asteroid_${modelId}_${suffix}`;
        const mesh = meshByName.get(name);
        if (!mesh) {
            log.error(`Missing LOD mesh "${name}" in ${lodPath}. Available:`, [...meshByName.keys()]);
            throw new Error(`Missing LOD mesh: ${name}`);
        }
        tierMeshes.push(mesh);
    }

    // Use LOD0 to compute centering and scale reference
    const lod0Geom = tierMeshes[0].geometry;
    lod0Geom.computeBoundingBox();
    const gbox = lod0Geom.boundingBox!;
    const gsize = new THREE.Vector3();
    gbox.getSize(gsize);
    const gmax = Math.max(gsize.x, gsize.y, gsize.z);
    const gcenter = gbox.getCenter(new THREE.Vector3());

    if (gmax <= 0) throw new Error(`Zero-extent LOD0 geometry for model ${modelId}`);

    // Load textures (shared across tiers that use them)
    const texLoader = makeSilentTextureLoader();
    const baseTexturePath = `/Asteroid_${modelId}_FBX/2K/Asteroid${modelId}`;

    const loadTex = (url: string, colorSpace: THREE.ColorSpace): Promise<THREE.Texture | null> => {
        return new Promise((resolve) => {
            texLoader.load(url, (t) => {
                t.colorSpace = colorSpace;
                t.wrapS = t.wrapT = THREE.RepeatWrapping;
                resolve(t);
            }, undefined, () => resolve(null));
        });
    };

    // Load full-res textures
    const [colorTex, normalTex, aoTex] = await Promise.all([
        loadTex(`${baseTexturePath}_Color_2K.png`, THREE.SRGBColorSpace),
        // Try multiple normal map naming conventions
        (async () => {
            const candidates = modelId.startsWith('2')
                ? [`${baseTexturePath}_NormalGL_2K.png`]
                : modelId === '1e'
                    ? [`${baseTexturePath}_NormalOpenGL_2K.png`]
                    : [`${baseTexturePath}_Normal_OpenGL_2K.png`];
            for (const c of candidates) {
                const t = await loadTex(c, THREE.NoColorSpace);
                if (t) return t;
            }
            return null;
        })(),
        (async () => {
            const t = await loadTex(`${baseTexturePath}_AORM_2K.png`, THREE.NoColorSpace);
            if (t) return t;
            return loadTex(`${baseTexturePath}_Mixed_AO_2K.png`, THREE.NoColorSpace);
        })(),
    ]);

    // Downscaled textures for mid tier
    const midColorTex = colorTex ? downscaleTexture(colorTex, 512) : null;
    const midNormalTex = normalTex ? downscaleTexture(normalTex, 512) : null;

    // ── Build materials ──

    // Near: full quality MeshPhysicalMaterial
    const nearMat = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        roughness: 1.0,
        metalness: 0.0,
        envMapIntensity: 0.0,
        normalScale: new THREE.Vector2(1, 1),
        aoMapIntensity: 0.55,
        side: THREE.FrontSide,
        flatShading: false,
        normalMapType: THREE.TangentSpaceNormalMap,
        ...(colorTex ? { map: colorTex } : {}),
        ...(normalTex ? { normalMap: normalTex } : {}),
        ...(aoTex ? { aoMap: aoTex } : {}),
    });

    // Mid: MeshStandardMaterial with downscaled textures
    const midMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 1.0,
        metalness: 0.0,
        side: THREE.FrontSide,
        flatShading: false,
        ...(midColorTex ? { map: midColorTex } : {}),
        ...(midNormalTex ? { normalMap: midNormalTex } : {}),
    });

    // Far: MeshLambertMaterial, flat color sampled from the color texture
    const farColor = colorTex?.image
        ? sampleAverageColor(colorTex.image as HTMLImageElement)
        : 0x666666;
    const farMat = new THREE.MeshLambertMaterial({
        color: farColor,
        side: THREE.FrontSide,
    });

    const materials = [nearMat, midMat, farMat];

    // ── Build geometry tiers ──

    const tiers: LODTier[] = tierMeshes.map((mesh, i) => {
        const geom = mesh.geometry.clone();
        // Center geometry to LOD0's center (consistent across tiers)
        geom.translate(-gcenter.x, -gcenter.y, -gcenter.z);
        // Ensure normals and UVs
        if (!geom.hasAttribute('normal')) geom.computeVertexNormals();
        if (!geom.hasAttribute('uv2') && geom.hasAttribute('uv')) {
            geom.setAttribute('uv2', geom.getAttribute('uv').clone());
        }
        return {
            geometry: geom,
            material: materials[i],
            distance: DISTANCE_MULTIPLIERS[i],
        };
    });

    log.debug(`Cached LOD for model "${modelId}": ${tiers.map((t, i) => `LOD${TIER_SUFFIXES[i]} ${t.geometry.getAttribute('position').count}v`).join(', ')}`);

    return { tiers, gmax, gcenter };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Sample average color from an image element. */
function sampleAverageColor(image: HTMLImageElement | ImageBitmap): number {
    try {
        const canvas = document.createElement('canvas');
        canvas.width = 4;
        canvas.height = 4;
        const ctx = canvas.getContext('2d');
        if (!ctx) return 0x666666;
        ctx.drawImage(image, 0, 0, 4, 4);
        const data = ctx.getImageData(0, 0, 4, 4).data;
        let r = 0, g = 0, b = 0;
        const n = data.length / 4;
        for (let i = 0; i < data.length; i += 4) {
            r += data[i]; g += data[i + 1]; b += data[i + 2];
        }
        r = Math.round(r / n);
        g = Math.round(g / n);
        b = Math.round(b / n);
        return (r << 16) | (g << 8) | b;
    } catch {
        return 0x666666;
    }
}
