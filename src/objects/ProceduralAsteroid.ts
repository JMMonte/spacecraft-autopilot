import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { LoopSubdivision } from 'three-subdivide';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils';

export class ProceduralAsteroid {
    private mesh: THREE.LOD;
    private body: CANNON.Body;
    private material: THREE.ShaderMaterial;
    private scene: THREE.Scene;
    private world: CANNON.World;
    private subdivisionLevels: THREE.Mesh[] = [];
    private camera: THREE.Camera;
    private smallAsteroids: ProceduralAsteroid[] = [];

    constructor(scene: THREE.Scene, world: CANNON.World, position: THREE.Vector3, radius: number = 100, isChild: boolean = false) {
        this.scene = scene;
        this.world = world;
        this.camera = (scene.userData.camera as THREE.Camera);

        // Create a custom shader material with multi-channel noise
        const vertexShader = `
            varying vec3 vNormal;
            varying vec3 vPosition;
            varying vec3 vViewPosition;
            varying vec3 vWorldPosition;
            varying vec3 vWorldNormal;
            
            void main() {
                vNormal = normalize(normalMatrix * normal);
                vPosition = position;
                vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                vWorldPosition = worldPosition.xyz;
                vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                vViewPosition = -mvPosition.xyz;
                gl_Position = projectionMatrix * mvPosition;
            }
        `;

        const fragmentShader = `
            varying vec3 vNormal;
            varying vec3 vPosition;
            varying vec3 vViewPosition;
            varying vec3 vWorldPosition;
            varying vec3 vWorldNormal;

            uniform vec3 directionalLightColor[2];
            uniform vec3 directionalLightDirection[2];
            
            // Improved noise function
            float hash(vec3 p) {
                p = fract(p * vec3(443.8975, 397.2973, 491.1871));
                p += dot(p.zxy, p.yxz + 19.19);
                return fract(p.x * p.y * p.z);
            }

            // Improved value noise
            float noise(vec3 p) {
                vec3 i = floor(p);
                vec3 f = fract(p);
                f = f * f * (3.0 - 2.0 * f); // Smooth interpolation
                
                float a = hash(i);
                float b = hash(i + vec3(1.0, 0.0, 0.0));
                float c = hash(i + vec3(0.0, 1.0, 0.0));
                float d = hash(i + vec3(1.0, 1.0, 0.0));
                float e = hash(i + vec3(0.0, 0.0, 1.0));
                float f1 = hash(i + vec3(1.0, 0.0, 1.0));
                float g = hash(i + vec3(0.0, 1.0, 1.0));
                float h = hash(i + vec3(1.0, 1.0, 1.0));
                
                return mix(
                    mix(mix(a, b, f.x), mix(c, d, f.x), f.y),
                    mix(mix(e, f1, f.x), mix(g, h, f.x), f.y),
                    f.z
                );
            }

            // FBM (Fractal Brownian Motion) for multi-channel noise
            float fbm(vec3 p) {
                float value = 0.0;
                float amplitude = 0.5;
                float frequency = 1.0;
                
                // Add multiple layers of noise
                for(int i = 0; i < 6; i++) {
                    value += amplitude * noise(p * frequency);
                    frequency *= 2.0;
                    amplitude *= 0.5;
                }
                
                return value;
            }

            void main() {
                // Generate different channels of noise
                float largeScale = fbm(vPosition * 0.05);  // Large features
                float mediumScale = fbm(vPosition * 0.2);  // Medium features
                float smallScale = fbm(vPosition * 0.8);   // Small details
                float microScale = fbm(vPosition * 3.0);   // Micro details
                
                // Combine noise channels
                float combinedNoise = 
                    largeScale * 0.5 +
                    mediumScale * 0.3 +
                    smallScale * 0.15 +
                    microScale * 0.05;
                
                // Create color variations
                vec3 darkColor = vec3(0.2, 0.2, 0.2);    // Dark gray
                vec3 lightColor = vec3(0.8, 0.8, 0.8);   // Light gray
                vec3 finalColor = mix(darkColor, lightColor, combinedNoise);
                
                // Add some subtle color variation
                finalColor *= vec3(1.0, 0.98, 0.95);  // Slight warm tint
                
                // Calculate lighting from both directional lights in world space
                vec3 viewDir = normalize(cameraPosition - vWorldPosition);
                
                vec3 totalLight = vec3(0.0);
                float ambient = 0.2;
                
                for(int i = 0; i < 2; i++) {
                    vec3 lightDir = directionalLightDirection[i];
                    float diffuse = max(dot(vWorldNormal, lightDir), 0.0);
                    
                    // Add specular
                    vec3 halfDir = normalize(lightDir + viewDir);
                    float specular = pow(max(dot(vWorldNormal, halfDir), 0.0), 32.0);
                    
                    totalLight += directionalLightColor[i] * (diffuse + specular * 0.3);
                }
                
                // Combine lighting with color
                vec3 finalLighting = totalLight + vec3(ambient);
                gl_FragColor = vec4(finalColor * finalLighting, 1.0);
            }
        `;

        this.material = new THREE.ShaderMaterial({
            uniforms: {
                directionalLightColor: { value: [
                    new THREE.Color(0xffffff),  // Main light
                    new THREE.Color(0x4466ff)   // Secondary blue light
                ]},
                directionalLightDirection: { value: [
                    new THREE.Vector3(-1, 0.5, 1).normalize(),  // Main light direction
                    new THREE.Vector3(1, -0.5, -1).normalize()  // Secondary light direction
                ]}
            },
            vertexShader: vertexShader,
            fragmentShader: fragmentShader,
            side: THREE.FrontSide
        });

        // Create LOD levels
        const lod = new THREE.LOD();
        
        // Generate irregular asteroid geometry for each LOD level
        const generateAsteroidGeometry = (baseRadius: number, detail: number, irregularity: number, subdivisions: number = 0) => {
            // Start with a lower detail base
            const baseGeometry = new THREE.IcosahedronGeometry(baseRadius, detail);
            
            // First apply displacement
            const positions = baseGeometry.attributes.position;
            const normals = baseGeometry.attributes.normal;
            const newPositions = new Float32Array(positions.array.length);
            const newNormals = new Float32Array(normals.array.length);
            
            for (let i = 0; i < positions.count; i++) {
                const x = positions.getX(i);
                const y = positions.getY(i);
                const z = positions.getZ(i);
                
                // Use vertex normal for displacement
                const normalX = normals.getX(i);
                const normalY = normals.getY(i);
                const normalZ = normals.getZ(i);
                
                // Normalize coordinates for noise input
                const length = Math.sqrt(x * x + y * y + z * z);
                const nx = x / length;
                const ny = y / length;
                const nz = z / length;
                
                // Apply displacement with safety checks
                const largeFeatures = Math.max(-1, Math.min(1, 
                    this.noise3D(nx * 0.02, ny * 0.02, nz * 0.02) * 2 - 1 +
                    this.noise3D(nx * 0.01, ny * 0.01, nz * 0.01) * 2 - 1
                )) * irregularity * radius * 0.25;
                
                const mediumFeatures = Math.max(-1, Math.min(1,
                    this.noise3D(nx * 0.04, ny * 0.04, nz * 0.04) * 2 - 1 +
                    this.noise3D(nx * 0.03, ny * 0.03, nz * 0.03) * 2 - 1
                )) * irregularity * radius * 0.125;
                
                const smallFeatures = Math.max(-1, Math.min(1,
                    this.noise3D(nx * 0.2, ny * 0.2, nz * 0.2) * 2 - 1 +
                    this.noise3D(nx * 0.1, ny * 0.1, nz * 0.1) * 2 - 1
                )) * irregularity * radius * 0.04;
                
                const totalDisplacement = largeFeatures + mediumFeatures + smallFeatures;
                
                // Apply displacement with safety check
                const idx = i * 3;
                newPositions[idx] = x + normalX * totalDisplacement;
                newPositions[idx + 1] = y + normalY * totalDisplacement;
                newPositions[idx + 2] = z + normalZ * totalDisplacement;
                
                // Ensure normals are normalized
                const normalLength = Math.sqrt(normalX * normalX + normalY * normalY + normalZ * normalZ);
                newNormals[idx] = normalX / normalLength;
                newNormals[idx + 1] = normalY / normalLength;
                newNormals[idx + 2] = normalZ / normalLength;
            }
            
            // Create geometry with displaced positions
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(newPositions, 3));
            geometry.setAttribute('normal', new THREE.BufferAttribute(newNormals, 3));
            geometry.setIndex(baseGeometry.getIndex());
            
            // Merge vertices to ensure proper normal sharing
            let processedGeometry = mergeVertices(geometry, 0.0001);  // Reduced tolerance for more precise merging
            processedGeometry.computeVertexNormals();
            
            // Then apply subdivision
            if (subdivisions > 0) {
                processedGeometry = LoopSubdivision.modify(processedGeometry, subdivisions, {
                    split: false,
                    uvSmooth: true,
                    preserveEdges: false,
                    flatOnly: false,
                    maxTriangles: Infinity,
                    weight: 1.0
                });
                
                // Merge vertices again after subdivision
                processedGeometry = mergeVertices(processedGeometry, 0.0001);
                processedGeometry.computeVertexNormals();
            }
            
            return processedGeometry;
        };
        
