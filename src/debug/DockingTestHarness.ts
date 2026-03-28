/**
 * DockingTestHarness — Text-based live testing for the docking system.
 *
 * Exposed on `window.__dockingTest` so it can be driven via console or
 * preview_eval() without relying on screenshots.
 *
 * Usage:
 *   __dockingTest.setup()          — positions two spacecraft for a docking scenario
 *   __dockingTest.start()          — initiates docking from active craft to target
 *   __dockingTest.status()         — returns JSON telemetry string
 *   __dockingTest.poll(intervalMs) — starts auto-logging to console
 *   __dockingTest.stopPoll()       — stops auto-logging
 *   __dockingTest.cancel()         — cancels active docking
 *   __dockingTest.reset()          — resets spacecraft to initial positions
 */

import * as THREE from 'three';
import type { BasicWorld } from '../core/BasicWorld';
import type { Spacecraft } from '../core/spacecraft';

/** Set position/orientation/velocity on a spacecraft, going through physics engine if available. */
function teleport(
    craft: Spacecraft,
    pos: THREE.Vector3,
    quat: THREE.Quaternion,
    vel?: THREE.Vector3,
    angVel?: THREE.Vector3,
): void {
    const rigid = craft.objects.rigid;
    if (rigid) {
        rigid.setPosition(pos.x, pos.y, pos.z);
        rigid.setQuaternion(quat.x, quat.y, quat.z, quat.w);
        rigid.setLinearVelocity(vel ?? { x: 0, y: 0, z: 0 });
        rigid.setAngularVelocity(angVel ?? { x: 0, y: 0, z: 0 });
    }
    // Also sync Three.js side immediately so getWorldPosition() reads correct values this frame
    craft.objects.box.position.copy(pos);
    craft.objects.box.quaternion.copy(quat);
    craft.objects.boxBody.velocity.set(vel?.x ?? 0, vel?.y ?? 0, vel?.z ?? 0);
    craft.objects.boxBody.angularVelocity.set(angVel?.x ?? 0, angVel?.y ?? 0, angVel?.z ?? 0);
}

export interface DockingTestStatus {
    phase: string;
    range: number | null;
    closingSpeed: number | null;
    portAlignment: number | null;
    rollError: number | null;
    lateralOffsetX: number | null;
    lateralOffsetY: number | null;
    ourSpeed: number;
    ourAngVel: number;
    targetSpeed: number;
    targetAngVel: number;
    relativeSpeed: number;
    distance: number;
    autopilotModes: Record<string, boolean> | null;
    elapsed: number;
    ourPos: { x: number; y: number; z: number };
    targetPos: { x: number; y: number; z: number };
    ourQuat: { x: number; y: number; z: number; w: number };
    targetQuat: { x: number; y: number; z: number; w: number };
}

interface SetupOptions {
    distance?: number;          // initial separation (default 15)
    ourPort?: 'front' | 'back'; // default 'front'
    targetPort?: 'front' | 'back'; // default 'back'
    lateralOffset?: { x: number; y: number }; // offset perpendicular to approach axis
    angleOffset?: number;       // initial yaw offset in degrees
}

/** Continuous monitor entry — logged every frame, significant events flagged. */
interface MonitorEntry {
    t: number;                  // seconds since start
    phase: string;
    centerDist: number;         // center-to-center distance
    hullClearance: number;      // hull-to-hull (negative = overlap)
    speed: number;              // relative speed
    portErr: number | null;     // port alignment error deg
    collision: boolean;         // hull overlap detected
    event?: string;             // phase change, collision start/end, etc.
}

/** Summary of a completed or ongoing monitor run. */
interface MonitorSummary {
    running: boolean;
    totalFrames: number;
    elapsedSec: number;
    minHullClearance: number;   // minimum hull-to-hull distance observed
    minClearanceTime: number;   // when it occurred (sec)
    collisionFrames: number;    // number of frames with hull overlap
    collisionEvents: number;    // number of distinct collision events (enter/exit)
    phaseTimeline: Array<{ phase: string; startSec: number }>;
    currentPhase: string;
    ourRadius: number;          // bounding radius of active craft
    targetRadius: number;       // bounding radius of target craft
    events: MonitorEntry[];     // significant events only
}

