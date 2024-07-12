import * as THREE from 'three';
import * as CANNON from 'cannon';
import { CONFIG } from './sceneObjConfig';

export class SceneObjects {
    constructor(scene, world) {
        this.scene = scene;
        this.world = world;
        this.boxWidth = CONFIG.boxDimensions.width;
        this.boxHeight = CONFIG.boxDimensions.height;
        this.boxDepth = CONFIG.boxDimensions.depth;
        this.aluminumDensity = CONFIG.materials.aluminumDensity; // kg/m^3
        this.panelThickness = CONFIG.panelThickness;
        this.trussRadius = CONFIG.truss.radius;
        this.trussLength = CONFIG.truss.length;
        this.dockingPortRadius = CONFIG.dockingPort.radius;
        this.dockingPortLength = CONFIG.dockingPort.length;
        this.dockingPortDepth = CONFIG.dockingPort.depth;
        this.numberOfTrusses = CONFIG.truss.numberOfTrusses;
        this.numberOfDockingPorts = CONFIG.dockingPort.numberOfDockingPorts;
        this.carbonFiberDensity = CONFIG.materials.carbonFiberDensity; // kg/m^3
        this.fuelDensity = CONFIG.materials.fuelDensity; // kg/m^3
        this.tankThickness = CONFIG.tank.thickness; // m

        this.rcsVisuals = {
            boxWidth: this.boxWidth,
            boxHeight: this.boxHeight,
            boxDepth: this.boxDepth,
            setThrusterPositions: function () {
                // Example logic for repositioning thrusters
                console.log(`RCS Thrusters repositioned to width: ${this.boxWidth}, height: ${this.boxHeight}, depth: ${this.boxDepth}`);
            }
        };


        this.initMaterials();
        // Create objects
        this.createBox();
        this.addTrussToBox();
        this.updateDockingPorts();
        this.manageFuelTank();
        this.updateEndStructure(this.materials.aluminum, { margin: 0.1, structureDepth: this.dockingPortDepth, endWidth: this.dockingPortRadius, endHeight: this.dockingPortRadius }, 'both');
    }

    initMaterials() {
        this.materials = {};
        for (const [key, properties] of Object.entries(CONFIG.materialProperties)) {
            this.materials[key] = new THREE.MeshPhysicalMaterial(properties);
        }
    }

    createBox() {
        const boxGeometry = new THREE.BoxGeometry(this.boxWidth, this.boxHeight, this.boxDepth);
        const boxMaterials = ['blue', 'gold', 'blue', 'gold', 'transparent', 'transparent'].map(color => this.materials[color]);
        const box = new THREE.Mesh(boxGeometry, boxMaterials);
        box.castShadow = true;
        box.receiveShadow = true;
        this.scene.add(box);
    
        // Create a unique physics body for this box
        const boxMass = this.calculateMass(); // Simplified mass calculation
        const boxShape = new CANNON.Box(new CANNON.Vec3(this.boxWidth / 2, this.boxHeight / 2, this.boxDepth / 2));
        const boxBody = new CANNON.Body({
            mass: boxMass,
            shape: boxShape
        });
        boxBody.linearDamping = 0;
        boxBody.angularDamping = 0;
        boxBody.material = new CANNON.Material();
        boxBody.material.friction = 1.5;
        this.world.addBody(boxBody);

        // Link the Three.js mesh with its Cannon.js physics body
        box.userData.physicsBody = boxBody;
    
        // Optionally, you can also store a reference back to the mesh in the physics body, if needed
        boxBody.mesh = box;
    
        // Keeping track of the box and boxBody for later use
        this.box = box;
        this.boxBody = boxBody;
    }

    calculateMass() {
        return this.calculatePanelMass() + this.calculateTrussMass() + this.calculateDockingPortMass() + this.calculateFuelTankMass(
            Math.max(Math.min(this.boxWidth, this.boxHeight) / 2 - this.trussRadius - 0.01, 0.1),
            Math.max(this.boxDepth - 0.2, 0.1)
        );
    }