        // Ultra-high detail (close range)
        const ultraDetailGeometry = generateAsteroidGeometry(radius, 2, 1.0, 1);
        const ultraDetailMesh = new THREE.Mesh(ultraDetailGeometry, this.material);
        ultraDetailMesh.receiveShadow = true;
        ultraDetailMesh.castShadow = true;
        lod.addLevel(ultraDetailMesh, 0);
        this.subdivisionLevels.push(ultraDetailMesh);

        // High detail
        const highDetailGeometry = generateAsteroidGeometry(radius, 2, 1.0, 0);
        const highDetailMesh = new THREE.Mesh(highDetailGeometry, this.material);
        highDetailMesh.receiveShadow = true;
        highDetailMesh.castShadow = true;
        lod.addLevel(highDetailMesh, radius * 2);
        this.subdivisionLevels.push(highDetailMesh);
        
        // Medium detail
        const mediumDetailGeometry = generateAsteroidGeometry(radius, 1, 0.9, 0);
        const mediumDetailMesh = new THREE.Mesh(mediumDetailGeometry, this.material);
        mediumDetailMesh.receiveShadow = true;
        mediumDetailMesh.castShadow = true;
        lod.addLevel(mediumDetailMesh, radius * 4);
        this.subdivisionLevels.push(mediumDetailMesh);
        
