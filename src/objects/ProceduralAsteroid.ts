import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { TextureLoader, Group, Box3 } from 'three';

// @ts-ignore
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

export class ProceduralAsteroid {
    private mesh!: THREE.Mesh;
    private body!: CANNON.Body;
    private scene: THREE.Scene;
    private world: CANNON.World;
    private static fbxLoader = new FBXLoader();
    private static textureLoader = new TextureLoader();
    private desiredSize: number;

    constructor(scene: THREE.Scene, world: CANNON.World, position: THREE.Vector3, desiredSize: number = 20, isChild: boolean = false, mainIndex: number = 0) {
        this.scene = scene;
        this.world = world;
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

        console.log(`Loading asteroid ${asteroidType} at position:`, position.toArray());
        
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

                    // Create physics shape from the scaled geometry
                    const vertices = scaledGeometry.attributes.position.array;
                    
                    // Create a simplified convex hull using fewer points
                    const simplifiedPoints: CANNON.Vec3[] = [];
                    const stride = Math.floor(vertices.length / (3 * 100)); // Use ~100 points for the hull
                    for (let i = 0; i < vertices.length; i += 3 * stride) {
                        simplifiedPoints.push(new CANNON.Vec3(
                            vertices[i],
                            vertices[i + 1],
                            vertices[i + 2]
                        ));
                    }

                    // Create a simple sphere shape as fallback if convex hull fails
                    const boundingSphere = new THREE.Sphere();
                    scaledGeometry.computeBoundingSphere();
                    const radius = scaledGeometry.boundingSphere?.radius || this.desiredSize / 2;
                    
                    let physicsShape: CANNON.Shape;
                    try {
                        // Try to create convex hull with simplified points
                        physicsShape = new CANNON.ConvexPolyhedron({
                            vertices: simplifiedPoints,
                            faces: [] // Let Cannon.js generate the faces
                        });
                        console.log('Created convex hull physics shape with', simplifiedPoints.length, 'vertices');
                    } catch (e) {
                        console.warn('Failed to create convex hull, falling back to sphere:', e);
                        physicsShape = new CANNON.Sphere(radius);
                    }

                    // Calculate volume and mass based on size
                    const volume = (4/3) * Math.PI * Math.pow(radius, 3);
                    const density = 2500;  // kg/m³
                    const mass = volume * density;
                    
                    console.log(`Asteroid ${asteroidType} - Radius: ${radius}m, Mass: ${mass.toExponential(2)} kg`);

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
                            console.log(`Color map not found for ${asteroidType}`);
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
                                console.log(`Failed to load normal map: ${path}`);
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
                            console.log(`Roughness map not found for ${asteroidType}`);
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
                                console.log(`Failed to load AO map: ${path}`);
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
                        console.log(`Added asteroid ${asteroidType} to scene at position:`, this.mesh.position.toArray());

                        // Create physics body only after mesh is added and positioned
                        setTimeout(() => {
                            // Create the physics body with calculated mass
                            this.body = new CANNON.Body({
                                mass: mass,
                                position: new CANNON.Vec3(
                                    this.mesh.position.x,
                                    this.mesh.position.y,
                                    this.mesh.position.z
                                ),
                                shape: physicsShape,
                                material: new CANNON.Material({
                                    friction: 0.3,
                                    restitution: 0.1  // Lower restitution for less bouncy collisions
                                }),
                                type: CANNON.Body.DYNAMIC,
                                allowSleep: true,
                                fixedRotation: false,
                                linearDamping: 0.2,  // Increased damping for more stability
                                angularDamping: 0.2,
                                collisionResponse: true
                            });

                            // Ensure body starts sleeping and stationary
                            this.body.sleep();
                            this.body.velocity.setZero();
                            this.body.angularVelocity.setZero();
                            this.body.force.setZero();
                            this.body.torque.setZero();

                            // Set collision filters
                            this.body.collisionFilterGroup = 2;  // Asteroid group
                            this.body.collisionFilterMask = -1;  // Collide with everything

                            // Store reference to physics body
                            this.mesh.userData.body = this.body;

                            // Add body to world in sleeping state
                            this.world.addBody(this.body);
                            
                            console.log('Created physics body for asteroid at position:', 
                                this.body.position,
                                'Mesh position:', this.mesh.position);

                            // Wake up after a longer delay and with collision response temporarily disabled
                            setTimeout(() => {
                                if (this.body) {
                                    // Temporarily disable collision response
                                    this.body.collisionResponse = false;
                                    this.body.wakeUp();
                                    
                                    // Enable collision response after physics stabilizes
                                    setTimeout(() => {
                                        if (this.body) {
                                            this.body.collisionResponse = true;
                                            console.log('Enabled collision response for asteroid');
                                        }
                                    }, 1000);
                                }
                            }, 2000);
                        }, 1000);
                    });
                }
            }
        );
    }

    public update(): void {
        if (this.mesh && this.body) {
            this.mesh.position.copy(this.body.position as unknown as THREE.Vector3);
            this.mesh.quaternion.copy(this.body.quaternion as unknown as THREE.Quaternion);
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
        if (this.body) {
            this.world.removeBody(this.body);
        }
    }

    public static createAsteroidField(scene: THREE.Scene, world: CANNON.World): ProceduralAsteroid[] {
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

    // Add getter for physics body
    public getBody(): CANNON.Body {
        return this.body;
    }
} 