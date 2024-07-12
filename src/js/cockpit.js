import * as THREE from 'three';

export class Cockpit {
    constructor(spacecraftController) {
        this.spacecraftController = spacecraftController;
        this.init();
    }

    async init() {
        await this.loadCockpitUI();
        this.artificalHorizon = new ArtificialHorizon3D();
        this.setupAutopilotControls();
        this.setupTargetPositionInputs();
        this.setupPopupControls();
    }

    async loadCockpitUI() {
        const response = await fetch('/templates/cockpit.html');
        const html = await response.text();
        const cockpitDiv = document.createElement('div');
        cockpitDiv.innerHTML = html;
        document.body.appendChild(cockpitDiv);
    }

    setupAutopilotControls() {
        const autopilotButtons = [
            'cancelAndAlign',
            'cancelRotation',
            'pointToPosition',
            'cancelLinearMotion',
            'goToPosition'
        ];

        autopilotButtons.forEach(buttonId => {
            const button = document.getElementById(buttonId);
            if (button) {
                button.addEventListener('click', () => this.toggleAutopilot(buttonId));
            }
        });
    }

    setupTargetPositionInputs() {
        const targetPositionInputs = ['target-position-x', 'target-position-y', 'target-position-z'];
        targetPositionInputs.forEach(inputId => {
            const input = document.getElementById(inputId);
            if (input) {
                input.addEventListener('input', () => this.updateTargetPosition());
            }
        });
    }

    setupPopupControls() {
        const cmdIcon = document.querySelector('.cmd-icon');
        const closeButton = document.querySelector('.close-btn');

        if (cmdIcon) {
            cmdIcon.addEventListener('click', this.togglePopup.bind(this));
        }

        if (closeButton) {
            closeButton.addEventListener('click', this.togglePopup.bind(this));
        }
    }

    togglePopup() {
        const popup = document.getElementById('keyboard-shortcuts-popup');
        popup.style.display = popup.style.display === 'none' || popup.style.display === '' ? 'block' : 'none';
    }

    toggleAutopilot(action) {
        const autopilot = this.spacecraftController.autopilot;
        switch (action) {
            case 'cancelAndAlign':
                autopilot.cancelAndAlign();
                break;
            case 'cancelRotation':
                autopilot.cancelRotation();
                break;
            case 'pointToPosition':
                autopilot.pointToPosition();
                break;
            case 'cancelLinearMotion':
                autopilot.cancelLinearMotion();
                break;
            case 'goToPosition':
                autopilot.goToPosition();
                break;
        }
        this.updateAutopilotButtons();
    }

    updateTargetPosition() {
        const x = parseFloat(document.getElementById('target-position-x').value);
        const y = parseFloat(document.getElementById('target-position-y').value);
        const z = parseFloat(document.getElementById('target-position-z').value);

        if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
            this.spacecraftController.autopilot.targetPosition.set(x, y, z);
        }
    }

    updateAutopilotButtons() {
        const activeAutopilots = this.spacecraftController.autopilot.activeAutopilots;
        Object.keys(activeAutopilots).forEach(key => {
            const button = document.getElementById(key);
            if (button) {
                button.classList.toggle('active', activeAutopilots[key]);
            }
        });
    }

    update(spacecraft) {
        if (!this.artificalHorizon) return;

        this.spacecraftController = spacecraft.spacecraftController;

        // Update spacecraft name
        document.getElementById('spacecraft-name').textContent = spacecraft.name || 'Unknown Spacecraft';

        // Update velocity
        const velocity = spacecraft.objects.boxBody.velocity;
        document.getElementById('abs-velocity').textContent = velocity.length().toFixed(3);
        document.getElementById('velocity-x').textContent = velocity.x.toFixed(3);
        document.getElementById('velocity-y').textContent = velocity.y.toFixed(3);
        document.getElementById('velocity-z').textContent = velocity.z.toFixed(3);

        // Update angular velocity
        const angularVelocity = spacecraft.objects.boxBody.angularVelocity;
        document.getElementById('abs-angular-velocity').textContent = angularVelocity.length().toFixed(3);
        document.getElementById('angular-velocity-x').textContent = angularVelocity.x.toFixed(3);
        document.getElementById('angular-velocity-y').textContent = angularVelocity.y.toFixed(3);
        document.getElementById('angular-velocity-z').textContent = angularVelocity.z.toFixed(3);

        // Update orientation
        const quaternion = spacecraft.objects.boxBody.quaternion;
        const { yaw, pitch, roll } = this.quaternionToEuler(quaternion);
        document.getElementById('yaw').textContent = yaw.toFixed(1);
        document.getElementById('pitch').textContent = pitch.toFixed(1);
        document.getElementById('roll').textContent = roll.toFixed(1);

        // Update artificial horizon
        this.artificalHorizon.update(quaternion);

        // Update autopilot buttons
        this.updateAutopilotButtons();
    }

    quaternionToEuler(q) {
        const euler = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w), 'YZX');
        return {
            yaw: THREE.MathUtils.radToDeg(euler.y),
            pitch: THREE.MathUtils.radToDeg(euler.x),
            roll: THREE.MathUtils.radToDeg(euler.z)
        };
    }
}



