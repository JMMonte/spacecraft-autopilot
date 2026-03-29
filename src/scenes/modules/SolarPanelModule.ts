import * as THREE from 'three';
import type { SpacecraftModule, ModuleBuildContext, ModuleBuildResult } from './SpacecraftModule';
import type { SolarPanelModuleParams } from './SpacecraftBlueprint';
import type { PhysicsEngine } from '../../physics';
import type { RigidBody } from '../../physics/types';

/**
 * Effective density for solar panel colliders.
 * Real panels are ~2 kg/m² surface density. For a 0.02m thick panel,
 * that's ~100 kg/m³ — much lighter than bulk silicon (2500).
 * Using a realistic value prevents panels from dominating inertia.
 */
const SOLAR_PANEL_COLLIDER_DENSITY = 100; // kg/m³
const SOLAR_CELL_DENSITY_MASS = 2; // kg/m² surface density for mass calc
const ALUMINUM_DENSITY = 2700;

type DeployState = 'stowed' | 'deploying' | 'deployed' | 'retracting';

interface Wing {
    group: THREE.Group;
    /** Boom cylinder connecting hull to panel array base. */
    boom: THREE.Mesh;
    /** Joint sphere at the boom-to-panel junction. */
    joint: THREE.Mesh;
    /** Cross-strut at the base connecting the two parallel struts along Z. */
    baseStrut: THREE.Mesh;
    /** Two struts: one at +Z edge, one at -Z edge of the panel array. */
    struts: THREE.Mesh[];
    panels: THREE.Mesh[];
    /** +1 for right/positive X, -1 for left/negative X */
    sign: number;
}

// Scratch quaternion to avoid allocations in update loop
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();

/**
 * Deployable solar panel module with scissor-fold animation.
 *
 * Creates one or two wings (left/right) that extend from the spacecraft hull.
 * Each wing has two parallel struts (top/bottom edge) and rectangular panel
 * segments that unfold in alternating directions (scissor pattern).
 * Span is computed automatically from panelCount × panelWidth.
 */
export class SolarPanelModule implements SpacecraftModule {
    readonly type = 'solarPanel' as const;

    // Config (mutable for runtime reconfiguration)
    private _placement: 'left' | 'right' | 'both';
    private _verticalPosition: 'top' | 'center' | 'bottom';
    private _panelCount: number;
    private _panelWidth: number;
    private _panelGap: number;
    private _panelThickness: number;
    private _strutRadius: number;
    private _boomLength: number;
    private _deployedAngle: number; // radians
    private _stowedAngle: number;   // radians
    private _deployDuration: number;
    private readonly startDeployed: boolean;

    // Runtime
    private wings: Wing[] = [];
    private state: DeployState = 'stowed';
    private progress = 0; // 0..1
    private box: THREE.Mesh | null = null;
    private panelDepth = 0;
    private lastBuildCtx: ModuleBuildContext | null = null;

    // Physics
    private physics: PhysicsEngine | null = null;
    private rigid: RigidBody | null = null;
    private colliderHandles: unknown[] = [];

    // Shared geometry / materials (created once, reused across wings)
    private panelGeometry: THREE.BoxGeometry | null = null;
    private panelMaterial: THREE.Material | null = null;
    private panelBackMaterial: THREE.Material | null = null;
    private strutMaterial: THREE.Material | null = null;

    constructor(params?: SolarPanelModuleParams) {
        this._placement = params?.placement ?? 'both';
        this._verticalPosition = params?.verticalPosition ?? 'center';
        this._panelCount = params?.panelCount ?? 4;
        this._panelWidth = params?.panelWidth ?? 0.8;
        this._panelGap = params?.panelGap ?? 0.05;
        this._panelThickness = params?.panelThickness ?? 0.02;
        this._strutRadius = params?.mastRadius ?? 0.03;
        this._boomLength = params?.boomLength ?? 0.5;
        this._deployedAngle = (params?.deployedAngle ?? 0) * Math.PI / 180;
        this._stowedAngle = (params?.stowedAngle ?? 90) * Math.PI / 180;
        this._deployDuration = params?.deployDuration ?? 2.0;
        this.startDeployed = params?.startDeployed ?? true;
    }