export class DockingTestHarness {
    private world: BasicWorld;
    private activeCraft: Spacecraft | null = null;
    private targetCraft: Spacecraft | null = null;
    private startTime: number = 0;
    private pollTimer: ReturnType<typeof setInterval> | null = null;
    private ourPort: 'front' | 'back' = 'front';
    private targetPort: 'front' | 'back' = 'back';

    // --- Continuous monitor state ---
    private monitorRafId: number | null = null;
    private monitorEntries: MonitorEntry[] = [];   // significant events only
    private monitorFrameCount: number = 0;
    private monitorMinClearance: number = Infinity;
    private monitorMinClearanceTime: number = 0;
    private monitorCollisionFrames: number = 0;
    private monitorCollisionEvents: number = 0;
    private monitorInCollision: boolean = false;
    private monitorLastPhase: string = '';
    private monitorPhaseTimeline: Array<{ phase: string; startSec: number }> = [];

    constructor(world: BasicWorld) {
        this.world = world;
    }

    /** Bounding radius for a spacecraft (max half-extent — sphere approx for display). */
    private craftRadius(craft: Spacecraft): number {
        const dims = craft.getFullDimensions();
        return Math.max(dims.x, dims.y, dims.z);
    }

    /**
     * Axis-aligned box overlap check between two spacecraft.
     * Uses world-space AABB (ignoring rotation) which is an approximation but
     * much tighter than bounding spheres for elongated craft.
     * Returns negative clearance = overlap depth, positive = gap.
     */
    private hullClearance(a: Spacecraft, b: Spacecraft): { centerDist: number; clearance: number } {
        const posA = a.getWorldPosition();
        const posB = b.getWorldPosition();
        const centerDist = posA.distanceTo(posB);

        // Use OBB-inspired approach: project the center-to-center vector
        // onto each axis and compare with combined half-extents along that axis.
        // For axis-aligned boxes this is exact; for rotated boxes it's approximate
        // but much better than bounding spheres.
        const dimsA = a.getMainBodyDimensions(); // half-extents
        const dimsB = b.getMainBodyDimensions();
        const dx = Math.abs(posA.x - posB.x);
        const dy = Math.abs(posA.y - posB.y);
        const dz = Math.abs(posA.z - posB.z);
        // Per-axis overlap (negative = gap on that axis)
        const overlapX = (dimsA.x + dimsB.x) - dx;
        const overlapY = (dimsA.y + dimsB.y) - dy;
        const overlapZ = (dimsA.z + dimsB.z) - dz;
        // AABB collision only if overlapping on ALL axes
        if (overlapX > 0 && overlapY > 0 && overlapZ > 0) {
            // Overlap depth is the minimum penetration axis
            const clearance = -Math.min(overlapX, overlapY, overlapZ);
            return { centerDist, clearance };
        }
        // No overlap — clearance is distance between nearest faces
        const gapX = Math.max(0, dx - dimsA.x - dimsB.x);
        const gapY = Math.max(0, dy - dimsA.y - dimsB.y);
        const gapZ = Math.max(0, dz - dimsA.z - dimsB.z);
        const clearance = Math.sqrt(gapX * gapX + gapY * gapY + gapZ * gapZ);
        return { centerDist, clearance };
    }

