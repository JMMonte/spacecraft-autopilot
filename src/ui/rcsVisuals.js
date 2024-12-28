import * as THREE from 'three';
import * as CANNON from 'cannon-es';

// Thruster class representing a single thruster
class Thruster {
    constructor(cone, body, positionRelativeToParent) {
        this.cone = cone;
        this.body = body;
        this.position = new CANNON.Vec3(...positionRelativeToParent);
    }

    // Method to point the thruster cone towards a target position
    pointCone(targetPosition) {
        this.cone.lookAt(targetPosition);
    }

    // Method to apply force to the thruster body
    applyForce(magnitude) {
        const forceDirection = new THREE.Vector3(0, 1, 0);
        forceDirection.applyQuaternion(this.cone.quaternion).normalize();
        const force = forceDirection.multiplyScalar(-magnitude).toArray();
        const cannonForce = new CANNON.Vec3(force[0], force[1], force[2]);
        this.body.applyLocalForce(cannonForce, this.position);
    }
}

// Class to define the geometry of the thruster
class ThrusterGeometry {
    constructor(coneRadius, coneHeight) {
        this.coneGeometry = new THREE.ConeGeometry(coneRadius, coneHeight, 32);
        this.coneGeometry.translate(0, coneHeight / 2, 0);
        this.nozzleConeGeometry = new THREE.ConeGeometry(coneRadius, coneHeight, 32, 1, true);
    }
}

// Class to define the materials of the thruster
class ThrusterMaterials {
    constructor(gradientLines = 12, targetColor = { r: 255, g: 255, b: 0 }) {
        this.nozzleConeMaterial = new THREE.MeshPhysicalMaterial({
            color: 'grey',
            metalness: 1.0,
            roughness: 0.5,
            side: THREE.DoubleSide
        });

        const colorsArray = new Uint8Array(gradientLines * 4); // 4 values per color (RGBA)

        for (let i = 0; i < gradientLines; i++) {
            const scale = Math.log(i + 1) / Math.log(gradientLines); // Logarithmic scale
            // Interpolate color based on the logarithmic scale
            const r = Math.round(255 + (targetColor.r - 255) * scale);
            const g = Math.round(255 + (targetColor.g - 255) * scale);
            const b = Math.round(255 + (targetColor.b - 255) * scale);
            const alpha = Math.round(255 * (1 - i / (gradientLines - 1))); // Gradually decrease alpha
            colorsArray.set([r, g, b, alpha], i * 4);
        }

        const gradientTexture = new THREE.DataTexture(
            colorsArray,
            1, // Width of the texture (1 pixel wide)
            gradientLines, // Height of the texture (number of gradient lines)
            THREE.RGBAFormat
        );
        gradientTexture.needsUpdate = true;

        this.exhaustConeMaterial = new THREE.MeshBasicMaterial({
            map: gradientTexture,
            transparent: true
        });
    }
}


// Main class responsible for rendering and managing the thrusters
class RCSVisuals {
    constructor(objects, body, world, scene) {
        this.world = world;
        this.scene = scene;
        this.boxWidth = objects.boxWidth;
        this.boxHeight = objects.boxHeight;
        this.boxDepth = objects.boxDepth;
        this.spacecraftBody = body;
        this.nozzleDensity = 2700;
        this.podDensity = 2700;
        this.coneRadius = 0.1;
        this.coneHeight = 0.5;
        this.cones = [];
        this.coneMeshes = [];
        this.thrusterVisibility = new Array(24).fill(false); // Initialize visibility array with false
        this.nozzleBodies = [];
        this.podBodies = [];

        this.thrusterGeometry = new ThrusterGeometry(this.coneRadius, this.coneHeight);
        this.thrusterMaterials = new ThrusterMaterials();

        this.createThrusters(objects);
        this.setThrusterPositions();
    }

    // Method to calculate the mass of a single nozzle
    calculateNozzleMass() {
        const nozzleVolume = Math.PI * this.coneRadius * this.coneRadius * this.coneHeight / 3;
        return nozzleVolume * this.nozzleDensity;
    }