    // ── Getters ─────────────────────────────────────────────────

    get placement(): 'left' | 'right' | 'both' { return this._placement; }
    get verticalPosition(): 'top' | 'center' | 'bottom' { return this._verticalPosition; }
    /** Computed span: sum of panel widths + gaps. */
    get span(): number {
        return this._panelCount * this._panelWidth + Math.max(this._panelCount - 1, 0) * this._panelGap;
    }
    get panelCount(): number { return this._panelCount; }
    get panelWidth(): number { return this._panelWidth; }
    get panelGap(): number { return this._panelGap; }
    get panelThickness(): number { return this._panelThickness; }
    get strutRadius(): number { return this._strutRadius; }
    get boomLength(): number { return this._boomLength; }
    /** Deployed angle in degrees. */
    get deployedAngle(): number { return this._deployedAngle * 180 / Math.PI; }
    /** Stowed angle in degrees. */
    get stowedAngle(): number { return this._stowedAngle * 180 / Math.PI; }
    get deployDuration(): number { return this._deployDuration; }

    /**
     * Reconfigure panel parameters and rebuild geometry.
     */
    reconfigure(params: Partial<SolarPanelModuleParams>): void {
        if (params.placement !== undefined) this._placement = params.placement;
        if (params.verticalPosition !== undefined) this._verticalPosition = params.verticalPosition;
        if (params.panelCount !== undefined) this._panelCount = params.panelCount;
        if (params.panelWidth !== undefined) this._panelWidth = params.panelWidth;
        if (params.panelGap !== undefined) this._panelGap = params.panelGap;
        if (params.panelThickness !== undefined) this._panelThickness = params.panelThickness;
        if (params.mastRadius !== undefined) this._strutRadius = params.mastRadius;
        if (params.boomLength !== undefined) this._boomLength = params.boomLength;
        if (params.deployedAngle !== undefined) this._deployedAngle = params.deployedAngle * Math.PI / 180;
        if (params.stowedAngle !== undefined) this._stowedAngle = params.stowedAngle * Math.PI / 180;
        if (params.deployDuration !== undefined) this._deployDuration = params.deployDuration;
        if (this.lastBuildCtx) {
            this.rebuild(this.lastBuildCtx);
        }
    }

    // ── Lifecycle ────────────────────────────────────────────────

    build(ctx: ModuleBuildContext): ModuleBuildResult {
        this.lastBuildCtx = ctx;
        this.box = ctx.box;
        this.physics = ctx.physics;
        this.rigid = ctx.rigid;

        this.panelDepth = ctx.boxDepth * 0.8;
        this.panelGeometry = new THREE.BoxGeometry(this._panelWidth, this._panelThickness, this.panelDepth);

        this.panelMaterial = ctx.getMaterial('solarPanel') ?? new THREE.MeshPhysicalMaterial({
            color: 0x1a237e, metalness: 0.1, roughness: 0.6,
        });
        this.panelBackMaterial = ctx.getMaterial('solarPanelBack') ?? new THREE.MeshPhysicalMaterial({
            color: 0xcccccc, metalness: 0.3, roughness: 0.7,
        });
        this.strutMaterial = ctx.getMaterial('solarMast') ?? ctx.getMaterial('truss');

        const halfW = ctx.boxWidth / 2;
        if (this.placement === 'right' || this.placement === 'both') {
            this.wings.push(this.buildWing(ctx, +1, halfW));
        }
        if (this.placement === 'left' || this.placement === 'both') {
            this.wings.push(this.buildWing(ctx, -1, halfW));
        }

        if (this.startDeployed) {
            this.state = 'deployed';
            this.progress = 1;
            this.applyPose(1);
            this.syncColliders();
        } else {
            this.state = 'stowed';
            this.progress = 0;
            this.applyPose(0);
        }

        return { mass: this.computeMass(), colliderHandles: this.colliderHandles };
    }

