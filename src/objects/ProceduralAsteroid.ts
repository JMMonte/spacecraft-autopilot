import * as THREE from 'three';
// Uses physics engine for colliders
import { TextureLoader, Group, Box3, BufferGeometry } from 'three';
import type { PhysicsEngine, RigidBody } from '../physics';
// @ts-ignore
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';

// @ts-ignore
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { createLogger } from '../utils/logger';

export class ProceduralAsteroid {
    private log = createLogger('objects:ProceduralAsteroid');
    private mesh!: THREE.Mesh;
    // Engine rigid body (Rapier) used for collisions
    private rigid?: RigidBody;
    private scene: THREE.Scene;
    // No direct physics world reference
    private physics?: PhysicsEngine;
    private static fbxLoader = new FBXLoader();
    private static textureLoader = new TextureLoader();
    private desiredSize: number;

    constructor(scene: THREE.Scene, _world: unknown, position: THREE.Vector3, desiredSize: number = 20, isChild: boolean = false, mainIndex: number = 0, physics?: PhysicsEngine) {
        this.scene = scene;
        // world unused; physics engine manages colliders
        this.physics = physics;
        this.desiredSize = isChild ? desiredSize * 0.6 : 500;  // Main asteroids 500 units
        
        // If this is the main asteroid (not a child), position it in a specific pattern around origin
        if (!isChild) {
            const distance = 400; // Distance from origin
            switch(mainIndex) {
                case 0: // Front-Right
                    position.set(distance * 0.7, 0, distance * 0.7);
                    break;
                case 1: // Right
                    position.set(distance, 0, 0);
                    break;
                case 2: // Left
                    position.set(-distance, 0, 0);
                    break;
                case 3: // Front-Left
                    position.set(-distance * 0.7, 0, distance * 0.7);
                    break;
                case 4: // Back-Right
                    position.set(distance * 0.5, 0, -distance);
                    break;
                case 5: // Back-Left
                    position.set(-distance * 0.5, 0, -distance);
                    break;
            }
            
            // Add slight random variation
            position.x += (Math.random() - 0.5) * 20;
            position.y += (Math.random() - 0.5) * 20;
            position.z += (Math.random() - 0.5) * 20;
        }
        
        // Assign specific asteroid type based on index
        let asteroidType: string;
        if (!isChild) {
            switch(mainIndex) {
                case 0: // Main asteroid behind
                    asteroidType = '2b';  // Largest, most detailed model
                    break;
                case 1: // Right
                    asteroidType = '2a';
                    break;
                case 2: // Left
                    asteroidType = '1e';
                    break;
                case 3: // Back
                    asteroidType = '1a';
                    break;
                default:
                    asteroidType = '2b';
            }
        } else {
            // For child asteroids, use a smaller model
            asteroidType = '1a';
        }

        this.log.debug(`Loading asteroid ${asteroidType} at position:`, position.toArray());
        
        // Load the high-res model
        ProceduralAsteroid.fbxLoader.load(
            `/Asteroid_${asteroidType}_FBX/Asteroid_${asteroidType}.fbx`,
            (object: Group) => {
                // First, center the object's geometry
                const bbox = new Box3().setFromObject(object);
                const center = bbox.getCenter(new THREE.Vector3());
                object.position.sub(center);

                // Calculate the current size
                bbox.setFromObject(object);
                const size = new THREE.Vector3();
                bbox.getSize(size);
                const maxDimension = Math.max(size.x, size.y, size.z);
                
                // Scale up by 100x to match our desired units
                const baseScale = 100 / maxDimension;
                // Then apply desired size (now in correct units)
                const finalScale = baseScale * this.desiredSize;

                // Set up the mesh and material
                if (object.children[0] instanceof THREE.Mesh) {
                    const baseMesh = object.children[0] as THREE.Mesh;
                    
                    // Clone and scale the geometry first
                    const scaledGeometry = baseMesh.geometry.clone();
                    scaledGeometry.scale(finalScale, finalScale, finalScale);
                    
                    // Verify geometry has position attribute
                    if (!scaledGeometry.attributes.position) {
                        console.error('Geometry missing position attribute');
                        return;
                    }

                    // Build a convex hull geometry from the mesh points (robust and stable)
                    const hullPoints: THREE.Vector3[] = [];
                    const posAttr = scaledGeometry.getAttribute('position');
                    const totalVerts = posAttr.count;
                    // Sample up to ~300 points evenly to keep hull reasonable
                    const targetPoints = 300;
                    const step = Math.max(1, Math.floor(totalVerts / targetPoints));
                    for (let i = 0; i < totalVerts; i += step) {
                        hullPoints.push(new THREE.Vector3(
                            posAttr.getX(i),
                            posAttr.getY(i),
                            posAttr.getZ(i)
                        ));
                    }

                    const convexGeom: BufferGeometry = new ConvexGeometry(hullPoints);
                    convexGeom.computeVertexNormals();

                    // Build ConvexPolyhedron from convex hull geometry (works well with all narrowphases)
                    const geomPos = convexGeom.getAttribute('position');
                    const geomIndex = convexGeom.getIndex();
                    if (!geomIndex) convexGeom.setIndex([...Array(geomPos.count).keys()]);
                    const idxAttr = convexGeom.getIndex()!;

                    // Map unique vertices from indexed geometry
                    const uniqueMap = new Map<number, number>();
                    const hullVertices: any[] = [];
                    for (let i = 0; i < geomPos.count; i++) {
                        const v = { x: geomPos.getX(i), y: geomPos.getY(i), z: geomPos.getZ(i) } as any;
                        uniqueMap.set(i, hullVertices.push(v) - 1);
                    }
                    // Triangular faces from indices (triples)
                    const faces: number[][] = [];
                    for (let i = 0; i < idxAttr.count; i += 3) {
                        const a = idxAttr.getX(i);
                        const b = idxAttr.getX(i + 1);
                        const c = idxAttr.getX(i + 2);
                        faces.push([uniqueMap.get(a)!, uniqueMap.get(b)!, uniqueMap.get(c)!]);
                    }

                    // convex hull retained only as reference for non-trimesh paths (disabled)

                    // Use static body for large asteroids (more stable collisions)
                    convexGeom.computeBoundingSphere();
                    const radius = convexGeom.boundingSphere?.radius || this.desiredSize / 2;
                    // static collider (mass unused under engine path)
                    this.log.debug(`Asteroid ${asteroidType} - Convex hull radius ~ ${radius.toFixed(2)}, using STATIC body`);

                    // Create our mesh using the scaled geometry
                    const baseTexturePath = `/Asteroid_${asteroidType}_FBX/2K/Asteroid${asteroidType}`;
                    
                    // Create base material first
                    const loadTextures = async () => {
                        const textures: {
                            color?: THREE.Texture;
                            normal?: THREE.Texture;
                            roughness?: THREE.Texture;
                            ao?: THREE.Texture;
                        } = {};

                        // Load color map
                        try {
                            textures.color = await new Promise((resolve, reject) => {
                                ProceduralAsteroid.textureLoader.load(
                                    `${baseTexturePath}_Color_2K.png`,
                                    (texture: THREE.Texture) => {
                                        texture.colorSpace = THREE.SRGBColorSpace;
                                        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
                                        resolve(texture);
                                    },
                                    undefined,
                                    reject
                                );
                            });
                        } catch (e) {
                            this.log.debug(`Color map not found for ${asteroidType}`);
                        }

                        // Load normal map
                        let normalMapPaths: string[];
                        if (asteroidType.startsWith('2')) {
                            normalMapPaths = [`${baseTexturePath}_NormalGL_2K.png`];
                        } else if (asteroidType === '1e') {
                            normalMapPaths = [`${baseTexturePath}_NormalOpenGL_2K.png`];
                        } else {
                            normalMapPaths = [`${baseTexturePath}_Normal_OpenGL_2K.png`];
                        }

                        for (const path of normalMapPaths) {
                            try {
                                textures.normal = await new Promise((resolve, reject) => {
                                    ProceduralAsteroid.textureLoader.load(
                                        path,
                                        (texture: THREE.Texture) => {
                                            texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
                                            texture.colorSpace = THREE.NoColorSpace;
                                            texture.generateMipmaps = true;
                                            resolve(texture);
                                        },
                                        undefined,
                                        reject
                                    );
                                });
                                break;
                            } catch (e) {
                                this.log.debug(`Failed to load normal map: ${path}`);
                            }
                        }

                        // Load roughness map
                        try {
                            textures.roughness = await new Promise((resolve, reject) => {
                                ProceduralAsteroid.textureLoader.load(
                                    `${baseTexturePath}_Roughness_2K.png`,
                                    (texture: THREE.Texture) => {
                                        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
                                        resolve(texture);
                                    },
                                    undefined,
                                    reject
                                );
                            });
                        } catch (e) {
                            this.log.debug(`Roughness map not found for ${asteroidType}`);
                        }

                        // Load AO map
                        const aoMapPaths = [
                            `${baseTexturePath}_AORM_2K.png`,
                            `${baseTexturePath}_Mixed_AO_2K.png`
                        ];

                        for (const path of aoMapPaths) {
                            try {
                                textures.ao = await new Promise((resolve, reject) => {
                                    ProceduralAsteroid.textureLoader.load(
                                        path,
                                        (texture: THREE.Texture) => {
                                            texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
                                            resolve(texture);
                                        },
                                        undefined,
                                        reject
                                    );
                                });
                                break;
                            } catch (e) {
                                this.log.debug(`Failed to load AO map: ${path}`);
                            }
                        }

                        return textures;
                    };

                    // Load all textures then create material
                    loadTextures().then(textures => {
                        const material = new THREE.MeshPhysicalMaterial({
                            color: 0x666666,
                            roughness: 0.8,
                            metalness: 0.1,
                            envMapIntensity: 1.0,
                            normalScale: new THREE.Vector2(1, 1),
                            aoMapIntensity: 1.0,
                            map: textures.color?.clone(),
                            normalMap: textures.normal?.clone(),
                            roughnessMap: textures.roughness?.clone(),
                            aoMap: textures.ao?.clone(),
                            side: THREE.FrontSide,
                            flatShading: false,
                            normalMapType: THREE.TangentSpaceNormalMap
                        });

                        // Ensure geometry has UV2 coordinates for AO map
                        if (!scaledGeometry.hasAttribute('uv2') && scaledGeometry.hasAttribute('uv')) {
                            scaledGeometry.setAttribute('uv2', scaledGeometry.getAttribute('uv').clone());
                        }

                        // Ensure proper normal computation
                        if (!scaledGeometry.hasAttribute('normal')) {
                            scaledGeometry.computeVertexNormals();
                        }

                        // Compute tangents if we have the required attributes
                        if (scaledGeometry.hasAttribute('position') &&
                            scaledGeometry.hasAttribute('normal') &&
                            scaledGeometry.hasAttribute('uv') &&
                            scaledGeometry.index) {
                            scaledGeometry.computeTangents();
                        }

                        this.mesh = new THREE.Mesh(scaledGeometry, material);
                        this.mesh.position.copy(position);
                        this.mesh.castShadow = true;
                        this.mesh.receiveShadow = true;
                        this.mesh.userData.isAsteroid = true;
                        
                        scene.add(this.mesh);
                        this.log.debug(`Added asteroid ${asteroidType} to scene at position:`, this.mesh.position.toArray());

                        // Create physics body only after mesh is added and positioned
                        setTimeout(() => {
                            try {
                                const geom = scaledGeometry;
                                const posAttr = geom.getAttribute('position');
                                const vertices: number[] = [];
                                for (let i = 0; i < posAttr.count; i++) {
                                    vertices.push(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
                                }
                                let indices: number[] = [];
                                const idx = geom.getIndex();
                                if (idx) {
                                    indices = Array.from(idx.array as any);
                                } else {
                                    for (let i = 0; i < posAttr.count; i++) indices.push(i);
                                }

                                if (this.physics) {
                                    // Create fixed trimesh collider via physics engine (Rapier path)
                                    this.rigid = this.physics.createTrimeshBody(vertices, indices, true, {
                                        x: this.mesh.position.x,
                                        y: this.mesh.position.y,
                                        z: this.mesh.position.z,
                                    });
                                    this.log.debug('Created Rapier trimesh collider for asteroid');
                                }
                            } catch (e) {
                                this.log.error('Error creating asteroid physics:', e);
                            }
                        }, 1000);
                    });
                }
            }
        );
    }

    public update(): void {
        if (!this.mesh) return;
        if (this.rigid) {
            const p = this.rigid.getPosition();
            const q = this.rigid.getQuaternion();
            this.mesh.position.set(p.x, p.y, p.z);
            this.mesh.quaternion.set(q.x, q.y, q.z, q.w);
        }
    }

    public dispose(): void {
        if (this.mesh) {
            if (this.mesh.geometry) {
                this.mesh.geometry.dispose();
            }
            if (this.mesh.material instanceof THREE.Material) {
                this.mesh.material.dispose();
            } else if (Array.isArray(this.mesh.material)) {
                this.mesh.material.forEach(material => material.dispose());
            }
            this.scene.remove(this.mesh);
        }
    }

    public static createAsteroidField(scene: THREE.Scene, world: unknown): ProceduralAsteroid[] {
        const asteroids: ProceduralAsteroid[] = [];
        
        // Create 6 main asteroids
        for (let i = 0; i < 6; i++) {
            const asteroid = new ProceduralAsteroid(
                scene,
                world,
                new THREE.Vector3(),
                500,
                false,
                i
            );
            asteroids.push(asteroid);
        }
        
        return asteroids;
    }

    // No direct physics body exposure
}
