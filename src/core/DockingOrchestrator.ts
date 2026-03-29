import { canDockWithinThresholds, type DockingPortId } from '../controllers/docking/DockingUtils';
import type { Spacecraft } from './spacecraft';

/**
 * Evaluates all spacecraft pairs each frame and triggers automatic docking
 * when alignment/proximity thresholds are met.
 */
export class DockingOrchestrator {
    private _enabled = true;

    /** Disable passive docking (e.g. during a scripted docking sequence). */
    public setEnabled(enabled: boolean): void { this._enabled = enabled; }
    public get enabled(): boolean { return this._enabled; }

    performPassiveDocking(spacecraftList: ReadonlyArray<Spacecraft>): void {
        if (!this._enabled) return;
        const list = spacecraftList;
        const n = list.length;
        for (let i = 0; i < n; i++) {
            const a = list[i];
            const aPorts = Object.keys(a.dockingPorts) as DockingPortId[];
            for (let j = i + 1; j < n; j++) {
                const b = list[j];
                const bPorts = Object.keys(b.dockingPorts) as DockingPortId[];

                const alreadyConnected = aPorts.some(
                    p => a.dockingPorts[p]?.dockedTo?.spacecraft === b
                );
                if (alreadyConnected) continue;

                let paired = false;
                for (const aPort of aPorts) {
                    if (paired) break;
                    if (!a.dockingPorts[aPort] || a.dockingPorts[aPort].isOccupied) continue;
                    for (const bPort of bPorts) {
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
