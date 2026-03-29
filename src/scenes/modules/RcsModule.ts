import type { SpacecraftModule, ModuleBuildContext, ModuleBuildResult } from './SpacecraftModule';
import { RCSVisuals } from '../objects/rcsVisuals';
import type { SpacecraftModel } from '../objects/spacecraftModel';
import type { RcsModuleParams } from './SpacecraftBlueprint';
import type { RigidBody } from '../../physics/types';

/**
 * Adapter module for the RCS thruster system.
 *
 * Unlike other modules, RCSVisuals needs the full SpacecraftModel reference
 * and a RigidBody. This module stores the created RCSVisuals instance
 * so the Spacecraft entity can extract it.
 */
export class RcsModule implements SpacecraftModule {
    readonly type = 'rcs' as const;
    public rcsVisuals: RCSVisuals | null = null;
    private readonly params: RcsModuleParams;

    constructor(params?: RcsModuleParams) {
        this.params = params ?? {};
    }

    /**
     * Build the RCS visuals. Requires the SpacecraftModel and rigid body
     * to be passed via the context's extended data.
     */
    buildWithModel(model: SpacecraftModel, rigid: RigidBody): RCSVisuals {
        this.rcsVisuals = new RCSVisuals(model, rigid);
        if (this.params.lights === false) {
            this.rcsVisuals.setThrusterLightsEnabled(false);
        }
        if (this.params.particles === false) {
            this.rcsVisuals.setThrusterParticlesEnabled(false);
        }
        return this.rcsVisuals;
    }

    /** Standard interface — returns zero mass (thrusters are accounted for in body). */
    build(_ctx: ModuleBuildContext): ModuleBuildResult {
        // RCS is built via buildWithModel() since it needs SpacecraftModel ref.
        return { mass: 0 };
    }

    update(dt: number): void {
        this.rcsVisuals?.update(dt);
    }

    cleanup(): void {
        this.rcsVisuals?.cleanup();
        this.rcsVisuals = null;
    }
}
