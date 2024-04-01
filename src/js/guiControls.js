import * as dat from 'dat.gui';

export class GUIControls {
    constructor(objects, rcsVisuals, spacecraft, spacecraftController) {
        this.gui = new dat.GUI();
        this.objects = objects;
        this.rcsVisuals = rcsVisuals;
        this.spacecraft = spacecraft;
        this.spacecraftController = spacecraftController;
        document.addEventListener('autopilotEnabledChanged', this.onAutopilotEnabledChanged.bind(this));
        document.addEventListener('autopilotStateChanged', this.onAutopilotStateChanged.bind(this));
        this.options = {
            boxWidth: objects.boxWidth,
            boxHeight: objects.boxHeight,
            boxDepth: objects.boxDepth,
            velocityX: "0.000",
            velocityY: "0.000",
            velocityZ: "0.000",
            absoluteVelocity: "0.000",
            angularVelocityX: "0.000",
            angularVelocityY: "0.000",
            angularVelocityZ: "0.000",
            absoluteAngularVelocity: "0.000",
            autopilotEnabled: false, // Add autopilot status
            kp: spacecraftController.pidController.kp,
            ki: spacecraftController.pidController.ki,
            kd: spacecraftController.pidController.kd,
            showAutopilotArrow: true,
            showAutopilotTorqueArrow: true,
            showRotationAxisArrow: true,
            showOrientationArrow: true,
            thrust: spacecraftController.thrust, // Newtons
        };
        this.createGUIControls();
        this.velocityFolder = this.gui.addFolder("Velocity");
        this.addVelocityControls();
        this.angularVelocityFolder = this.gui.addFolder("Angular Velocity");
        this.addAngularVelocityControls();
        this.autopilotFolder = this.gui.addFolder("Autopilot"); // Add autopilot folder
        this.addAutopilotControls(); // Add autopilot controls
        this.addPIDControls(); // Add PID controls
        this.initializeArrowVisibility();

    }

    createGUIControls() {
        const boxFolder = this.gui.addFolder("Spacecraft");
        boxFolder.add(this.options, "boxWidth", 0.1, 20.0).onChange((e) => {
            this.objects.updateBox(e, this.objects.boxHeight, this.objects.boxDepth);
        });
        boxFolder.add(this.options, "boxHeight", 0.1, 20.0).onChange((e) => {
            this.objects.updateBox(this.objects.boxWidth, e, this.objects.boxDepth);
        });
        boxFolder.add(this.options, "boxDepth", 0.1, 20.0).onChange((e) => {
            this.objects.updateBox(this.objects.boxWidth, this.objects.boxHeight, e);
        });
        boxFolder.open();

        const rcsFolder = this.gui.addFolder("RCS");
        rcsFolder.add(this.options, "thrust", 0, 20000).onChange((value) => {
            this.spacecraftController.thrust = value;
        });

    }
    initializeArrowVisibility() {
        // Initially set the visibility of all autopilot-related arrows to false
        // This assumes that the arrows exist at this point; if not, you might need to adjust when this is called
        this.updateArrowVisibility("autopilotArrow", false);
        this.updateArrowVisibility("autopilotTorqueArrow", false);
        this.updateArrowVisibility("rotationAxisArrow", false);
        this.updateArrowVisibility("orientationArrow", false);
    }
    addVelocityControls() {
        this.velocityFolder.add(this.options, "velocityX").name("Velocity X").listen();
        this.velocityFolder.add(this.options, "velocityY").name("Velocity Y").listen();
        this.velocityFolder.add(this.options, "velocityZ").name("Velocity Z").listen();
        this.velocityFolder.add(this.options, "absoluteVelocity").name("Absolute Velocity").listen();
        this.velocityFolder.open();
    }