    // Method to create and position the thrusters, including labels and lines
    createThrusters(objects) {
        const thrustersData = this.getThrustersData();
        this.nozzleMass = this.calculateNozzleMass();
    
        thrustersData.forEach((thrusterData, index) => {
            this.createThrusterGroup(index, thrusterData.position, thrusterData.rotation, objects);
        });
    }

    createThrusterGroup(index, position, rotation, objects) {
        let currentAxis, currentAngle;
    
        currentAxis = rotation.axis;
        currentAngle = rotation.angle;
    
        const thrusterGroup = new THREE.Group();
        const exhaustCone = new THREE.Mesh(this.thrusterGeometry.coneGeometry, this.thrusterMaterials.exhaustConeMaterial);
        const nozzleCone = new THREE.Mesh(this.thrusterGeometry.nozzleConeGeometry, this.thrusterMaterials.nozzleConeMaterial);
    
        nozzleCone.rotateX(Math.PI);
        nozzleCone.position.y = -this.coneHeight / 2;
        nozzleCone.castShadow = true;
        nozzleCone.receiveShadow = true;
    
        const thruster = new Thruster(thrusterGroup, this.spacecraftBody, position);
        thrusterGroup.setRotationFromAxisAngle(currentAxis, currentAngle);
    
        thrusterGroup.add(exhaustCone);
        thrusterGroup.add(nozzleCone);
        objects.box.add(thrusterGroup); // <-- The cone meshes are added here without setting their visibility
    
        this.cones[index] = thruster;
        this.coneMeshes[index] = exhaustCone;
    
        return thrusterGroup;
    }

    createLabel(index, position, labelUtils, colors, clusterNames, positionNames, labelRadius) {
        const clusterIndex = Math.floor(index / 4);
        const positionIndex = index % 2;
        const color = colors[clusterIndex % colors.length];
        const angleIncrement = 360 / this.cones.length;
        const labelAngle = index * angleIncrement;
        const labelPosition = labelUtils.polarToCartesian(position[0], position[2], labelRadius, labelAngle);
        const thrusterName = `${clusterNames[clusterIndex]}${positionNames[positionIndex]}Thruster${index % 4 < 2 ? 'A' : 'B'}`;
        const label = labelUtils.createTextLabel(`Thruster ${index + 1}`, 10, '#ffffff', color, 0.005);

        label.position.set(labelPosition.x, position[1] + 0.2, labelPosition.y);
        label.name = thrusterName;

        return label;
    }

    createLine(position, labelPosition, labelUtils) {
        return labelUtils.createLine(
            { x: position[0], y: position[1], z: position[2] },
            { x: labelPosition.x, y: labelPosition.y + 0.2, z: labelPosition.z },
            'white',
            2 // Set line width to 2
        );
    }

    // Method to set the positions of the thrusters
    setThrusterPositions() {
        const thrusterPositions = this.getThrustersData().map(thrusterData => thrusterData.position);
        this.cones.forEach((thruster, index) => {
            thruster.cone.position.set(...thrusterPositions[index]);
        });
    }