    /**
     * Position two spacecraft for a docking test.
     * Active spacecraft faces the target at the given distance.
     */
    setup(opts?: SetupOptions): string {
        const distance = opts?.distance ?? 15;
        this.ourPort = opts?.ourPort ?? 'front';
        this.targetPort = opts?.targetPort ?? 'back';
        const lateral = opts?.lateralOffset ?? { x: 0, y: 0 };
        const angleDeg = opts?.angleOffset ?? 0;

        const list = this.world.getSpacecraftList();
        if (list.length < 2) {
            return JSON.stringify({ error: 'Need at least 2 spacecraft. Create one first.' });
        }

        this.activeCraft = this.world.getActiveSpacecraft();
        this.targetCraft = list.find(s => s !== this.activeCraft) ?? list[1];

        if (!this.activeCraft || !this.targetCraft) {
            return JSON.stringify({ error: 'Could not resolve spacecraft pair.' });
        }

        // Position target at origin, facing +Z
        teleport(
            this.targetCraft,
            new THREE.Vector3(0, 0, 0),
            new THREE.Quaternion(0, 0, 0, 1),
        );

        // Compute placement so the two ports face each other.
        // Target port outward direction in world space (target at identity quat)
        const targetPortWorldDir = new THREE.Vector3(0, 0, this.targetPort === 'front' ? 1 : -1);

        // Place active craft along that direction, at `distance` from target
        const activePos = targetPortWorldDir.clone().multiplyScalar(distance);
        activePos.x += lateral.x;
        activePos.y += lateral.y;

        // Orient active craft so OUR port faces back toward target
        const ourPortLocalDir = new THREE.Vector3(0, 0, this.ourPort === 'front' ? 1 : -1);
        const desiredPortDir = targetPortWorldDir.clone().negate(); // face opposite to target port
        const q = new THREE.Quaternion().setFromUnitVectors(ourPortLocalDir, desiredPortDir);

        // Apply optional yaw offset
        if (angleDeg !== 0) {
            const angleRad = (angleDeg * Math.PI) / 180;
            const yawQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angleRad);
            q.premultiply(yawQ);
        }

        teleport(this.activeCraft, activePos, q);

        // Reset any existing autopilot state
        const ap = this.activeCraft.spacecraftController?.autopilot;
        if (ap) {
            ap.resetAllModes();
            ap.setReferenceObject(null);
        }

        this.startTime = 0;