    update(dt: number): void {
        if (this.state === 'deploying') {
            const step = this._deployDuration > 0 ? dt / this._deployDuration : 1;
            this.progress = Math.min(this.progress + step, 1);
            this.applyPose(this.progress);
            this.applyGradualMomentumConservation();
            if (this.progress >= 1) {
                this.state = 'deployed';
                this.syncColliders();
                this.storedL = null; // done animating
            }
        } else if (this.state === 'retracting') {
            if (this.colliderHandles.length > 0) this.removeCollidersRaw();
            const step = this._deployDuration > 0 ? dt / this._deployDuration : 1;
            this.progress = Math.max(this.progress - step, 0);
            this.applyPose(this.progress);
            this.applyGradualMomentumConservation();
            if (this.progress <= 0) {
                this.state = 'stowed';
                this.storedL = null; // done animating
            }
        }
    }

    cleanup(): void {
        this.removeCollidersRaw();
        for (const wing of this.wings) {
            if (this.box) this.box.remove(wing.group);
            wing.boom.geometry.dispose();
            wing.joint.geometry.dispose();
            wing.baseStrut.geometry.dispose();
            for (const strut of wing.struts) strut.geometry.dispose();
        }
        this.panelGeometry?.dispose();
        this.wings = [];
        this.panelGeometry = null;
        this.box = null;
        this.physics = null;
        this.rigid = null;
    }

    rebuild(ctx: ModuleBuildContext): ModuleBuildResult {
        this.cleanup();
        return this.build(ctx);
    }

    // ── Public API ──────────────────────────────────────────────

    deploy(): void {
        if (this.state === 'stowed' || this.state === 'retracting') {
            this.captureAngularMomentum();
            this.state = 'deploying';
        }
    }

    retract(): void {
        if (this.state === 'deployed' || this.state === 'deploying') {
            this.captureAngularMomentum();
            this.state = 'retracting';
        }
    }

    isDeployed(): boolean { return this.state === 'deployed'; }
    isStowed(): boolean { return this.state === 'stowed'; }
    getState(): DeployState { return this.state; }
    getProgress(): number { return this.progress; }

    // ── Angular momentum conservation ─────────────────────────

    /** Stored angular momentum (body-local frame) captured at animation start. */
    private storedL: THREE.Vector3 | null = null;
    /** Base inertia (without panel colliders) captured at animation start. */
    private baseInertia: { x: number; y: number; z: number } | null = null;
    /** Panel inertia contribution when fully deployed, captured at animation start. */
    private panelInertiaContrib: { x: number; y: number; z: number } | null = null;

    /**
     * Capture angular momentum at the start of deploy/retract.
     * L = I · ω (in body-local frame) is conserved throughout the animation.
     */
    private captureAngularMomentum(): void {
        if (!this.rigid) return;

        const inertia = this.readInertia();
        if (!inertia) return;

        // Get ω in body-local frame
        const av = this.rigid.getAngularVelocity();
        const q = this.rigid.getQuaternion();
        _quat.set(q.x, q.y, q.z, q.w);
        const invQ = _quat.clone().invert();
        const avLocal = new THREE.Vector3(av.x, av.y, av.z).applyQuaternion(invQ);

        // L = I · ω (per axis in principal frame)
        this.storedL = new THREE.Vector3(
            inertia.x * avLocal.x,
            inertia.y * avLocal.y,
            inertia.z * avLocal.z,
        );

        // We need both base inertia (no panels) and deployed inertia (with panels).
        // Temporarily add/remove colliders to measure both states.
        const hadColliders = this.colliderHandles.length > 0;

        // 1. Get base inertia (without panel colliders)
        if (hadColliders) this.removeCollidersRaw();
        const base = this.readInertia();
        this.baseInertia = base ? { ...base } : inertia;

        // 2. Temporarily add deployed colliders to measure full inertia
        this.addDeployedColliders();
        const full = this.readInertia();
        this.removeCollidersRaw(); // clean up temp colliders

        // 3. Panel contribution = full - base
        if (full) {
            this.panelInertiaContrib = {
                x: Math.max(full.x - this.baseInertia.x, 0),
                y: Math.max(full.y - this.baseInertia.y, 0),
                z: Math.max(full.z - this.baseInertia.z, 0),
            };
        } else {
            this.panelInertiaContrib = { x: 0, y: 0, z: 0 };
        }
    }

