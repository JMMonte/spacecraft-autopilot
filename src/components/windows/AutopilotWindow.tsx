import React, { useState, useEffect, useRef, ChangeEvent } from 'react';
import * as THREE from 'three';
import { Spacecraft } from '../../core/spacecraft';
import { SpacecraftController } from '../../controllers/spacecraftController';
import { BasicWorld } from '../../core/BasicWorld';
import { NumberInput } from '../ui/NumberInput';
import {
    INPUT_BASE, EMPTY_STATE, SECTION_HEADER, TOGGLE_GROUP, TOGGLE_STACK,
    TOGGLE_OPTION, TOGGLE_ACTIVE, TOGGLE_INACTIVE,
} from '../ui/styles';
import { useAutopilot } from '../../state/store';
import { TargetGizmo } from '../../scenes/objects/TargetGizmo';

interface AutopilotWindowProps {
    spacecraft: Spacecraft | null;
    controller: SpacecraftController | null;
    world: BasicWorld | null;
    version?: number;
}

interface TargetSettings {
    targetType: 'custom' | 'spacecraft';
    targetPoint: 'center' | 'front' | 'back';
    selectedSpacecraft: Spacecraft | null;
    customPosition: THREE.Vector3;
    customOrientation?: THREE.Quaternion;
}

interface TargetSettingsMap {
    [key: string]: TargetSettings;
}

type ModeKey = 'orientationMatch' | 'pointToPosition' | 'cancelRotation' | 'cancelLinearMotion' | 'goToPosition';

interface ModeButton {
    key: ModeKey;
    label: string;
    shortcut: string;
    description: string;
}

// Rotation group — mutually exclusive (pick at most one)
const ROTATION_MODES: ModeButton[] = [
    { key: 'orientationMatch', label: 'Match Orientation', shortcut: 'T', description: 'Matches orientation with target spacecraft (or reverses)' },
    { key: 'pointToPosition', label: 'Point to Position', shortcut: 'Y', description: 'Points spacecraft to target position' },
    { key: 'cancelRotation', label: 'Cancel Rotation', shortcut: 'R', description: 'Cancels all rotational movement' },
];

// Translation group — mutually exclusive (pick at most one)
const TRANSLATION_MODES: ModeButton[] = [
    { key: 'cancelLinearMotion', label: 'Cancel Velocity', shortcut: 'G', description: 'Cancels all linear movement' },
    { key: 'goToPosition', label: 'Go to Position', shortcut: 'B', description: 'Moves spacecraft to target position' },
];

