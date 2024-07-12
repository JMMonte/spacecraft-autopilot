import * as dat from 'dat.gui';

export class GUIControls {
    constructor(objects, rcsVisuals, spacecraft, spacecraftController, helpers) {
        this.gui = new dat.GUI();
        this.objects = objects;
        this.rcsVisuals = rcsVisuals;
        this.spacecraft = spacecraft;
        this.spacecraftController = spacecraftController;
        this.helpers = helpers; // Add helpers
        this.autopilot = spacecraftController.autopilot; // Access autopilot instance
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
            cancelAndAlign: false, // Add autopilot status
            cancelRotation: false, // Add cancel rotation status
            pointToPosition: false, // Add point to position status
            cancelLinearMotion: false, // Add cancel linear motion status
            kp: this.autopilot.pidController.kp, // Access through autopilot instance
            ki: this.autopilot.pidController.ki, // Access through autopilot instance
            kd: this.autopilot.pidController.kd, // Access through autopilot instance
            lkp: this.autopilot.linearPidController.kp,
            lki: this.autopilot.linearPidController.ki,
            lkd: this.autopilot.linearPidController.kd,
            showAutopilotArrow: true,
            showVelocityArrow: true,
            showAutopilotTorqueArrow: true,
            showRotationAxisArrow: true,
            showOrientationArrow: true,
            thrust: spacecraftController.thrust, // Newtons
            cancelAndAlign: false,
            cancelRotation: false,
            pointToPosition: false,
            cancelLinearMotion: false,
            goToPosition: false, // Add new option for Go to Position
        };
        this.createGUIControls();
        // this.velocityFolder = this.gui.addFolder("Velocity");
        // this.addVelocityControls();
        // this.angularVelocityFolder = this.gui.addFolder("Angular Velocity");
        // this.addAngularVelocityControls();
        this.autopilotFolder = this.gui.addFolder("Autopilot"); // Add autopilot folder
        this.addAutopilotControls(); // Add autopilot controls
        this.pidFolder = this.gui.addFolder("PID Controls");
        this.addPIDControls(); // Add PID controls
        this.initializeArrowVisibility();
        this.options.targetX = 0; // Initialize target position X
        this.options.targetY = 0; // Initialize target position Y
        this.options.targetZ = 0; // Initialize target position Z
        // this.addTargetPositionControls(); // Add target position controls to GUI
    }

    createGUIControls() {
        const boxFolder = this.gui.addFolder("Spacecraft dimensions");
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

        const rcsFolder = this.gui.addFolder("RCS Details");
        rcsFolder.add(this.options, "thrust", 0, 20000).onChange((value) => {
            this.spacecraftController.thrust = value; // Ensure the thrust is updated correctly
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
        // this.autopilotFolder.add(this.options, "cancelAndAlign").name("Cancel and Align").onChange((value) => {
        //     this.spacecraftController.autopilot.cancelAndAlign();
        //     this.updateVectorVisibility();
        // }).listen();

        // this.autopilotFolder.add(this.options, "cancelRotation").name("Cancel Rotation").onChange((value) => {
        //     this.spacecraftController.autopilot.cancelRotation();
        //     this.updateVectorVisibility();
        // }).listen();

        // this.autopilotFolder.add(this.options, "pointToPosition").name("Point to Position").onChange((value) => {
        //     this.spacecraftController.autopilot.pointToPosition();
        //     this.updateVectorVisibility();
        // }).listen();

        // this.autopilotFolder.add(this.options, "cancelLinearMotion").name("Cancel Linear Motion").onChange((value) => {
        //     this.spacecraftController.autopilot.cancelLinearMotion();
        // }).listen();

        // this.autopilotFolder.add(this.options, "goToPosition").name("Go to Position").onChange((value) => {
        //     this.spacecraftController.autopilot.goToPosition();
        //     this.updateVectorVisibility();
        // }).listen();

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

        this.autopilotFolder.add(this.options, "showVelocityArrow").name("Velocity Arrow").onChange((value) => {
            this.updateArrowVisibility("velocityArrow", value);
        });
    }

    updateVectorVisibility() {
        const showArrows = this.spacecraftController.autopilot.isAutopilotEnabled;
        this.updateArrowVisibility("autopilotArrow", showArrows && this.options.showAutopilotArrow);
        this.updateArrowVisibility("autopilotTorqueArrow", showArrows && this.options.showAutopilotTorqueArrow);
        this.updateArrowVisibility("rotationAxisArrow", showArrows && this.options.showRotationAxisArrow);
        this.updateArrowVisibility("orientationArrow", showArrows && this.options.showOrientationArrow);
    }

    updateArrowVisibility(arrowName, visible) {
        const arrow = this.helpers[arrowName]; // Use helpers from the controller
        if (arrow) {
            arrow.visible = visible;
        }
    }

    onAutopilotStateChanged(event) {
        const { enabled, activeAutopilots } = event.detail;
        
        this.options.cancelAndAlign = activeAutopilots.align;
        this.options.cancelRotation = activeAutopilots.rotation;
        this.options.pointToPosition = activeAutopilots.pointToPosition;
        this.options.cancelLinearMotion = activeAutopilots.linearMotion;
        this.options.goToPosition = activeAutopilots.goToPosition; // Add new autopilot function

        this.gui.updateDisplay();
        this.updateVectorVisibility();
    }

    addPIDControls() {
        const pidFolderRot = this.pidFolder.addFolder("PID Rotational");
        pidFolderRot.add(this.options, "kp", 0, 50).onChange((value) => {
            this.autopilot.pidController.kp = value; // Update the autopilot's PID controller directly
            this.options.kp = value; // Update the options.kp value
        });
        pidFolderRot.add(this.options, "ki", 0, 50).onChange((value) => {
            this.autopilot.pidController.ki = value; // Update the autopilot's PID controller directly
            this.options.ki = value; // Update the options.ki value
        });
        pidFolderRot.add(this.options, "kd", 0, 50).onChange((value) => {
            this.autopilot.pidController.kd = value; // Update the autopilot's PID controller directly
            this.options.kd = value; // Update the options.kd value
        });
        pidFolderRot.open();

        const pidFolderLin = this.pidFolder.addFolder("PID Linear");
        pidFolderLin.add(this.options, "lkp", 0, 50).onChange((value) => {
            this.autopilot.linearPidController.kp = value;
            this.options.lkp = value;
        });
        pidFolderLin.add(this.options, "lki", 0, 50).onChange((value) => {
            this.autopilot.linearPidController.ki = value;
            this.options.lki = value;
        });
        pidFolderLin.add(this.options, "lkd", 0, 50).onChange((value) => {
            this.autopilot.linearPidController.kd = value;
            this.options.lkd = value;
        });
        pidFolderLin.open();

    }

    addTargetPositionControls() {
        const targetFolder = this.gui.addFolder("Target Position");
        targetFolder.add(this.options, "targetX").name("Target X").onChange(value => {
            this.spacecraftController.autopilot.targetPosition.x = value;
        });
        targetFolder.add(this.options, "targetY").name("Target Y").onChange(value => {
            this.spacecraftController.autopilot.targetPosition.y = value;
        });
        targetFolder.add(this.options, "targetZ").name("Target Z").onChange(value => {
            this.spacecraftController.autopilot.targetPosition.z = value;
        });
        targetFolder.open();
    }
}