    updateBox(width, height, depth) {
        width = Math.max(width, 1);
        height = Math.max(height, 1);
        depth = Math.max(depth, 1.2);

        this.box.geometry = new THREE.BoxGeometry(width, height, depth);
        this.boxWidth = width;
        this.boxHeight = height;
        this.boxDepth = depth;

        // Update rcsVisuals dimensions and reposition thrusters
        this.rcsVisuals.boxWidth = width;
        this.rcsVisuals.boxHeight = height;
        this.rcsVisuals.boxDepth = depth;
        this.rcsVisuals.setThrusterPositions();

        this.removeTrussFromBox();
        this.addTrussToBox();
        this.updateDockingPorts();
        this.manageFuelTank(Math.max(Math.min(width, height) / 2 - this.trussRadius - 0.01, 0.1), Math.max(depth - 0.2, 0.1));
        this.updateEndStructure(this.materials.silver, { margin: 0.1, structureDepth: this.dockingPortDepth, endWidth: this.dockingPortRadius, endHeight: this.dockingPortRadius }, 'both');
        
        if (this.boxBody) {
            this.boxBody.shapes[0].halfExtents.set(width / 2, height / 2, depth / 2);
            this.boxBody.shapes[0].updateConvexPolyhedronRepresentation();
            this.boxBody.updateBoundingRadius();
            let boxMass = this.calculateMass();
            this.boxBody.mass = boxMass;
            this.boxBody.updateMassProperties();
        }
    }

    calculatePanelMass() {
        const sideAreas = 2 * (this.boxHeight * this.boxDepth) + 2 * (this.boxWidth * this.boxDepth);
        const volume = sideAreas * this.panelThickness;
        return this.aluminumDensity * volume;
    }

    calculateTrussMass() {
        const volumePerTruss = Math.PI * Math.pow(this.trussRadius, 2) * this.trussLength;
        const totalVolume = volumePerTruss * this.numberOfTrusses;
        return this.aluminumDensity * totalVolume;
    }

    calculateDockingPortMass() {
        const volumePerPort = Math.PI * Math.pow(this.dockingPortRadius, 2) * this.dockingPortLength;
        const totalVolume = volumePerPort * this.numberOfDockingPorts;
        return this.aluminumDensity * totalVolume;
    }

    // FUEL TANK

    manageFuelTank(radius = null, depth = null) {
        const marginRadius = 1.6;
        if (!radius || !depth) {
            radius = Math.max(Math.min(this.boxWidth, this.boxHeight) / 2 - this.trussRadius - 0.01, 0.1);
            depth = Math.max(this.boxDepth - 0.2, 0.1);
        } else {
            depth = Math.max(depth, 0.9);
            depth = Math.min(depth, this.boxDepth - this.dockingPortDepth);
            const maxRadius = (depth - this.dockingPortDepth) / 2;
            radius = Math.min(radius, maxRadius);
        }

        const effectiveCylinderDepth = depth - radius * marginRadius;
        const isUpdate = !!this.fuelTankVisual;

        if (isUpdate) {
            this.fuelTankVisual.children.forEach(child => {
                child.geometry.dispose();
            });
        } else {
            this.fuelTankVisual = new THREE.Group();
            this.box.add(this.fuelTankVisual);
        }

        const cylinderGeometry = new THREE.CylinderGeometry(radius, radius, effectiveCylinderDepth, 32);
        const sphereGeometry = new THREE.SphereGeometry(radius, 32, 32);

        const cylinder = isUpdate ? this.fuelTankVisual.children[0] : new THREE.Mesh(cylinderGeometry, this.materials.fuelTank);
        const topCap = isUpdate ? this.fuelTankVisual.children[1] : new THREE.Mesh(sphereGeometry, this.materials.fuelTank);
        const bottomCap = isUpdate ? this.fuelTankVisual.children[2] : new THREE.Mesh(sphereGeometry, this.materials.fuelTank);

        if (!isUpdate) {
            this.fuelTankVisual.add(cylinder, topCap, bottomCap);
        } else {
            cylinder.geometry = cylinderGeometry;
            topCap.geometry = sphereGeometry;
            bottomCap.geometry = sphereGeometry;
        }

        const sphereOffset = effectiveCylinderDepth / 2;
        topCap.position.y = sphereOffset;
        bottomCap.position.y = -sphereOffset;

        this.fuelTankVisual.position.copy(this.boxBody.position);
        this.fuelTankVisual.position.set(0, 0, 0);
        this.fuelTankVisual.rotation.x = Math.PI / 2;

        [cylinder, topCap, bottomCap].forEach(mesh => {
            mesh.castShadow = true;
            mesh.receiveShadow = true;
        });

        if (!this.fuelTankVisual) {
            const totalMass = this.calculateFuelTankMass(radius, depth);
            this.boxBody.mass += totalMass;
        }
    }