export const AutopilotWindow: React.FC<AutopilotWindowProps> = ({ spacecraft, controller, world, version }) => {
    const apState = useAutopilot();
    const [targetSettings, setTargetSettings] = useState<TargetSettingsMap>({});
    const [targetType, setTargetType] = useState<'custom' | 'spacecraft'>('custom');
    const [targetPoint, setTargetPoint] = useState<'center' | 'front' | 'back'>('center');
    const [selectedSpacecraft, setSelectedSpacecraft] = useState<Spacecraft | null>(null);
    const [otherSpacecraft, setOtherSpacecraft] = useState<Spacecraft[]>([]);

    const autopilot = controller?.getAutopilot();
    const [apTelemetry, setApTelemetry] = useState<any | null>(null);
    const gizmoRef = useRef<TargetGizmo | null>(null);
    const [gizmoMode, setGizmoMode] = useState<'translate' | 'rotate'>('translate');

    // Update spacecraft list when version changes
    useEffect(() => {
        if (world && spacecraft) {
            setOtherSpacecraft(world.getSpacecraftList().filter(s => s !== spacecraft));
        }
    }, [world, spacecraft, version]);

    useEffect(() => {
        if (spacecraft?.name) {
            const savedSettings = targetSettings[spacecraft.name] || {
                targetType: 'custom',
                targetPoint: 'center',
                selectedSpacecraft: null,
                customPosition: autopilot?.getTargetPosition()?.clone() || new THREE.Vector3(),
                customOrientation: autopilot?.getTargetOrientation()?.clone() || new THREE.Quaternion()
            };

            setTargetType(savedSettings.targetType);
            setTargetPoint(savedSettings.targetPoint);

            const target = savedSettings.selectedSpacecraft && world
                ? world.getSpacecraftList().find(s => s.name === savedSettings.selectedSpacecraft?.name) || null
                : null;
            setSelectedSpacecraft(target);

            if (autopilot) {
                if (target && savedSettings.targetType === 'spacecraft') {
                    autopilot.setTargetObject(target, savedSettings.targetPoint);
                } else if (savedSettings.customPosition) {
                    autopilot.setTargetPosition(savedSettings.customPosition);
                    if (savedSettings.customOrientation) {
                        autopilot.setTargetOrientation(savedSettings.customOrientation);
                    }
                }
            }
        }
    }, [spacecraft?.name, world, autopilot, version]);

    // Create/teardown the 3D drag gizmo when using a custom target position
    useEffect(() => {
        if (!world || !autopilot) return;

        const shouldShow = targetType === 'custom';
        if (shouldShow && !gizmoRef.current) {
            try {
                const scene = world.camera.scene as unknown as THREE.Scene;
                const camera = world.camera.camera as unknown as THREE.Camera;
                const dom = world.renderer.renderer.domElement as unknown as HTMLElement;
                const initialPos = autopilot.getTargetPosition()?.clone?.() || new THREE.Vector3();
                const initialQuat = autopilot.getTargetOrientation()?.clone?.() || new THREE.Quaternion();

                gizmoRef.current = new TargetGizmo(
                    scene,
                    camera,
                    dom,
                    (pos: THREE.Vector3, quat: THREE.Quaternion) => {
                        autopilot.setTargetPosition(pos.clone());
                        autopilot.setTargetOrientation(quat.clone());
                        saveSettings({ customPosition: pos.clone(), customOrientation: quat.clone() });
                    },
                    { size: 0.9, mode: gizmoMode },
                    (world.camera.controls as unknown as { enabled: boolean })
                );
                gizmoRef.current.setPosition(initialPos);
                gizmoRef.current.setOrientation(initialQuat);
                gizmoRef.current.setVisible(true);
            } catch (err) {
                console.warn('Failed to initialize TargetGizmo:', err);
            }
        } else if (!shouldShow && gizmoRef.current) {
            try { gizmoRef.current.setVisible(false); } catch {}
            try { gizmoRef.current.dispose(); } catch {}
            gizmoRef.current = null;
        }

        return () => {
            if (gizmoRef.current) {
                try { gizmoRef.current.dispose(); } catch {}
                gizmoRef.current = null;
            }
        };
    }, [world, autopilot, targetType]);

    // Poll autopilot telemetry periodically for display
    useEffect(() => {
        if (!autopilot) return;
        const id = setInterval(() => {
            try {
                setApTelemetry({
                    modes: autopilot.getActiveAutopilots?.(),
                    point: autopilot.getPointToPositionTelemetry?.(),
                    orient: autopilot.getOrientationMatchTelemetry?.(),
                    goto: autopilot.getGoToPositionTelemetry?.(),
                    path: autopilot.getPathFollowerTelemetry?.(),
                });
            } catch {}
        }, 100);
        return () => clearInterval(id);
    }, [autopilot]);

    const saveSettings = (updates: Partial<TargetSettings> = {}) => {
        if (!spacecraft?.name) return;

        const currentSettings = targetSettings[spacecraft.name] || {} as Partial<TargetSettings>;
        const newSettings: TargetSettings = {
            ...currentSettings,
            targetType,
            targetPoint,
            selectedSpacecraft,
            customPosition: autopilot?.getTargetPosition()?.clone() || new THREE.Vector3(),
            customOrientation: autopilot?.getTargetOrientation()?.clone() || new THREE.Quaternion(),
            ...updates
        };

        setTargetSettings(prev => ({
            ...prev,
            [spacecraft.name]: newSettings
        }));
    };

    const handleSpacecraftSelect = (e: ChangeEvent<HTMLSelectElement>) => {
        const selectedId = e.target.value;
        const target = world?.getSpacecraftList().find(s =>
            s !== spacecraft &&
            s.name === selectedId
        );

        setSelectedSpacecraft(target || null);

        if (target && autopilot) {
            autopilot.setTargetObject(target, targetPoint);
            saveSettings({ selectedSpacecraft: target });
            if (gizmoRef.current) {
                try { gizmoRef.current.dispose(); } catch {}
                gizmoRef.current = null;
            }
        } else if (autopilot) {
            autopilot.clearTargetObject();
            saveSettings({ selectedSpacecraft: null });
            if (targetType === 'custom' && world && !gizmoRef.current) {
                try {
                    const scene = world.camera.scene as unknown as THREE.Scene;
                    const camera = world.camera.camera as unknown as THREE.Camera;
                    const dom = world.renderer.renderer.domElement as unknown as HTMLElement;
                    gizmoRef.current = new TargetGizmo(
                        scene,
                        camera,
                        dom,
                        (pos: THREE.Vector3, quat: THREE.Quaternion) => {
                            autopilot.setTargetPosition(pos.clone());
                            autopilot.setTargetOrientation(quat.clone());
                            saveSettings({ customPosition: pos.clone(), customOrientation: quat.clone() });
                        },
                        { size: 0.9, mode: gizmoMode },
                        (world.camera.controls as unknown as { enabled: boolean })
                    );
                    gizmoRef.current.setPosition(autopilot.getTargetPosition()?.clone?.() || new THREE.Vector3());
                    gizmoRef.current.setOrientation(autopilot.getTargetOrientation()?.clone?.() || new THREE.Quaternion());
                    gizmoRef.current.setVisible(true);
                } catch {}
            }
        }
    };

    const handleTargetPointChange = (e: ChangeEvent<HTMLSelectElement>) => {
        const point = e.target.value as 'center' | 'front' | 'back';
        setTargetPoint(point);

        if (selectedSpacecraft && autopilot) {
            autopilot.setTargetObject(selectedSpacecraft, point);
            saveSettings({ targetPoint: point });
        }
    };

    const applyTargetType = (type: 'custom' | 'spacecraft') => {
        setTargetType(type);

        if (type === 'custom' && autopilot) {
            autopilot.clearTargetObject();
            saveSettings({ targetType: type });
            if (world && !gizmoRef.current) {
                try {
                    const scene = world.camera.scene as unknown as THREE.Scene;
                    const camera = world.camera.camera as unknown as THREE.Camera;
                    const dom = world.renderer.renderer.domElement as unknown as HTMLElement;
                    gizmoRef.current = new TargetGizmo(
                        scene,
                        camera,
                        dom,
                        (pos: THREE.Vector3, quat: THREE.Quaternion) => {
                            autopilot.setTargetPosition(pos.clone());
                            autopilot.setTargetOrientation(quat.clone());
                            saveSettings({ customPosition: pos.clone(), customOrientation: quat.clone() });
                        },
                        { size: 0.9, mode: gizmoMode },
                        (world.camera.controls as unknown as { enabled: boolean })
                    );
                    gizmoRef.current.setPosition(autopilot.getTargetPosition()?.clone?.() || new THREE.Vector3());
                    gizmoRef.current.setOrientation(autopilot.getTargetOrientation()?.clone?.() || new THREE.Quaternion());
                    gizmoRef.current.setVisible(true);
                } catch {}
            } else if (gizmoRef.current) {
                gizmoRef.current.setVisible(true);
                gizmoRef.current.setPosition(autopilot.getTargetPosition()?.clone?.() || new THREE.Vector3());
                gizmoRef.current.setOrientation(autopilot.getTargetOrientation()?.clone?.() || new THREE.Quaternion());
            }
        } else if (type === 'spacecraft' && selectedSpacecraft && autopilot) {
            autopilot.setTargetObject(selectedSpacecraft, targetPoint);
            saveSettings({ targetType: type });
            if (gizmoRef.current) {
                try { gizmoRef.current.dispose(); } catch {}
                gizmoRef.current = null;
            }
        }
    };

    const handleCustomPositionChange = (axis: 'x' | 'y' | 'z', value: string) => {
        if (!autopilot) return;

        const currentPosition = autopilot.getTargetPosition();
        const newPosition = currentPosition.clone();
        newPosition[axis] = parseFloat(value);
        autopilot.setTargetPosition(newPosition);
        saveSettings({ customPosition: newPosition });
        if (gizmoRef.current) {
            gizmoRef.current.setPosition(newPosition);
        }
    };

    const applyGizmoMode = (mode: 'translate' | 'rotate') => {
        setGizmoMode(mode);
        gizmoRef.current?.setMode(mode);
    };

    // Render a mode button inside a toggle stack
    const renderModeButton = ({ key, label, shortcut, description }: ModeButton) => {
        const isActive = !!apState.activeAutopilots?.[key];
        return (
            <button
                key={key}
                className={`w-full px-1.5 py-1 text-[10px] transition-colors text-left ${
                    isActive
                        ? 'bg-cyan-500/15 text-white'
                        : 'bg-black/60 text-white/70 hover:bg-white/20'
                }`}
                onClick={() => autopilot?.[key]?.()}
                title={description}
            >
                <span className="flex items-center justify-between">
                    <span>{label}</span>
                    <span className={isActive ? 'text-cyan-300/90' : 'text-white/50'}>{shortcut}</span>
                </span>
            </button>
        );
    };

    return (
        <div className="flex flex-col gap-1 p-1 text-white/90 text-[10px] w-full">
            {/* Autopilot Mode Groups */}
            <div className="flex flex-col gap-1">
                <div>
                    <h3 className={`${SECTION_HEADER} mb-0.5`}>Attitude</h3>
                    <div className={TOGGLE_STACK}>
                        {ROTATION_MODES.map(renderModeButton)}
                    </div>
                </div>
                <div>
                    <h3 className={`${SECTION_HEADER} mb-0.5`}>Translation</h3>
                    <div className={TOGGLE_STACK}>
                        {TRANSLATION_MODES.map(renderModeButton)}
                    </div>
                </div>
            </div>

            {/* Target Selection */}
            <div className="flex flex-col gap-1">
                <h3 className={SECTION_HEADER}>Target</h3>
                <div className={TOGGLE_GROUP}>
                    <button
                        className={`flex-1 py-0.5 ${TOGGLE_OPTION} ${targetType === 'custom' ? TOGGLE_ACTIVE : TOGGLE_INACTIVE}`}
                        onClick={() => applyTargetType('custom')}
                    >Custom</button>
                    <button
                        className={`flex-1 py-0.5 ${TOGGLE_OPTION} ${targetType === 'spacecraft' ? TOGGLE_ACTIVE : TOGGLE_INACTIVE}`}
                        onClick={() => applyTargetType('spacecraft')}
                    >Spacecraft</button>
                </div>

                {targetType === 'spacecraft' ? (
                    <div className="flex flex-col gap-0.5">
                        {otherSpacecraft.length > 0 ? (
                            <>
                                <select
                                    className={INPUT_BASE}
                                    value={selectedSpacecraft?.name || ''}
                                    onChange={handleSpacecraftSelect}
                                >
                                    <option value="">Select Spacecraft</option>
                                    {otherSpacecraft.map(s => (
                                        <option key={s.name} value={s.name}>
                                            {s.name}
                                        </option>
                                    ))}
                                </select>

                                <select
                                    className={INPUT_BASE}
                                    value={targetPoint}
                                    onChange={handleTargetPointChange}
                                    disabled={!selectedSpacecraft}
                                >
                                    <option value="center">Center of Mass</option>
                                    <option value="front">Front Docking Port</option>
                                    <option value="back">Back Docking Port</option>
                                </select>
                            </>
                        ) : (
                            <div className={EMPTY_STATE}>
                                No other spacecraft available
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="flex flex-col gap-0.5">
                        <div className={TOGGLE_GROUP}>
                            <button
                                className={`flex-1 py-0.5 ${TOGGLE_OPTION} ${gizmoMode === 'translate' ? TOGGLE_ACTIVE : TOGGLE_INACTIVE}`}
                                onClick={() => applyGizmoMode('translate')}
                                title="Move gizmo"
                            >Move</button>
                            <button
                                className={`flex-1 py-0.5 ${TOGGLE_OPTION} ${gizmoMode === 'rotate' ? TOGGLE_ACTIVE : TOGGLE_INACTIVE}`}
                                onClick={() => applyGizmoMode('rotate')}
                                title="Rotate gizmo"
                            >Rotate</button>
                        </div>
                        {(['x', 'y', 'z'] as const).map(axis => (
                            <div key={axis} className="flex items-center gap-1">
                                <label className="text-[10px] text-cyan-300/90 w-4">{axis}</label>
                                <NumberInput
                                    value={autopilot?.getTargetPosition()?.[axis] ?? 0}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) =>
                                        handleCustomPositionChange(axis, e.target.value)}
                                    step={0.1}
                                    className="flex-1"
                                />
                            </div>
                        ))}
                        {selectedSpacecraft && (
                            <div className="text-cyan-300/90 text-[10px]">
                                Current Target: {selectedSpacecraft.name}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Autopilot Telemetry */}
            <div className="flex flex-col gap-0.5">
                <h3 className={SECTION_HEADER}>Telemetry</h3>
                {apTelemetry?.path && (
                    <div className="text-[10px] font-mono bg-black/40 p-0.5 border border-white/10">
                        <div className="text-cyan-300/90">Path Follower</div>
                        <div>s: {apTelemetry.path.energy?.sCur?.toFixed?.(2)} / {apTelemetry.path.energy?.sStop?.toFixed?.(2)} m</div>
                        <div>v∥: {apTelemetry.path.energy?.vAlong?.toFixed?.(2)} m/s → v_ref: {apTelemetry.path.vRefMag?.toFixed?.(2)} m/s</div>
                        <div>v_feasible: {apTelemetry.path.energy?.vFeasible?.toFixed?.(2)} m/s (n: {apTelemetry.path.energy?.nSamples} / {apTelemetry.path.energy?.nCtrl})</div>
                        <div>limits: v_lim={apTelemetry.path.energy?.vLimit?.toFixed?.(2)} v_fwd={apTelemetry.path.energy?.vFwd?.toFixed?.(2)} v_bwd={apTelemetry.path.energy?.vBwd?.toFixed?.(2)}</div>
                        <div>κ: {apTelemetry.path.energy?.kappa?.toFixed?.(3)} a_tan: {apTelemetry.path.energy?.aTanMax?.toFixed?.(2)} a_lat: {apTelemetry.path.energy?.aLatMax?.toFixed?.(2)}</div>
                        <div>done: {String(apTelemetry.path.energy?.done)}</div>
                    </div>
                )}
                {apTelemetry?.modes?.pointToPosition && apTelemetry?.point && (
                    <div className="text-[10px] font-mono bg-black/40 p-0.5 border border-white/10">
                        <div className="text-cyan-300/90">Point To Position</div>
                        <div>angle: {apTelemetry.point.angleDeg?.toFixed?.(1)} deg</div>
                        <div>ω_des: {apTelemetry.point.wDesMag?.toFixed?.(2)} rad/s</div>
                        <div>I_eff: {apTelemetry.point.Ieff?.toFixed?.(2)}</div>
                        <div>L_err: {apTelemetry.point.LErr?.toFixed?.(2)}</div>
                        <div>α_max: {apTelemetry.point.alphaMax?.toFixed?.(2)}</div>
                    </div>
                )}
                {apTelemetry?.modes?.orientationMatch && apTelemetry?.orient && (
                    <div className="text-[10px] font-mono bg-black/40 p-0.5 border border-white/10">
                        <div className="text-cyan-300/90">Orientation Match</div>
                        <div>angle: {apTelemetry.orient.angleDeg?.toFixed?.(1)} deg</div>
                        <div>ω_des: {apTelemetry.orient.wDesMag?.toFixed?.(2)} rad/s</div>
                        <div>I_eff: {apTelemetry.orient.Ieff?.toFixed?.(2)}</div>
                        <div>L_err: {apTelemetry.orient.LErr?.toFixed?.(2)}</div>
                        <div>α_max: {apTelemetry.orient.alphaMax?.toFixed?.(2)}</div>
                    </div>
                )}
                {apTelemetry?.modes?.goToPosition && apTelemetry?.goto && (
                    <div className="text-[10px] font-mono bg-black/40 p-0.5 border border-white/10">
                        <div className="text-cyan-300/90">Go To Position</div>
                        <div>target: {apTelemetry.goto.targetType || 'static'}</div>
                        <div>dist: {apTelemetry.goto.distance?.toFixed?.(2)} m</div>
                        <div>v∥: {apTelemetry.goto.vAlong?.toFixed?.(2)} m/s</div>
                        <div>v_des: {apTelemetry.goto.vDes?.toFixed?.(2)} m/s</div>
                        <div>d_stop: {apTelemetry.goto.dStop?.toFixed?.(2)} m</div>
                        <div>align: {apTelemetry.goto.alignAngleDeg?.toFixed?.(1)}° gate: {String(apTelemetry.goto.alignGate)}</div>
                        <div>a_max: {apTelemetry.goto.aMax?.toFixed?.(2)} v_max: {apTelemetry.goto.vMax?.toFixed?.(2)}</div>
                        <div>t_go: {apTelemetry.goto.tGo?.toFixed?.(2)} s</div>
                        <div>pred. miss: {apTelemetry.goto.missMag?.toFixed?.(3)} m</div>
                    </div>
                )}
            </div>
        </div>
    );
};