    /** Add colliders at fully deployed positions (for inertia measurement). */
    private addDeployedColliders(): void {
        if (!this.physics?.attachBoxCollider || !this.rigid) return;
        const halfPW = this._panelWidth / 2;
        const halfPT = this._panelThickness / 2;
        const halfPD = this.panelDepth / 2;
        // Compute deployed panel positions (same as applyPose(1))
        for (const wing of this.wings) {
            const { group } = wing;
            let hingeX = this._boomLength;
            for (let i = 0; i < this._panelCount; i++) {
                const cx = hingeX + this._panelWidth / 2;
                const localX = group.position.x + wing.sign * cx;
                const handle = this.physics.attachBoxCollider(
                    this.rigid,
                    { x: halfPW, y: halfPT, z: halfPD },
                    {
                        translation: { x: localX, y: group.position.y, z: 0 },
                        density: SOLAR_PANEL_COLLIDER_DENSITY,
                    },
                );
                if (handle != null) this.colliderHandles.push(handle);
                hingeX += this._panelWidth + this._panelGap;
            }
        }
    }

    /**
     * Apply angular momentum conservation for the current animation progress.
     * Effective inertia = base + progress² × panelContrib
     * (squared because inertia scales with distance², and distance scales with progress)
     */
    private applyGradualMomentumConservation(): void {
        if (!this.storedL || !this.baseInertia || !this.panelInertiaContrib || !this.rigid) return;

        const t2 = this.progress * this.progress; // inertia ~ distance² ~ progress²
        const iEff = {
            x: this.baseInertia.x + t2 * this.panelInertiaContrib.x,
            y: this.baseInertia.y + t2 * this.panelInertiaContrib.y,
            z: this.baseInertia.z + t2 * this.panelInertiaContrib.z,
        };

        const e = 1e-8;
        const avLocal = new THREE.Vector3(
            iEff.x > e ? this.storedL.x / iEff.x : 0,
            iEff.y > e ? this.storedL.y / iEff.y : 0,
            iEff.z > e ? this.storedL.z / iEff.z : 0,
        );

        // Transform back to world frame
        const q = this.rigid.getQuaternion();
        _quat.set(q.x, q.y, q.z, q.w);
        avLocal.applyQuaternion(_quat);

        this.rigid.setAngularVelocity({ x: avLocal.x, y: avLocal.y, z: avLocal.z });
    }

    // ── Physics colliders ───────────────────────────────────────

    /**
     * Read principal inertia from the Rapier rigid body.
     * Calls recomputeMassPropertiesFromColliders() to get current values.
     */
    private readInertia(): { x: number; y: number; z: number } | null {
        if (!this.rigid) return null;
        try {
            const native = this.rigid.getNative<any>();
            native?.recomputeMassPropertiesFromColliders?.();
            const i = native?.principalInertia?.();
            return i ? { x: i.x, y: i.y, z: i.z } : null;
        } catch { return null; }
    }

    private syncColliders(): void {
        this.removeCollidersRaw();
        if (!this.physics?.attachBoxCollider || !this.rigid) return;

        const halfPW = this._panelWidth / 2;
        const halfPT = this._panelThickness / 2;
        const halfPD = this.panelDepth / 2;

        for (const wing of this.wings) {
            const { panels, group } = wing;
            for (const panel of panels) {
                const localX = group.position.x + panel.position.x;
                const localY = group.position.y + panel.position.y;
                const localZ = group.position.z + panel.position.z;

                _euler.set(panel.rotation.x, panel.rotation.y, panel.rotation.z);
                _quat.setFromEuler(_euler);

                const handle = this.physics.attachBoxCollider(
                    this.rigid,
                    { x: halfPW, y: halfPT, z: halfPD },
                    {
                        translation: { x: localX, y: localY, z: localZ },
                        rotation: { x: _quat.x, y: _quat.y, z: _quat.z, w: _quat.w },
                        density: SOLAR_PANEL_COLLIDER_DENSITY,
                        friction: 0.4,
                        restitution: 0.1,
                    },
                );
                if (handle != null) this.colliderHandles.push(handle);
            }
        }

    }