        // Low detail (far range)
        const lowDetailGeometry = generateAsteroidGeometry(radius, 1, 0.8, 0);
        const lowDetailMesh = new THREE.Mesh(lowDetailGeometry, this.material);
        lowDetailMesh.receiveShadow = true;
        lowDetailMesh.castShadow = true;
        lod.addLevel(lowDetailMesh, radius * 8);
        this.subdivisionLevels.push(lowDetailMesh);

        // Position the asteroid
        position.y = isChild ? position.y : -radius * 1.5;  // Only adjust Y for main asteroid
        lod.position.copy(position);
        this.mesh = lod;
        
        // Ensure LOD object itself has shadow properties set
        lod.castShadow = true;
        lod.receiveShadow = true;
        
        // Create physics body with compound shape from geometry
        const createCompoundShape = (geometry: THREE.BufferGeometry): CANNON.Shape => {
            const vertices = geometry.attributes.position.array;
            const indices = geometry.index ? geometry.index.array : null;
            
            if (!indices) {
                // If no indices, create a convex hull from vertices
                const points: CANNON.Vec3[] = [];
                for (let i = 0; i < vertices.length; i += 3) {
                    points.push(new CANNON.Vec3(vertices[i], vertices[i + 1], vertices[i + 2]));
                }
                return new CANNON.ConvexPolyhedron({ vertices: points });
            }
            
            // Create a set of unique vertices
            const uniqueVertices: CANNON.Vec3[] = [];
            const vertexMap = new Map<string, number>();
            
            // Helper to get or add vertex
            const getVertexIndex = (i: number): number => {
                const x = vertices[i];
                const y = vertices[i + 1];
                const z = vertices[i + 2];
                const key = `${x},${y},${z}`;
                
                if (!vertexMap.has(key)) {
                    vertexMap.set(key, uniqueVertices.length);
                    uniqueVertices.push(new CANNON.Vec3(x, y, z));
                }
                
                return vertexMap.get(key)!;
            };
            
            // Create faces using vertex indices
            const faces: number[][] = [];
            for (let i = 0; i < indices.length; i += 3) {
                const i1 = getVertexIndex(indices[i] * 3);
                const i2 = getVertexIndex(indices[i + 1] * 3);
                const i3 = getVertexIndex(indices[i + 2] * 3);
                faces.push([i1, i2, i3]);
            }
            
            return new CANNON.ConvexPolyhedron({
                vertices: uniqueVertices,
                faces: faces
            });
        };

        // Use a simpler geometry for physics to improve performance
        const physicsGeometry = generateAsteroidGeometry(radius, 1, 0.9, 0);
        const shape = createCompoundShape(physicsGeometry);
        
