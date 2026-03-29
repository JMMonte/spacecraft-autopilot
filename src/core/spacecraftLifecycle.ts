import type { SpacecraftController } from '../controllers/spacecraftController';
import type { Spacecraft } from './spacecraft';

export function removeSpacecraftAndController(
    spacecrafts: Spacecraft[],
    spacecraftControllers: SpacecraftController[],
    spacecraftToDelete: Spacecraft,
    onCleanup?: () => void
): boolean {
    const spacecraftIndex = spacecrafts.indexOf(spacecraftToDelete);
    if (spacecraftIndex === -1) return false;

    const controllerIndex = spacecraftControllers.findIndex(
        controller => controller.getSpacecraft?.() === spacecraftToDelete
    );
    if (controllerIndex === -1) return false;

    spacecrafts.splice(spacecraftIndex, 1);
    spacecraftControllers.splice(controllerIndex, 1);

    onCleanup?.();
    return true;
}