    getThrustersData() {
        const halfWidth = this.boxWidth / 2;
        const halfHeight = this.boxHeight / 2;
        const halfDepth = this.boxDepth / 2;
        const halfCones = this.coneHeight / 2;
        const xAxis = new THREE.Vector3(1, 0, 0);
        const yAxis = new THREE.Vector3(0, 1, 0);
        const zAxis = new THREE.Vector3(0, 0, 1);
        const halfPi = Math.PI / 2;
    
        const thrustersData = [];
    
        // Front Face
        thrustersData.push(
            { position: [-halfWidth, -halfHeight, -halfDepth - halfCones], rotation: { axis: xAxis, angle: -halfPi } },
            { position: [-halfWidth, halfHeight, -halfDepth - halfCones], rotation: { axis: xAxis, angle: -halfPi } },
            { position: [halfWidth, -halfHeight, -halfDepth - halfCones], rotation: { axis: xAxis, angle: -halfPi } },
            { position: [halfWidth, halfHeight, -halfDepth - halfCones], rotation: { axis: xAxis, angle: -halfPi } }
        );
    
        // Back Face
        thrustersData.push(
            { position: [-halfWidth, -halfHeight, halfDepth + halfCones], rotation: { axis: xAxis, angle: halfPi } },
            { position: [-halfWidth, halfHeight, halfDepth + halfCones], rotation: { axis: xAxis, angle: halfPi } },
            { position: [halfWidth, -halfHeight, halfDepth + halfCones], rotation: { axis: xAxis, angle: halfPi } },
            { position: [halfWidth, halfHeight, halfDepth + halfCones], rotation: { axis: xAxis, angle: halfPi } }
        );
    
        // Top Face
        thrustersData.push(
            { position: [-halfWidth, halfHeight + halfCones, -halfDepth], rotation: { axis: zAxis, angle: 0 } },
            { position: [halfWidth, halfHeight + halfCones, -halfDepth], rotation: { axis: zAxis, angle: 0 } },
            { position: [halfWidth, halfHeight + halfCones, halfDepth], rotation: { axis: zAxis, angle: 0 } },
            { position: [-halfWidth, halfHeight + halfCones, halfDepth], rotation: { axis: zAxis, angle: 0 } }
        );
    
        // Bottom Face
        thrustersData.push(
            { position: [-halfWidth, -halfHeight - halfCones, -halfDepth], rotation: { axis: zAxis, angle: Math.PI } },
            { position: [halfWidth, -halfHeight - halfCones, -halfDepth], rotation: { axis: zAxis, angle: Math.PI } },
            { position: [halfWidth, -halfHeight - halfCones, halfDepth], rotation: { axis: zAxis, angle: Math.PI } },
            { position: [-halfWidth, -halfHeight - halfCones, halfDepth], rotation: { axis: zAxis, angle: Math.PI } }
        );
    
        // Left Face
        thrustersData.push(
            { position: [halfWidth + halfCones, halfHeight, -halfDepth], rotation: { axis: zAxis, angle: -halfPi } },
            { position: [halfWidth + halfCones, -halfHeight, -halfDepth], rotation: { axis: zAxis, angle: -halfPi } },
            { position: [halfWidth + halfCones, halfHeight, halfDepth], rotation: { axis: zAxis, angle: -halfPi } },
            { position: [halfWidth + halfCones, -halfHeight, halfDepth], rotation: { axis: zAxis, angle: -halfPi } }
        );
    
        // Right Face
        thrustersData.push(
            { position: [-halfWidth - halfCones, halfHeight, -halfDepth], rotation: { axis: zAxis, angle: halfPi } },
            { position: [-halfWidth - halfCones, -halfHeight, -halfDepth], rotation: { axis: zAxis, angle: halfPi } },
            { position: [-halfWidth - halfCones, halfHeight, halfDepth], rotation: { axis: zAxis, angle: halfPi } },
            { position: [-halfWidth - halfCones, -halfHeight, halfDepth], rotation: { axis: zAxis, angle: halfPi } }
        );
    
        return thrustersData;
    }

    applyForce(index, magnitude) {
        if (this.cones[index]) {
            this.cones[index].applyForce(magnitude);
            const maxHeight = 1.5;
            const minHeight = 0.01;
            const normalizedMagnitude = Math.min(Math.abs(magnitude) / 100, 1);
            const baseHeight = minHeight + (maxHeight - minHeight) * normalizedMagnitude;
            const randomVariation = 0.2;
            const randomHeight = baseHeight * (1 + (Math.random() * 2 - 1) * randomVariation);
            this.coneMeshes[index].scale.y = randomHeight;
            this.thrusterVisibility[index] = magnitude !== 0; // Update visibility based on applied force
        }
    }

    updateThrusterCones() {
        this.coneMeshes.forEach((coneMesh, index) => {
            coneMesh.visible = this.thrusterVisibility[index];
        });
    }
}

export { RCSVisuals };