    /** Remove colliders without momentum conservation (used internally). */
    private removeCollidersRaw(): void {
        if (this.physics?.removeCollider) {
            for (const h of this.colliderHandles) this.physics.removeCollider(h);
        }
        this.colliderHandles = [];
    }

    // ── Geometry ─────────────────────────────────────────────────

    /** Width of the stacked panel bundle when fully stowed. */
    get stackedWidth(): number {
        return this._panelCount * this._panelThickness;
    }

    private buildWing(ctx: ModuleBuildContext, sign: number, halfW: number): Wing {
        const group = new THREE.Group();
        group.name = `solarWing_${sign > 0 ? 'right' : 'left'}`;
        // Vertical offset based on placement
        const halfH = ctx.boxHeight / 2;
        const yOffset = this._verticalPosition === 'top' ? halfH
            : this._verticalPosition === 'bottom' ? -halfH
            : 0;
        group.position.set(sign * halfW, yOffset, 0);
        ctx.box.add(group);

        const halfDepth = this.panelDepth / 2;
        const r = this._strutRadius;
        const jointRadius = r * 2.5;

        // ── Boom: cylinder from hull face outward ──
        const boomGeom = new THREE.CylinderGeometry(r, r, this._boomLength, 8);
        boomGeom.rotateZ(Math.PI / 2); // align along X
        const boom = new THREE.Mesh(boomGeom, this.strutMaterial!);
        boom.name = 'solarBoom';
        boom.castShadow = true;
        boom.receiveShadow = true;
        boom.position.set(sign * this._boomLength / 2, 0, 0);
        group.add(boom);

        // ── Joint: sphere at boom tip ──
        const jointGeom = new THREE.SphereGeometry(jointRadius, 12, 8);
        const joint = new THREE.Mesh(jointGeom, this.strutMaterial!);
        joint.name = 'solarJoint';
        joint.castShadow = true;
        joint.receiveShadow = true;
        joint.position.set(sign * this._boomLength, 0, 0);
        group.add(joint);

        // ── Base cross-strut: connects the two parallel struts along Z at the boom tip ──
        const baseStrutLength = this.panelDepth; // spans full panel depth
        const baseStrutGeom = new THREE.CylinderGeometry(r, r, baseStrutLength, 8);
        // CylinderGeometry default axis is Y; no rotation needed — Z cross-strut rotates X→Z
        baseStrutGeom.rotateX(Math.PI / 2); // align along Z
        const baseStrut = new THREE.Mesh(baseStrutGeom, this.strutMaterial!);
        baseStrut.name = 'solarBaseStrut';
        baseStrut.castShadow = true;
        baseStrut.receiveShadow = true;
        baseStrut.position.set(sign * this._boomLength, 0, 0);
        group.add(baseStrut);

        // ── Two parallel struts at ±Z edges ──
        // Built at deployed length; applyPose will scale + offset them past the boom.
        const deployedSpan = this.span;
        const struts: THREE.Mesh[] = [];
        for (const zSign of [+1, -1]) {
            const strutGeom = new THREE.CylinderGeometry(r, r, deployedSpan, 8);
            strutGeom.rotateZ(Math.PI / 2); // align along X
            const strut = new THREE.Mesh(strutGeom, this.strutMaterial!);
            strut.name = `solarStrut_${zSign > 0 ? 'top' : 'bot'}`;
            strut.castShadow = true;
            strut.receiveShadow = true;
            strut.position.set(sign * (this._boomLength + deployedSpan / 2), 0, zSign * halfDepth);
            group.add(strut);
            struts.push(strut);
        }

        // ── Panels ──
        const panels: THREE.Mesh[] = [];
        for (let i = 0; i < this._panelCount; i++) {
            const panelMats = [
                this.panelMaterial!, this.panelMaterial!, // ±X
                this.panelMaterial!, this.panelBackMaterial!, // ±Y (top=solar, bottom=back)
                this.panelMaterial!, this.panelMaterial!, // ±Z
            ];
            const panel = new THREE.Mesh(this.panelGeometry!, panelMats);
            panel.name = `solarPanel_${i}`;
            panel.castShadow = true;
            panel.receiveShadow = true;
            group.add(panel);
            panels.push(panel);
        }

        return { group, boom, joint, baseStrut, struts, panels, sign };
    }

