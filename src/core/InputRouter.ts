import * as THREE from 'three';
import { emitCameraModeToggleRequested } from '../domain/simulationEvents';
import type { Spacecraft } from './spacecraft';
import type { SpacecraftController } from '../controllers/spacecraftController';

/**
 * Routes keyboard and mouse input to the active spacecraft controller.
 */
export class InputRouter {
    private keysPressed: { [key: string]: boolean } = {};

    constructor(
        private getControllers: () => SpacecraftController[],
        private getSpacecraft: () => Spacecraft[],
        private getCamera: () => THREE.PerspectiveCamera,
        private getRendererElement: () => HTMLCanvasElement,
        private setActiveSpacecraft: (s: Spacecraft) => void,
    ) {}

    onKeyDown(event: KeyboardEvent): void {
        this.keysPressed[event.code] = true;
        if (event.code === 'KeyC') {
            try { emitCameraModeToggleRequested('keyboard'); } catch {}
        }
        const active = this.getControllers().find(c => c.getIsActive());
        if (active) active.handleKeyDown(event);
    }

    onKeyUp(event: KeyboardEvent): void {
        this.keysPressed[event.code] = false;
        const active = this.getControllers().find(c => c.getIsActive());
        if (active) active.handleKeyUp(event);
    }

    onDoubleClick(event: MouseEvent): void {
        event.preventDefault();
        const mouse = new THREE.Vector2();
        const el = this.getRendererElement();
        const rect = el.getBoundingClientRect();
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouse, this.getCamera());

        const clickable = this.getSpacecraft().flatMap(s => s.getThreeObjects());
        const intersects = raycaster.intersectObjects(clickable, true);

        if (intersects.length > 0) {
            const target = intersects[0].object;
            const spacecraft = this.getSpacecraft().find(s => s.objects.box === target);
            if (spacecraft) this.setActiveSpacecraft(spacecraft);
        }
    }
}