    calculateFuelTankMass(radius, depth) {
        const cylVolume = Math.PI * Math.pow(radius, 2) * depth;
        const capVolume = (4 / 3) * Math.PI * Math.pow(radius, 3);
        const totalVolume = cylVolume + capVolume;
        const surfaceArea = 2 * Math.PI * radius * depth + 4 * Math.PI * Math.pow(radius, 2);

        const massFuel = this.fuelDensity * totalVolume;
        const massTank = this.carbonFiberDensity * surfaceArea * this.tankThickness;
        return massFuel + massTank;
    }

    updateEndStructure(materialProperties, structureDimensions, placement = 'both') {
        const material = new THREE.MeshPhysicalMaterial(materialProperties);

        const startPoints = this.getStartPoints(structureDimensions.margin);
        const endPoints = this.getEndPoints(startPoints, structureDimensions);

        if (placement === 'both' || placement === 'front') {
            this.addTrusses(startPoints.front, endPoints.front, material);
        }

        if (placement === 'both' || placement === 'back') {
            this.addTrusses(startPoints.back, endPoints.back, material);
        }
    }

    getStartPoints(margin = 0.05) {
        const createFrontStartPoints = (margin) => [
            new THREE.Vector3(-this.boxWidth / 2 + margin, this.boxHeight / 2, this.boxDepth / 2),
            new THREE.Vector3(this.boxWidth / 2 - margin, this.boxHeight / 2, this.boxDepth / 2),
            new THREE.Vector3(-this.boxWidth / 2 + margin, -this.boxHeight / 2, this.boxDepth / 2),
            new THREE.Vector3(this.boxWidth / 2 - margin, -this.boxHeight / 2, this.boxDepth / 2)
        ];

        const frontStartPoints = createFrontStartPoints(margin);
        const backStartPoints = frontStartPoints.map(point => new THREE.Vector3(point.x, point.y, -point.z));

        return { front: frontStartPoints, back: backStartPoints };
    }

    getEndPoints(startPoints, { structureDepth, margin = 0.05 }) {
        const calculateEndPoints = (points, depthAdjustment) => [
            new THREE.Vector3(-this.dockingPortRadius + margin / 2, this.dockingPortRadius - margin / 2, points[0].z + depthAdjustment),
            new THREE.Vector3(this.dockingPortRadius - margin / 2, this.dockingPortRadius - margin / 2, points[1].z + depthAdjustment),
            new THREE.Vector3(-this.dockingPortRadius + margin / 2, -this.dockingPortRadius + margin / 2, points[2].z + depthAdjustment),
            new THREE.Vector3(this.dockingPortRadius - margin / 2, -this.dockingPortRadius + margin / 2, points[3].z + depthAdjustment),
        ];

        return {
            front: calculateEndPoints(startPoints.front, structureDepth),
            back: calculateEndPoints(startPoints.back, -structureDepth)
        };
    }

    addTrussToBox() {
        const material = this.materials.truss;
        
        const vertices = [
            new THREE.Vector3(this.boxWidth / 2, this.boxHeight / 2, this.boxDepth / 2),
            new THREE.Vector3(this.boxWidth / 2, this.boxHeight / 2, -this.boxDepth / 2),
            new THREE.Vector3(this.boxWidth / 2, -this.boxHeight / 2, this.boxDepth / 2),
            new THREE.Vector3(this.boxWidth / 2, -this.boxHeight / 2, -this.boxDepth / 2),
            new THREE.Vector3(-this.boxWidth / 2, this.boxHeight / 2, this.boxDepth / 2),
            new THREE.Vector3(-this.boxWidth / 2, this.boxHeight / 2, -this.boxDepth / 2),
            new THREE.Vector3(-this.boxWidth / 2, -this.boxHeight / 2, this.boxDepth / 2),
            new THREE.Vector3(-this.boxWidth / 2, -this.boxHeight / 2, -this.boxDepth / 2)
        ];
        for (let i = 0; i < vertices.length; i++) {
            for (let j = i + 1; j < vertices.length; j++) {
                this.createBeam(vertices[i], vertices[j], material);
            }
        }
    }

