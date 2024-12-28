import React from 'react';
import { createRoot } from 'react-dom/client';
import { Cockpit } from './Cockpit';

export function initializeCockpit(spacecraft, spacecraftController) {
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