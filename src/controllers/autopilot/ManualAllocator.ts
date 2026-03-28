import * as THREE from 'three';
import type { AutopilotConfig } from './types';
import type { Spacecraft } from '../../core/spacecraft';
import type { ThrusterGroups } from '../../config/spacecraftConfig';
import { CapabilityCalculator } from './CapabilityCalculator';
import { ThrusterAllocator } from './ThrusterAllocator';

/**
 * Allocates manual control inputs to thrusters using the same distribution
 * rules as the autopilot modes — without requiring PID or mode machinery.
 */
export class ManualAllocator {
    private capCalc: CapabilityCalculator;
    private allocator: ThrusterAllocator;

    constructor(
        spacecraft: Spacecraft,
        config: AutopilotConfig,
        thrusterGroups: ThrusterGroups,
        thrust: number,
        thrusterMax?: number[],
    ) {
        const max = (thrusterMax && thrusterMax.length === 24) ? thrusterMax.slice(0, 24) : new Array(24).fill(thrust);
        this.capCalc = new CapabilityCalculator(spacecraft as any, config, thrusterGroups, thrust, max);
        this.allocator = new ThrusterAllocator(thrusterGroups, thrust, max, config.limits.epsilon, () => this.capCalc.getDynamicCaps());
    }

    public setThrust(value: number): void {
        this.capCalc.setThrust(value);
        this.allocator.setThrust(value);
    }

    public setThrusterGroups(groups: ThrusterGroups): void {
        this.capCalc.setThrusterGroups(groups);
        this.allocator.setThrusterGroups(groups);
    }

    public setThrusterMax(max: number[]): void {
        const arr = (Array.isArray(max) && max.length === 24) ? max.slice(0, 24) : new Array(24).fill(0);
        this.capCalc.setThrusterMax(arr);
        this.allocator.setThrusterMax(arr);
    }

    public invalidateCaps(): void {
        this.capCalc.invalidate();
    }

    public allocateTranslation(localForce: THREE.Vector3, out?: number[]): number[] {
        const arr = out ?? new Array(24).fill(0);
        if (out) for (let i = 0; i < 24; i++) arr[i] = 0;
        this.allocator.allocateTranslation(localForce, arr);
        return arr;
    }

    public allocateRotation(rotCmd: THREE.Vector3, out?: number[]): number[] {
        const arr = out ?? new Array(24).fill(0);
        if (out) for (let i = 0; i < 24; i++) arr[i] = 0;
        this.allocator.allocateRotation(rotCmd, arr);
        return arr;
    }
}
