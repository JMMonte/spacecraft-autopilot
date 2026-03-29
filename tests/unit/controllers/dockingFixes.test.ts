import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import * as THREE from 'three';
import { DockingController } from '../../../src/controllers/docking/DockingController';
import { DockingOrchestrator } from '../../../src/core/DockingOrchestrator';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRegistry() {
    return {
        getSpacecraftList: () => [] as any[],
        getAsteroidObstacles: () => [],
        onSpacecraftListChanged: () => () => {},
    };
}

function makeMockSpacecraft(name: string, opts?: {
    ports?: Record<string, { isOccupied: boolean; dockedTo: any }>;
}) {
    const ports = opts?.ports ?? {
        front: { isOccupied: false, dockedTo: null },
        back: { isOccupied: false, dockedTo: null },
    };
    const registry = makeRegistry();
    return {
        uuid: `uuid-${name}`,
        name,
        registry,
        basicWorld: null,
        dockingPorts: ports,
        dockingController: null as any,
        spacecraftController: null,
        objects: {
            dockingPortRadius: 0.3,
            dockingPortLength: 0.07,
            dockingPortDepth: 0.3,
            boxDepth: 2,
            box: new THREE.Object3D(),
            rigid: null,
        },
        getWorldPosition: () => new THREE.Vector3(),
        getWorldVelocity: () => new THREE.Vector3(),
        getWorldAngularVelocity: () => new THREE.Vector3(),
        getWorldOrientation: () => new THREE.Quaternion(),
        getFullDimensions: () => new THREE.Vector3(1, 1, 2),
        getMainBodyDimensions: () => new THREE.Vector3(1, 1, 2),
        getDockingPortWorldDirection: () => new THREE.Vector3(0, 0, 1),
        getDockingPortWorldPosition: () => new THREE.Vector3(),
        getDockingPortLocalDirection: () => new THREE.Vector3(0, 0, 1),
        getCompoundMembers: () => [],
        dock: () => false,
        undock: () => false,
    } as any;
}

// ─── DockingController port validation ────────────────────────────────────────

describe('DockingController port validation', () => {
    test('startDocking rejects when our port is occupied', () => {
        const source = makeMockSpacecraft('Source', {
            ports: {
                front: { isOccupied: true, dockedTo: {} },
                back: { isOccupied: false, dockedTo: null },
            },
        });
        const target = makeMockSpacecraft('Target');
        const dc = new DockingController(source, new THREE.Scene());

        dc.startDocking(target, 'front' as any, 'front' as any);

        // Should NOT have started docking because our front port is occupied
        assert.equal(dc.isDocking(), false);
        assert.equal(dc.getDockingPhase(), 'idle');
    });

    test('startDocking rejects when target port is occupied', () => {
        const source = makeMockSpacecraft('Source');
        const target = makeMockSpacecraft('Target', {
            ports: {
                front: { isOccupied: true, dockedTo: {} },
                back: { isOccupied: false, dockedTo: null },
            },
        });
        const dc = new DockingController(source, new THREE.Scene());

        dc.startDocking(target, 'front' as any, 'front' as any);

        assert.equal(dc.isDocking(), false);
        assert.equal(dc.getDockingPhase(), 'idle');
    });

    test('startDocking rejects when port ID does not exist', () => {
        const source = makeMockSpacecraft('Source');
        const target = makeMockSpacecraft('Target');
        const dc = new DockingController(source, new THREE.Scene());

        dc.startDocking(target, 'nonexistent' as any, 'front' as any);

        assert.equal(dc.isDocking(), false);
    });

    test('startDocking proceeds when both ports are free', () => {
        const source = makeMockSpacecraft('Source');
        const target = makeMockSpacecraft('Target');
        const dc = new DockingController(source, new THREE.Scene());

        dc.startDocking(target, 'front' as any, 'back' as any);

        assert.equal(dc.isDocking(), true);
        assert.equal(dc.getDockingPhase(), 'approach');
    });
});

// ─── DockingOrchestrator enable/disable ───────────────────────────────────────

describe('DockingOrchestrator enable/disable', () => {
    test('enabled by default', () => {
        const orch = new DockingOrchestrator();
        assert.equal(orch.enabled, true);
    });

    test('setEnabled(false) prevents passive docking', () => {
        const orch = new DockingOrchestrator();
        orch.setEnabled(false);
        assert.equal(orch.enabled, false);

        // Should be a no-op when disabled — even with spacecraft that could dock
        // (we just verify it doesn't throw and returns without changes)
        orch.performPassiveDocking([]);
    });

    test('setEnabled(true) restores passive docking', () => {
        const orch = new DockingOrchestrator();
        orch.setEnabled(false);
        orch.setEnabled(true);
        assert.equal(orch.enabled, true);
    });
});
