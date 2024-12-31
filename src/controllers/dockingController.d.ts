import { Spacecraft } from '../core/spacecraft';

export declare class DockingController {
    constructor(spacecraft: Spacecraft);
    update(dt: number): void;
    cleanup(): void;
} 