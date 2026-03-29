import * as THREE from 'three';
import type { SpacecraftModule, ModuleBuildContext, ModuleBuildResult } from './SpacecraftModule';
import { DockingPortManager, type PortConfig } from '../objects/dockingPort';
import type { DockingPortModuleParams } from './SpacecraftBlueprint';

const ALUMINUM_DENSITY = 2700;

export class DockingPortModule implements SpacecraftModule {
    readonly type = 'dockingPorts' as const;

    /** Expose the inner manager for consumers that need cameras, lights, etc. */
    public manager: DockingPortManager | null = null;
    private box: THREE.Mesh | null = null;
    private boxBody: any = null;

    public readonly dockingPortRadius: number;
    public readonly dockingPortLength: number;
    public readonly dockingPortDepth: number;
    private readonly portConfigs: PortConfig[];

    constructor(boxDepth: number, params?: DockingPortModuleParams) {
        this.dockingPortRadius = params?.radius ?? 0.3;
        this.dockingPortLength = params?.length ?? 0.07;
        this.dockingPortDepth = params?.depth ?? 0.3;
        this.portConfigs = params?.ports ?? [];

        this.manager = new DockingPortManager(
            boxDepth,
            this.dockingPortRadius,
            this.dockingPortLength,
            this.dockingPortDepth,
            ALUMINUM_DENSITY,
        );
        if (this.portConfigs.length > 0) {
            this.manager.setPortConfigs(this.portConfigs);
        }
    }

    build(ctx: ModuleBuildContext): ModuleBuildResult {
        if (!this.manager) return { mass: 0 };
        this.box = ctx.box;
        this.manager.updateDockingPorts(
            ctx.box, null,
            ctx.getMaterial('dockingPort'),
            ctx.rigid, ctx.physics,
        );
        // Hollow cylinder: 3mm wall thickness
        const wallT = 0.003;
        const R = this.dockingPortRadius;
        const innerR = Math.max(R - wallT, 0);
        const volumePerPort = Math.PI * (R ** 2 - innerR ** 2) * this.dockingPortLength;
        const numPorts = this.portConfigs.length || 2; // default front+back
        const mass = ALUMINUM_DENSITY * volumePerPort * numPorts;
        return { mass };
    }

    cleanup(): void {
        if (this.manager && this.box) {
            this.manager.removeDockingPorts(this.box, this.boxBody);
        }
        this.manager = null;
        this.box = null;
    }

    rebuild(ctx: ModuleBuildContext): ModuleBuildResult {
        this.cleanup();
        this.manager = new DockingPortManager(
            ctx.boxDepth,
            this.dockingPortRadius,
            this.dockingPortLength,
            this.dockingPortDepth,
            ALUMINUM_DENSITY,
        );
        if (this.portConfigs.length > 0) {
            this.manager.setPortConfigs(this.portConfigs);
        }
        return this.build(ctx);
    }
}