        this.body = new CANNON.Body({
            mass: isChild ? 1 : 0,  // Main asteroid is static, small ones have mass
            position: new CANNON.Vec3(position.x, position.y, position.z),
            shape: shape,
            material: new CANNON.Material({
                friction: 0.5,
                restitution: 0.3
            }),
            collisionResponse: true,
            type: isChild ? CANNON.Body.DYNAMIC : CANNON.Body.STATIC,
            allowSleep: false
        });
        
        // Set collision groups and masks
        this.body.collisionFilterGroup = isChild ? 4 : 2;  // Group 2 for main asteroid, 4 for small ones
        this.body.collisionFilterMask = isChild ? (1 | 2 | 4) : (1 | 4);  // Small asteroids collide with everything, main only with player and small asteroids

        // Add some angular velocity to small asteroids
        if (isChild) {
            this.body.angularVelocity.set(
                (Math.random() - 0.5) * 0.5,
                (Math.random() - 0.5) * 0.5,
                (Math.random() - 0.5) * 0.5
            );
            this.body.angularDamping = 0.1;
            this.body.linearDamping = 0.1;
        }

        scene.add(this.mesh);
        world.addBody(this.body);

        // Generate smaller asteroids around the main one (only for the main asteroid)
        if (!isChild) {
            this.generateSmallAsteroids();
        }

        // Clean up physics geometry
        physicsGeometry.dispose();
    }

    private generateSmallAsteroids(): void {
        const numAsteroids = 5;  // Increased number for better coverage
        const mainRadius = 100;  // Use the same radius as passed to constructor
        const minDistance = mainRadius * 1.2;  // Minimum distance from origin
        const maxDistance = mainRadius * 2.5;  // Maximum distance from origin
        
        for (let i = 0; i < numAsteroids; i++) {
            // Generate random spherical coordinates
            const phi = Math.acos(2 * Math.random() - 1);  // Polar angle (0 to π)
            const theta = 2 * Math.PI * Math.random();     // Azimuthal angle (0 to 2π)
            const distance = minDistance + Math.random() * (maxDistance - minDistance);
            
            // Convert spherical to Cartesian coordinates relative to world origin
            const x = distance * Math.sin(phi) * Math.cos(theta);
            const y = distance * Math.sin(phi) * Math.sin(theta);
            const z = distance * Math.cos(phi);
            
            // Random radius between 5% and 15% of main asteroid
            const smallRadius = mainRadius * (0.05 + Math.random() * 0.1);
            
            // Create small asteroid
            const smallAsteroid = new ProceduralAsteroid(
                this.scene,
                this.world,
                new THREE.Vector3(x, y, z),
                smallRadius,
                true  // Mark as child asteroid
            );
            
            // Ensure shadows are enabled for small asteroids
            smallAsteroid.mesh.castShadow = true;
            smallAsteroid.mesh.receiveShadow = true;
            smallAsteroid.subdivisionLevels.forEach(mesh => {
                mesh.castShadow = true;
                mesh.receiveShadow = true;
            });
            
            this.smallAsteroids.push(smallAsteroid);
        }
    }

    // Enhanced 3D noise implementation
    private noise3D(x: number, y: number, z: number): number {
        // Improved noise with more octaves and better frequency distribution
        const noise = 
            Math.sin(x * 10 + y * 5) * Math.sin(y * 10 + z * 5) * Math.sin(z * 10 + x * 5) +
            

            Math.sin(x * 80 + y * 75) * Math.sin(y * 80 + z * 75) * Math.sin(z * 80 + x * 75) * 0.125;
        return noise * 0.5 + 0.5;
    }

    public update(time: number): void {
        // Update main asteroid
        this.mesh.position.copy(new THREE.Vector3(
            this.body.position.x,
            this.body.position.y,
            this.body.position.z
        ));
        
        this.mesh.quaternion.copy(new THREE.Quaternion(
            this.body.quaternion.x,
            this.body.quaternion.y,
            this.body.quaternion.z,
            this.body.quaternion.w
        ));

        // Update LOD based on camera distance
        if (this.camera) {
            const distance = this.camera.position.distanceTo(this.mesh.position);
            this.mesh.update(this.camera);
        }

        // Update small asteroids
        this.smallAsteroids.forEach(asteroid => asteroid.update(time));
    }

    public dispose(): void {
        this.scene.remove(this.mesh);
        this.world.removeBody(this.body);
        
        // Dispose geometries and materials
        this.subdivisionLevels.forEach(mesh => {
            if (mesh.geometry) {
                mesh.geometry.dispose();
            }
        });
        this.material.dispose();

        // Dispose small asteroids
        this.smallAsteroids.forEach(asteroid => asteroid.dispose());
    }
} 