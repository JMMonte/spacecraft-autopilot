import { canDockWithinThresholds } from '../controllers/docking/DockingUtils';
import type { Spacecraft } from './spacecraft';

/**
 * Evaluates all spacecraft pairs each frame and triggers automatic docking
 * when alignment/proximity thresholds are met.
 */
export class DockingOrchestrator {
    performPassiveDocking(spacecraftList: ReadonlyArray<Spacecraft>): void {
        const ports: Array<'front' | 'back'> = ['front', 'back'];
        const list = spacecraftList;
        const n = list.length;
        for (let i = 0; i < n; i++) {
            const a = list[i];
            for (let j = i + 1; j < n; j++) {
                const b = list[j];

                const alreadyConnected = (['front', 'back'] as const).some(
                    p => a.dockingPorts[p].dockedTo?.spacecraft === b
                );
                if (alreadyConnected) continue;

                let paired = false;
                for (const aPort of ports) {
                    if (paired) break;
                    if (!a.dockingPorts[aPort] || a.dockingPorts[aPort].isOccupied) continue;
                    for (const bPort of ports) {
                        if (!b.dockingPorts[bPort] || b.dockingPorts[bPort].isOccupied) continue;
                        if (!canDockWithinThresholds(a, aPort, b, bPort)) continue;

                        if (a.dock(aPort, b, bPort)) {
                            const apA = a.spacecraftController?.autopilot;
                            const apB = b.spacecraftController?.autopilot;
                            if (apA) { apA.resetAllModes(); apA.setReferenceObject(null); apA.setEnabled(false); }
                            if (apB) { apB.resetAllModes(); apB.setReferenceObject(null); apB.setEnabled(false); }
                            a.spacecraftController?.resetThrusterLatch?.();
                            b.spacecraftController?.resetThrusterLatch?.();
                            paired = true;
                            break;
                        }
                    }
                }
            }
        }
    }
}