        return JSON.stringify({
            ok: true,
            active: this.activeCraft.name,
            target: this.targetCraft.name,
            distance,
            ourPort: this.ourPort,
            targetPort: this.targetPort,
            activePos: this.v3(this.activeCraft.getWorldPosition()),
            targetPos: this.v3(this.targetCraft.getWorldPosition()),
        });
    }

    /** Start the docking sequence. */
    start(): string {
        if (!this.activeCraft || !this.targetCraft) {
            return JSON.stringify({ error: 'Call setup() first.' });
        }

        const dc = this.activeCraft.dockingController;
        if (!dc) {
            return JSON.stringify({ error: 'No docking controller on active spacecraft.' });
        }

        this.startTime = performance.now();
        // Auto-start continuous monitor
        this.startMonitor();
        dc.startDocking(this.targetCraft, this.ourPort, this.targetPort);

        return JSON.stringify({
            ok: true,
            phase: dc.getDockingPhase(),
            started: true,
            monitor: 'auto-started',
        });
    }

    /** Get current docking telemetry as a JSON string. */
    status(): string {
        if (!this.activeCraft || !this.targetCraft) {
            return JSON.stringify({ error: 'No active test. Call setup() first.' });
        }

        const dc = this.activeCraft.dockingController;
        if (!dc) {
            return JSON.stringify({ error: 'No docking controller.' });
        }

        const elapsed = this.startTime > 0 ? (performance.now() - this.startTime) / 1000 : 0;

        const ourPos = this.activeCraft.getWorldPosition();
        const targetPos = this.targetCraft.getWorldPosition();
        const ourVel = this.activeCraft.getWorldVelocity();
        const targetVel = this.targetCraft.getWorldVelocity();
        const relVel = new THREE.Vector3().subVectors(ourVel, targetVel);

        const alignInfo = dc.getPortAlignmentInfo();
        const apModes = this.activeCraft.spacecraftController?.autopilot?.getActiveAutopilots() ?? null;

        const result: DockingTestStatus = {
            phase: dc.getDockingPhase(),
            range: dc.getRange(),
            closingSpeed: dc.getClosingSpeed(),
            portAlignment: alignInfo?.portAlignmentError ?? null,
            rollError: alignInfo?.rollError ?? null,
            lateralOffsetX: alignInfo?.lateralOffset.x ?? null,
            lateralOffsetY: alignInfo?.lateralOffset.y ?? null,
            ourSpeed: ourVel.length(),
            ourAngVel: this.activeCraft.getWorldAngularVelocity().length(),
            targetSpeed: targetVel.length(),
            targetAngVel: this.targetCraft.getWorldAngularVelocity().length(),
            relativeSpeed: relVel.length(),
            distance: ourPos.distanceTo(targetPos),
            autopilotModes: apModes ?? null,
            elapsed,
            ourPos: this.v3(ourPos),
            targetPos: this.v3(targetPos),
            ourQuat: this.q4(this.activeCraft.getWorldOrientation()),
            targetQuat: this.q4(this.targetCraft.getWorldOrientation()),
        };

        return JSON.stringify(result, null, 2);
    }

    /** Compact one-line status for polling. */
    statusLine(): string {
        if (!this.activeCraft || !this.targetCraft) return 'NO_TEST';

        const dc = this.activeCraft.dockingController;
        if (!dc) return 'NO_DC';

        const elapsed = this.startTime > 0 ? ((performance.now() - this.startTime) / 1000).toFixed(1) : '0';
        const phase = dc.getDockingPhase();
        const range = dc.getRange()?.toFixed(3) ?? '?';
        const speed = dc.getClosingSpeed()?.toFixed(4) ?? '?';
        const align = dc.getPortAlignmentInfo();
        const portErr = align?.portAlignmentError?.toFixed(1) ?? '?';
        const rollErr = align?.rollError?.toFixed(1) ?? '?';
        const latX = align?.lateralOffset.x?.toFixed(3) ?? '?';
        const latY = align?.lateralOffset.y?.toFixed(3) ?? '?';
        const vel = this.activeCraft.getWorldVelocity().length().toFixed(3);
        const angVel = this.activeCraft.getWorldAngularVelocity().length().toFixed(4);

        return `t=${elapsed}s phase=${phase} range=${range}m spd=${speed}m/s portErr=${portErr}° roll=${rollErr}° lat=(${latX},${latY})m v=${vel} w=${angVel}`;
    }

    /** Start polling status to console at given interval. */
    poll(intervalMs: number = 500): string {
        this.stopPoll();
        this.pollTimer = setInterval(() => {
            console.log('[DOCK]', this.statusLine());
        }, intervalMs);
        return 'Polling started at ' + intervalMs + 'ms';
    }

    /** Stop polling. */
    stopPoll(): void {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
    }

    /** Cancel active docking. */
    cancel(): string {
        this.stopMonitor();
        const dc = this.activeCraft?.dockingController;
        if (dc?.isDocking()) {
            dc.cancelDocking();
            return JSON.stringify({ ok: true, cancelled: true });
        }
        return JSON.stringify({ ok: false, reason: 'Not docking.' });
    }

    /** Reset spacecraft to setup positions (call setup() again). */
    reset(): string {
        // Undock first if physically docked (removes physics joint)
        if (this.activeCraft) {
            const dc = this.activeCraft.dockingController;
            if (dc?.getDockingPhase() === 'docked') {
                dc.undock();
            } else if (dc?.isDocking()) {
                dc.cancelDocking();
            }
            // Also check for passive docking (DockingOrchestrator may have docked them)
            try {
                (['front', 'back'] as const).forEach(port => {
                    if (this.activeCraft!.dockingPorts[port]?.isOccupied) {
                        this.activeCraft!.undock(port);
                    }
                });
            } catch {}
        }
        if (this.targetCraft) {
            try {
                (['front', 'back'] as const).forEach(port => {
                    if (this.targetCraft!.dockingPorts[port]?.isOccupied) {
                        this.targetCraft!.undock(port);
                    }
                });
            } catch {}
        }
        const ap = this.activeCraft?.spacecraftController?.autopilot;
        if (ap) {
            ap.setGoToSpeedLimit(null);
            ap.resetAllModes();
            ap.setEnabled(false);
        }
        return this.setup({ ourPort: this.ourPort, targetPort: this.targetPort });
    }

    /** Undock if currently docked. */
    undock(): string {
        const dc = this.activeCraft?.dockingController;
        if (dc) {
            dc.undock();
            return JSON.stringify({ ok: true });
        }
        return JSON.stringify({ error: 'No docking controller.' });
    }

    // ====================== CONTINUOUS MONITOR ======================

    /**
     * Start continuous per-frame monitoring.
     * Tracks hull clearance, collision events, and phase transitions.
     * Call monitorSummary() or monitorLog() to read results.
     */
    startMonitor(): string {
        if (this.monitorRafId !== null) this.stopMonitor();
        if (!this.activeCraft || !this.targetCraft) {
            return 'ERROR: call setup() first';
        }

        // Reset state
        this.monitorEntries = [];
        this.monitorFrameCount = 0;
        this.monitorMinClearance = Infinity;
        this.monitorMinClearanceTime = 0;
        this.monitorCollisionFrames = 0;
        this.monitorCollisionEvents = 0;
        this.monitorInCollision = false;
        this.monitorLastPhase = '';
        this.monitorPhaseTimeline = [];

        const tick = () => {
            this.monitorRafId = requestAnimationFrame(tick);
            this.monitorFrame();
        };
        this.monitorRafId = requestAnimationFrame(tick);

        const rA = this.craftRadius(this.activeCraft);
        const rB = this.craftRadius(this.targetCraft);
        return `Monitor started. ourRadius=${rA.toFixed(2)}m targetRadius=${rB.toFixed(2)}m combinedRadii=${(rA + rB).toFixed(2)}m`;
    }

    /** Stop monitoring. */
    stopMonitor(): void {
        if (this.monitorRafId !== null) {
            cancelAnimationFrame(this.monitorRafId);
            this.monitorRafId = null;
        }
    }

    /** Per-frame monitor tick. */
    private monitorFrame(): void {
        if (!this.activeCraft || !this.targetCraft) return;
        this.monitorFrameCount++;

        const elapsed = this.startTime > 0 ? (performance.now() - this.startTime) / 1000 : 0;
        const dc = this.activeCraft.dockingController;
        const phase = dc?.getDockingPhase() ?? 'none';

        const { centerDist, clearance } = this.hullClearance(this.activeCraft, this.targetCraft);
        const collision = clearance < 0;

        const relVel = new THREE.Vector3().subVectors(
            this.activeCraft.getWorldVelocity(),
            this.targetCraft.getWorldVelocity(),
        );
        const speed = relVel.length();

        const alignInfo = dc?.getPortAlignmentInfo();
        const portErr = alignInfo?.portAlignmentError ?? null;

        // Track min clearance
        if (clearance < this.monitorMinClearance) {
            this.monitorMinClearance = clearance;
            this.monitorMinClearanceTime = elapsed;
        }

        // Track collision frames
        if (collision) {
            this.monitorCollisionFrames++;
            if (!this.monitorInCollision) {
                // Collision just started
                this.monitorInCollision = true;
                this.monitorCollisionEvents++;
                this.logMonitorEvent(elapsed, phase, centerDist, clearance, speed, portErr, true,
                    `COLLISION START: hulls overlap by ${(-clearance).toFixed(3)}m`);
            }
        } else {
            if (this.monitorInCollision) {
                // Collision just ended
                this.monitorInCollision = false;
                this.logMonitorEvent(elapsed, phase, centerDist, clearance, speed, portErr, false,
                    `COLLISION END: clearance restored to ${clearance.toFixed(3)}m`);
            }
        }

        // Track phase changes
        if (phase !== this.monitorLastPhase) {
            this.monitorPhaseTimeline.push({ phase, startSec: elapsed });
            this.logMonitorEvent(elapsed, phase, centerDist, clearance, speed, portErr, collision,
                `PHASE: ${this.monitorLastPhase || 'none'} → ${phase}`);
            this.monitorLastPhase = phase;
        }

        // Log if clearance is very tight (< 0.5m) even without collision
        if (clearance >= 0 && clearance < 0.5 && this.monitorFrameCount % 30 === 0) {
            this.logMonitorEvent(elapsed, phase, centerDist, clearance, speed, portErr, false,
                `TIGHT: clearance=${clearance.toFixed(3)}m`);
        }
    }

    private logMonitorEvent(
        t: number, phase: string, centerDist: number, hullClearance: number,
        speed: number, portErr: number | null, collision: boolean, event: string,
    ): void {
        const entry: MonitorEntry = { t: +t.toFixed(2), phase, centerDist: +centerDist.toFixed(3), hullClearance: +hullClearance.toFixed(3), speed: +speed.toFixed(3), portErr: portErr !== null ? +portErr.toFixed(1) : null, collision, event };
        this.monitorEntries.push(entry);
        // Also log to console for visibility
        const tag = collision ? '🔴' : (hullClearance < 0.5 ? '🟡' : '🟢');
        console.log(`[MONITOR ${tag}] t=${t.toFixed(1)}s ${event} | center=${centerDist.toFixed(2)}m hull=${hullClearance.toFixed(3)}m v=${speed.toFixed(2)}m/s`);
    }

    /** Get summary of the monitor run. */
    monitorSummary(): string {
        const elapsed = this.startTime > 0 ? (performance.now() - this.startTime) / 1000 : 0;
        const summary: MonitorSummary = {
            running: this.monitorRafId !== null,
            totalFrames: this.monitorFrameCount,
            elapsedSec: +elapsed.toFixed(1),
            minHullClearance: +this.monitorMinClearance.toFixed(3),
            minClearanceTime: +this.monitorMinClearanceTime.toFixed(1),
            collisionFrames: this.monitorCollisionFrames,
            collisionEvents: this.monitorCollisionEvents,
            phaseTimeline: this.monitorPhaseTimeline,
            currentPhase: this.monitorLastPhase,
            ourRadius: this.activeCraft ? +this.craftRadius(this.activeCraft).toFixed(3) : 0,
            targetRadius: this.targetCraft ? +this.craftRadius(this.targetCraft).toFixed(3) : 0,
            events: this.monitorEntries,
        };
        return JSON.stringify(summary, null, 2);
    }

    /** Get just the event log as compact lines. */
    monitorLog(): string {
        return this.monitorEntries
            .map(e => `t=${e.t}s ${e.event ?? ''} | phase=${e.phase} hull=${e.hullClearance}m v=${e.speed}m/s`)
            .join('\n');
    }

    // ====================== HELPERS ======================

    // Helpers
    private v3(v: THREE.Vector3): { x: number; y: number; z: number } {
        return { x: +v.x.toFixed(4), y: +v.y.toFixed(4), z: +v.z.toFixed(4) };
    }
    private q4(q: THREE.Quaternion): { x: number; y: number; z: number; w: number } {
        return { x: +q.x.toFixed(4), y: +q.y.toFixed(4), z: +q.z.toFixed(4), w: +q.w.toFixed(4) };
    }
}

/**
 * Install the harness on `window.__dockingTest` once the world is ready.
 */
export function installDockingTestHarness(world: BasicWorld): DockingTestHarness {
    const harness = new DockingTestHarness(world);
    (window as any).__dockingTest = harness;
    return harness;
}