class ArtificialHorizon3D {
    constructor() {
        this.container = document.getElementById('horizon-container');
        if (!this.container) {
            console.error('Horizon container not found');
            return;
        }
        this.width = this.container.clientWidth;
        this.height = this.container.clientHeight;

        this.scene = new THREE.Scene();
        this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
        this.camera.position.set(0, 0, 5);

        this.renderer = new THREE.WebGLRenderer({ 
            antialias: true,
            alpha: true  // Enable alpha (transparency)
        });
        this.renderer.setSize(this.width, this.height);
        this.renderer.setClearColor(0x000000, 0);  // Set clear color to transparent
        this.container.appendChild(this.renderer.domElement);

        this.createHorizon();
        this.createReticle();
    }

    createHorizon() {
        // Load the texture
        const textureLoader = new THREE.TextureLoader();
        textureLoader.load('images/rLHbWVB.png', (texture) => {
            texture.mapping = THREE.EquirectangularReflectionMapping;
            
            // Flip the texture horizontally
            texture.repeat.x = -1;
            texture.offset.x = 1;

            // Apply anisotropic filtering
            const maxAnisotropy = this.renderer.capabilities.getMaxAnisotropy();
            texture.anisotropy = maxAnisotropy;

            // Ensure the texture uses mipmapping
            texture.minFilter = THREE.LinearMipmapLinearFilter;
            texture.magFilter = THREE.LinearFilter;

            const sphereGeometry = new THREE.SphereGeometry(1, 64, 64);
            const sphereMaterial = new THREE.MeshBasicMaterial({
                map: texture,
                side: THREE.BackSide,
                transparent: true,  // Enable transparency for the sphere material
                opacity: 1  // Adjust if you want the sphere itself to be slightly transparent
            });
            this.sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
            this.scene.add(this.sphere);

            // Initial render
            this.renderer.render(this.scene, this.camera);
        });
    }

    createReticle() {
        const reticleGroup = new THREE.Group();

        // Create horizontal rectangle
        const horizontalGeometry = new THREE.PlaneGeometry(0.2, 0.05);
        const horizontalMaterial = new THREE.MeshBasicMaterial({ color: 0xffff00 });
        const horizontalRect = new THREE.Mesh(horizontalGeometry, horizontalMaterial);
        reticleGroup.add(horizontalRect);

        // Create vertical rectangle
        const verticalGeometry = new THREE.PlaneGeometry(0.05, 0.2);
        const verticalMaterial = new THREE.MeshBasicMaterial({ color: 0xffff00 });
        const verticalRect = new THREE.Mesh(verticalGeometry, verticalMaterial);
        reticleGroup.add(verticalRect);

        // Position the reticle in front of the sphere
        reticleGroup.position.z = 1;

        this.reticle = reticleGroup;
        this.scene.add(this.reticle);
    }

    update(quaternion) {
        if (this.sphere) {
            // Create a rotation matrix from the quaternion
            const rotationMatrix = new THREE.Matrix4().makeRotationFromQuaternion(
                new THREE.Quaternion(quaternion.x, quaternion.y, quaternion.z, quaternion.w)
            );
            
            // Apply the inverse of this rotation to the sphere
            this.sphere.setRotationFromMatrix(rotationMatrix.invert());

            this.renderer.render(this.scene, this.camera);
        }
    }
}
