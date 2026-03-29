import * as THREE from 'three';
import type { SpacecraftModule, ModuleBuildContext, ModuleBuildResult } from './SpacecraftModule';
import { TrussManager } from '../objects/truss';
import type { TrussModuleParams } from './SpacecraftBlueprint';

const ALUMINUM_DENSITY = 2700;

export class TrussModule implements SpacecraftModule {
    readonly type = 'truss' as const;
    private manager: TrussManager | null = null;
    private box: THREE.Mesh | null = null;
    private readonly trussRadius: number;
    private dockingPortRadius = 0.3; // default; overridden if docking module sets it

    constructor(params?: TrussModuleParams) {
        this.trussRadius = params?.radius ?? 0.05;
    }

    /** Allow the docking module to feed its radius so end-structure trusses converge correctly. */
    setDockingPortRadius(r: number): void {
        this.dockingPortRadius = r;
    }

    build(ctx: ModuleBuildContext): ModuleBuildResult {
        this.box = ctx.box;
        this.manager = new TrussManager(
            ctx.boxWidth, ctx.boxHeight, ctx.boxDepth,
            this.trussRadius, this.dockingPortRadius,
        );
        this.manager.addTrussToBox(ctx.box, ctx.getMaterial('truss'));
        const mass = this.computeMass(ctx);
        return { mass };
    }

    /** Build end-structure trusses toward docking ports (called after DockingPortModule). */
    buildEndStructure(ctx: ModuleBuildContext, dockingPortDepth: number): void {
        if (!this.manager || !this.box) return;
        this.manager.updateEndStructure(
            this.box,
            ctx.getMaterial('endStructure'),
            {
                margin: 0.1,
                structureDepth: dockingPortDepth,
                endWidth: this.dockingPortRadius,
                endHeight: this.dockingPortRadius,
            },
        );
    }

    /** Build end-structure trusses for arbitrary port configs. */
    buildEndStructureForPorts(
        ctx: ModuleBuildContext,
        ports: Array<{ id: string; localPosition: { x: number; y: number; z: number }; localDirection: { x: number; y: number; z: number } }>,
        dockingPortDepth: number,
    ): void {
        if (!this.manager || !this.box) return;
        this.manager.removeAllEndStructureTrusses(this.box);
        this.manager.updateEndStructureForPorts(
            this.box,
            ctx.getMaterial('endStructure'),
            ports,
            {
                margin: 0.1,
                structureDepth: dockingPortDepth,
                endWidth: this.dockingPortRadius,
                endHeight: this.dockingPortRadius,
            },
        );
    }

    cleanup(): void {
        if (this.manager && this.box) {
            this.manager.removeTrussFromBox(this.box);
            this.manager.removeAllEndStructureTrusses(this.box);
        }
        this.manager = null;
        this.box = null;
    }

    rebuild(ctx: ModuleBuildContext): ModuleBuildResult {
        this.cleanup();
        return this.build(ctx);
    }

    private computeMass(ctx: ModuleBuildContext): number {
        // Hollow tubes: 2mm wall thickness
        const wallT = 0.002;
        const R = this.trussRadius;
        const innerR = Math.max(R - wallT, 0);
        const avgLength = (ctx.boxWidth + ctx.boxHeight + ctx.boxDepth) / 3;
        const tubeArea = Math.PI * (R ** 2 - innerR ** 2);
        return ALUMINUM_DENSITY * tubeArea * avgLength * 12;
    }
}