    updateVelocityDisplays() {
        // Assuming the body is now accessible through this.spacecraft.objects.boxBody
        const velocity = this.spacecraft.objects.boxBody.velocity;
        this.options.velocityX = velocity.x.toFixed(3);
        this.options.velocityY = velocity.y.toFixed(3);
        this.options.velocityZ = velocity.z.toFixed(3);
        this.options.absoluteVelocity = velocity.length().toFixed(3);
    }
    addAngularVelocityControls() {
        this.angularVelocityFolder.add(this.options, "angularVelocityX").name("Angular Velocity X").listen();
        this.angularVelocityFolder.add(this.options, "angularVelocityY").name("Angular Velocity Y").listen();
        this.angularVelocityFolder.add(this.options, "angularVelocityZ").name("Angular Velocity Z").listen();
        this.angularVelocityFolder.add(this.options, "absoluteAngularVelocity").name("Absolute Angular Velocity").listen();
        this.angularVelocityFolder.open();
    }
    updateAngularVelocityDisplays() {
        const angularVelocity = this.spacecraft.objects.boxBody.angularVelocity;
        this.options.angularVelocityX = angularVelocity.x.toFixed(3); // As a string for precision
        this.options.angularVelocityY = angularVelocity.y.toFixed(3); // As a string for precision
        this.options.angularVelocityZ = angularVelocity.z.toFixed(3); // As a string for precision
    }

    addAutopilotControls() {
        this.autopilotFolder.add(this.options, "autopilotEnabled").name("Cancel Rotation").onChange((value) => {
            this.spacecraftController.autopilotEnabled = value;
        }).listen();

        this.autopilotFolder.add(this.options, "showAutopilotArrow").name("Target Orientation").onChange((value) => {
            this.updateArrowVisibility("autopilotArrow", value);
        });

        this.autopilotFolder.add(this.options, "showAutopilotTorqueArrow").name("Torque Arrow").onChange((value) => {
            this.updateArrowVisibility("autopilotTorqueArrow", value);
        });

        this.autopilotFolder.add(this.options, "showRotationAxisArrow").name("Rotation Axis Arrow").onChange((value) => {
            this.updateArrowVisibility("rotationAxisArrow", value);
        });

        this.autopilotFolder.add(this.options, "showOrientationArrow").name("Orientation Arrow").onChange((value) => {
            this.updateArrowVisibility("orientationArrow", value);
        });

        this.autopilotFolder.open();
    }

    updateVectorVisibility() {
        // Here you check the state of autopilotEnabled and update visibility of vectors accordingly
        const isVisible = this.options.autopilotEnabled;
        this.updateArrowVisibility("autopilotArrow", isVisible);
        this.updateArrowVisibility("autopilotTorqueArrow", isVisible);
        this.updateArrowVisibility("rotationAxisArrow", isVisible);
        this.updateArrowVisibility("orientationArrow", isVisible);
    }

    updateArrowVisibility(arrowName, visible) {
        const arrow = this.spacecraft.world.helpers[arrowName];
        if (arrow) {
            arrow.visible = visible;
        }
    }
    onAutopilotEnabledChanged() {
        this.options.autopilotEnabled = this.spacecraftController.autopilotEnabled;
        this.updateVectorVisibility(); // Call method to update visibility based on autopilot state
    }
    onAutopilotStateChanged(event) {
        this.options.autopilotEnabled = event.detail;
        this.gui.updateDisplay();
        this.updateVectorVisibility(); // Call method to update visibility based on autopilot state
    }
    addPIDControls() {
        const pidFolder = this.autopilotFolder.addFolder("PID");
        pidFolder.add(this.options, "kp", 0, 50).onChange((value) => {
            this.spacecraftController.updatePIDParameters(value, this.options.ki, this.options.kd);
            this.options.kp = value; // Update the options.kp value
        });
        pidFolder.add(this.options, "ki", 0, 50).onChange((value) => {
            this.spacecraftController.updatePIDParameters(this.options.kp, value, this.options.kd);
            this.options.ki = value; // Update the options.ki value
        });
        pidFolder.add(this.options, "kd", 0, 50).onChange((value) => {
            this.spacecraftController.updatePIDParameters(this.options.kp, this.options.ki, value);
            this.options.kd = value; // Update the options.kd value
        });
        pidFolder.open();
    }
}