    /**
     * Scissor-fold with connected hinge chain.
     *
     * Each panel is hinged at its inner edge, connected to the previous
     * panel's outer edge. We walk the chain tracking both X and Y:
     *
     *   hinge[0] = (0, 0)  — hull face
     *   Panel i: angle = scissorSign × θ
     *     center = hinge[i] + (w/2·cosA, w/2·sinA)
     *     hinge[i+1] = hinge[i] + (w·cosA, w·sinA) + thickness clearance
     *
     * At θ=90° (stowed): panels stack vertically, offset by thickness in X.
     * At θ=0° (deployed): panels lie flat, spread along X.
     *
     * Strut scale on X axis (geometry was pre-rotated to align along X).
     */
    private applyPose(t: number): void {
        const deployedSpan = this.span;
        const w = this._panelWidth;
        const th = this._panelThickness;
        const gap = this._panelGap;

        // Fold angle: stowedAngle at t=0 → deployedAngle at t=1
        const theta = this._stowedAngle + (this._deployedAngle - this._stowedAngle) * t;

        for (const wing of this.wings) {
            const { sign, struts, panels } = wing;

            // Walk the connected hinge chain — starts after the boom
            let hingeX = this._boomLength;
            let hingeY = 0;

            for (let i = 0; i < panels.length; i++) {
                const panel = panels[i];
                const scissorSign = (i % 2 === 0) ? 1 : -1;
                const angle = scissorSign * theta;
                const cosA = Math.cos(angle);
                const sinA = Math.sin(angle);

                // Panel center = hinge + half panel width along its direction
                const cx = hingeX + (w / 2) * cosA;
                const cy = hingeY + (w / 2) * sinA;

                panel.position.set(sign * cx, cy, 0);
                panel.rotation.set(0, 0, sign * angle);

                // Advance to next hinge: outer edge of this panel
                hingeX += w * cosA;
                hingeY += w * sinA;

                // Thickness clearance in X (prevents overlap when folded)
                hingeX += th * Math.abs(sinA);

                // Gap between panels (fades in as panels flatten)
                hingeX += gap * t;

                panel.visible = true;
            }

            // Struts: span from boom tip to chain end
            const chainExtent = Math.max(hingeX - this._boomLength, 0.001);
            const scaleRatio = deployedSpan > 0 ? chainExtent / deployedSpan : 0.001;
            const strutCenterX = this._boomLength + chainExtent / 2;
            for (const strut of struts) {
                strut.scale.set(scaleRatio || 0.001, 1, 1);  // X = length axis
                strut.position.x = sign * strutCenterX;
            }
        }
    }

    private computeMass(): number {
        const wingCount = this._placement === 'both' ? 2 : 1;
        const totalSpan = this.span;
        const r = this._strutRadius;
        const wallT = 0.001; // 1mm wall thickness for hollow tubes
        const innerR = Math.max(r - wallT, 0);
        const tubeArea = Math.PI * (r ** 2 - innerR ** 2); // cross-section area
        // Boom (hollow tube)
        const boomMass = ALUMINUM_DENSITY * tubeArea * this._boomLength;
        // 2 struts per wing (hollow tubes)
        const strutMass = ALUMINUM_DENSITY * tubeArea * totalSpan * 2;
        // Panels (surface density: ~2 kg/m²)
        const panelArea = this._panelWidth * this.panelDepth;
        const panelMass = SOLAR_CELL_DENSITY_MASS * panelArea * this._panelCount;
        return (boomMass + strutMass + panelMass) * wingCount;
    }
}
