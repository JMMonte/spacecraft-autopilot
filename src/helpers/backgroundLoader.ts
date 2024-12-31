import * as THREE from 'three';

interface Star {
    RA: string;
    DEC: string;
    MAG: string;
}

const RADIUS = 5e5;
const STAR_SCALE = RADIUS * 0.12e-5;

function convertToCartesian(ra: number, dec: number, radius = RADIUS): THREE.Vector3 {
    const raRad = THREE.MathUtils.degToRad(ra * 15);
    const decRad = THREE.MathUtils.degToRad(dec);
    const x = radius * Math.cos(decRad) * Math.cos(raRad);
    const y = radius * Math.cos(decRad) * Math.sin(raRad);
    const z = radius * Math.sin(decRad);
    return new THREE.Vector3(x, y, z);
}

function magnitudeToSize(mag: string): number {
    return Math.max(0.01, 8.0 - parseFloat(mag));
}

const vertexShader = `
    attribute float size;
    varying float vSize;
    void main() {
        vSize = size;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size;
        gl_Position = projectionMatrix * mvPosition;
    }
`;

const fragmentShader = `
    varying float vSize;
    void main() {
        vec2 coord = gl_PointCoord - vec2(0.5);
        float distance = length(coord);
        if (distance > 0.5) {
            discard;
        }
        gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0 - distance * 2.0);
    }
`;

export class BackgroundLoader {
    private scene: THREE.Scene;
    private camera: THREE.Camera;
    private stars: THREE.Points | null = null;
    private starGeometry: THREE.BufferGeometry | null = null;
    private onLoadComplete?: () => void;
    private initialPositions: Float32Array | null = null;

    constructor(scene: THREE.Scene, camera: THREE.Camera, onLoadComplete?: () => void) {
        this.scene = scene;
        this.camera = camera;
        this.onLoadComplete = onLoadComplete;
        this.loadStarData();
    }

    private async loadStarData(): Promise<void> {
        try {
            const response = await fetch('/BSC.json');
            const starData = await response.json() as Star[];
            this.initStars(starData);
        } catch (error) {
            console.error('Error loading star data:', error);
        }
    }

    private initStars(starData: Star[]): void {
        try {
            const starPositions: number[] = [];
            const starSizes: number[] = [];

            // Process star data
            starData.forEach(star => {
                const raParts = star.RA.split(':').map(Number);
                const decParts = star.DEC.split(':').map(Number);

                const ra = raParts[0] + raParts[1] / 60 + raParts[2] / 3600;
                const dec = Math.sign(decParts[0]) * (Math.abs(decParts[0]) + decParts[1] / 60 + decParts[2] / 3600);

                const position = convertToCartesian(ra, dec);
                starPositions.push(position.x, position.y, position.z);

                const size = magnitudeToSize(star.MAG);
                starSizes.push(size * STAR_SCALE);
            });

            // Store initial positions
            this.initialPositions = new Float32Array(starPositions);

            // Create geometry and set attributes
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
            geometry.setAttribute('size', new THREE.Float32BufferAttribute(starSizes, 1));

            // Create material with blending for better star appearance
            const starMaterial = new THREE.ShaderMaterial({
                uniforms: {},
                vertexShader,
                fragmentShader,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending
            });

            // Create and add stars
            const stars = new THREE.Points(geometry, starMaterial);
            stars.renderOrder = -1;
            
            // Only after everything is created, assign to class properties
            this.starGeometry = geometry;
            this.stars = stars;
            this.scene.add(this.stars);

            // Start the update loop
            requestAnimationFrame(this.updateStarPositions);
            
            this.onLoadComplete?.();
        } catch (error) {
            console.error('Error initializing stars:', error);
        }
    }

    private updateStarPositions = (): void => {
        if (!this.stars || !this.starGeometry || !this.initialPositions) {
            return;
        }

        try {
            const positionAttribute = this.starGeometry.attributes.position;
            if (!positionAttribute || !positionAttribute.array) {
                console.error('Position attribute or array is undefined');
                return;
            }

            const positions = positionAttribute.array as Float32Array;
            const cameraPosition = new THREE.Vector3().setFromMatrixPosition(this.camera.matrixWorld);

            // Update positions relative to camera
            for (let i = 0; i < this.initialPositions.length; i += 3) {
                positions[i] = this.initialPositions[i] + cameraPosition.x;
                positions[i + 1] = this.initialPositions[i + 1] + cameraPosition.y;
                positions[i + 2] = this.initialPositions[i + 2] + cameraPosition.z;
            }

            positionAttribute.needsUpdate = true;
            requestAnimationFrame(this.updateStarPositions);
        } catch (error) {
            console.error('Error updating star positions:', error);
        }
    };

    public dispose(): void {
        if (this.stars) {
            cancelAnimationFrame(this.updateStarPositions as unknown as number);
            
            this.scene.remove(this.stars);
            this.starGeometry?.dispose();
            (this.stars.material as THREE.Material).dispose();
            this.stars = null;
            this.starGeometry = null;
            this.initialPositions = null;
        }
    }
} 