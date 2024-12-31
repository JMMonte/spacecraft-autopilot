import { createRoot } from 'react-dom/client';
import { Cockpit } from './Cockpit';
import { Spacecraft } from '../core/spacecraft';
import { SpacecraftController } from '../controllers/spacecraftController';

interface CockpitInitResult {
    cleanup: () => void;
}

export function initializeCockpit(
    spacecraft: Spacecraft,
    spacecraftController: SpacecraftController
): CockpitInitResult {
    const cockpitContainer = document.createElement('div');
    cockpitContainer.id = 'cockpit-root';
    document.body.appendChild(cockpitContainer);

    const root = createRoot(cockpitContainer);
    root.render(
        <Cockpit
            spacecraft={spacecraft}
            spacecraftController={spacecraftController}
        />
    );

    return {
        cleanup: () => {
            root.unmount();
            cockpitContainer.remove();
        }
    };
} 