import * as THREE from 'three';
import * as CANNON from 'cannon-es';

export class SceneHelpers {
    constructor(scene, light, camera) {
        this.scene = scene;
        this.light = light;
        this.camera = camera;
        this.createHelpers();
    }

    createHelpers() {   

        const gridHelper = new THREE.GridHelper(1000, 1000);
        this.scene.add(gridHelper);

        // Add transparent haze to the grid
        const distanceToCamera = this.camera.position.distanceTo(gridHelper.position);
        const opacity = 1 - (distanceToCamera / 8); // Adjust the divisor to control the rate of opacity change
        const gridMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity });
        gridHelper.material = gridMaterial;

        const axesHelper = new THREE.AxesHelper(5);
        this.scene.add(axesHelper);

        // debug forces
        this.velocityArrow = new THREE.ArrowHelper(new THREE.Vector3(), new THREE.Vector3(), 3, 0x00ff00);
        this.scene.add(this.velocityArrow);
        this.rotationArrow = new THREE.ArrowHelper(new THREE.Vector3(), new THREE.Vector3(), 3, 0xff0000);
        this.scene.add(this.rotationArrow);

        // Autopilot arrow
        this.autopilotArrow = new THREE.ArrowHelper(new THREE.Vector3(), new THREE.Vector3(), 5, 0x0000ff);
        this.scene.add(this.autopilotArrow);

        // Autopilot torque arrow
        this.autopilotTorqueArrow = new THREE.ArrowHelper(new THREE.Vector3(), new THREE.Vector3(), 3, 0xff00ff);
        this.scene.add(this.autopilotTorqueArrow);

        // Current rotation axis arrow
        this.rotationAxisArrow = new THREE.ArrowHelper(new THREE.Vector3(), new THREE.Vector3(), 3, 0xffff00);
        this.scene.add(this.rotationAxisArrow);

        // Current orientation arrow
        this.orientationArrow = new THREE.ArrowHelper(new THREE.Vector3(), new THREE.Vector3(), 3, 0x00ffff);
        this.scene.add(this.orientationArrow);
    }

    updateAutopilotArrow(position, direction) {
        this.autopilotArrow.position.copy(position);
        this.autopilotArrow.setDirection(direction);
    }

    updateAutopilotTorqueArrow(position, direction) {
        this.autopilotTorqueArrow.position.copy(position);
        this.autopilotTorqueArrow.setDirection(direction);
    }

    updateRotationAxisArrow(position, direction) {
        this.rotationAxisArrow.position.copy(position);
        this.rotationAxisArrow.setDirection(direction);
    }

    updateOrientationArrow(position, direction) {
        this.orientationArrow.position.copy(position);
        this.orientationArrow.setDirection(direction);
    }
    updateTorqueArrow(position, torque) {
        const threeTorque = new THREE.Vector3(torque.x, torque.y, torque.z);
        this.torqueArrow.setDirection(threeTorque.normalize());
        this.torqueArrow.setLength(threeTorque.length());
        this.torqueArrow.position.copy(position);
    }

    updateVelocityArrow(position, velocity) {
        const threeVelocity = new THREE.Vector3(velocity.x, velocity.y, velocity.z);
        this.velocityArrow.setLength(threeVelocity.length());
        this.velocityArrow.setDirection(threeVelocity.normalize());
        this.velocityArrow.position.copy(position);
    }

    disableHelpers() {
        this.autopilotArrow.visible = false;
        this.autopilotTorqueArrow.visible = false;
        this.rotationAxisArrow.visible = false;
        this.orientationArrow.visible = false;
        this.velocityArrow.visible = false;
    }
}