    removeTrussFromBox() {
        const toRemove = this.box.children.filter(child => child.name === "truss");
        toRemove.forEach(obj => this.box.remove(obj));
    }

    addTrusses(startPoints, endPoints, material) {
        for (let i = 0; i < startPoints.length; i++) {
            this.createBeam(startPoints[i], endPoints[i], material);
        }
    }

    removeTrusses(startPoints, endPoints) {
        for (let i = 0; i < startPoints.length; i++) {
            const start = startPoints[i];
            const end = endPoints[i];

            const toRemove = this.box.children.filter(child => child.name === "truss" && child.position.equals(start) && child.getWorldDirection().equals(end));
            toRemove.forEach(obj => this.box.remove(obj));
        }
    }

    createBeam(start, end, material) {
        const midPoint = new THREE.Vector3();
        midPoint.addVectors(start, end).multiplyScalar(0.5);
        const length = start.distanceTo(end);
        const geometry = new THREE.CylinderGeometry(0.05, 0.05, length, 16, 1, false);
        const beam = new THREE.Mesh(geometry, material);
        beam.position.copy(midPoint);
        beam.lookAt(start);
        beam.rotateX(Math.PI / 2);
        beam.name = "truss";
        this.box.add(beam);
        beam.castShadow = true;
        beam.receiveShadow = true;
    }

    // DOCKING PORTS

    addDockingPorts() {
        const material = this.materials.dockingPort;
    
        const portPositions = [
            { name: "dockingPortFront", z: this.boxDepth / 2 + this.dockingPortDepth, angle: 0 }, // Front
            { name: "dockingPortBack", z: -this.boxDepth / 2 - this.dockingPortDepth, angle: Math.PI } // Back
        ];
    
        portPositions.forEach(({ name, z, angle }) => {
            const cylinderGeometry = new THREE.CylinderGeometry(this.dockingPortRadius, this.dockingPortRadius, this.dockingPortLength, 32);
            const cylinder = new THREE.Mesh(cylinderGeometry, material);
            cylinder.name = name;
            cylinder.rotation.x = Math.PI / 2;
            cylinder.position.z = z;
            this.box.add(cylinder);
    
            const torusGeometry = new THREE.TorusGeometry(this.dockingPortRadius, 0.05, 16, 100);
            const torus = new THREE.Mesh(torusGeometry, material);
            torus.name = `${name}Ring`;
            torus.rotation.y = angle;
            torus.position.z = z;
            this.box.add(torus);
    
            const shape = new CANNON.Cylinder(this.dockingPortRadius, this.dockingPortRadius, this.dockingPortLength, 32);
            shape.mass = 0;
            const quaternion = new CANNON.Quaternion();
            quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), Math.PI / 2);
            this.boxBody.addShape(shape, new CANNON.Vec3(0, 0, z), quaternion);
        });
    }

    removeDockingPorts() {
        const visualToRemove = this.box.children.filter(child => 
            child.name === 'dockingPortFront' || 
            child.name === 'dockingPortBack' || 
            child.name === 'dockingPortFrontRing' || 
            child.name === 'dockingPortBackRing'
        );
        visualToRemove.forEach(obj => {
            this.box.remove(obj);
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) obj.material.dispose();
        });
    
        this.boxBody.shapes = this.boxBody.shapes.filter((shape, index) => {
            const shapePosition = this.boxBody.shapeOffsets[index];
            const isDockingPort = 
                (shapePosition.z === this.boxDepth / 2 + this.dockingPortDepth) || 
                (shapePosition.z === -this.boxDepth / 2 - this.dockingPortDepth);
            return !isDockingPort;
        });
    }
    

    updateDockingPorts() {
        this.removeDockingPorts();
        this.addDockingPorts();
    }

    // GENERAL UPDATE

    update() {
        this.box.position.copy(this.boxBody.position);
        this.box.quaternion.copy(this.boxBody.quaternion);
    }
}