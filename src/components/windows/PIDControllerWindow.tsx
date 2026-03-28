import React, { ChangeEvent, useEffect, useState } from 'react';
import { NumberInput } from '../ui/NumberInput';
import { WINDOW_BODY, SECTION_HEADER, FIELD_LABEL, BUTTON_PRIMARY } from '../ui/styles';
import { PIDController } from '../../controllers/pidController';
import type { Autopilot } from '../../controllers/autopilot/Autopilot';

interface PIDControllerWindowProps {
    controller: PIDController | null;
    rotationCancelController?: PIDController | null;
    linearController?: PIDController | null;
    momentumController?: PIDController | null;
    autopilot?: Autopilot | null;
}

type GainKey = 'Kp' | 'Ki' | 'Kd';
const GAIN_KEYS: GainKey[] = ['Kp', 'Ki', 'Kd'];

interface GainState {
    value: number;
    isChanged: boolean;
}
type GainStates = Partial<Record<GainKey, GainState>>;

type ControllerType = 'rotation' | 'rotCancel' | 'linear' | 'momentum';
const AUTOTUNE_MAP: Record<ControllerType, string> = {
    rotation: 'attitude',
    rotCancel: 'rotCancel',
    linear: 'position',
    momentum: 'linMomentum',
};

// ── Sparkline SVG ──

const Sparkline: React.FC<{ values: number[]; width?: number; height?: number; color?: string }> = ({
    values, width = 140, height = 28, color = '#7dd3fc',
}) => {
    const max = Math.max(1e-6, ...values);
    const pts = values.map((v, i) => {
        const x = (i / Math.max(1, values.length - 1)) * (width - 2) + 1;
        const y = height - 1 - (v / Math.max(1e-6, max)) * (height - 2);
        return `${x},${y}`;
    }).join(' ');
    return (
        <svg width={width} height={height} className="block bg-white/[0.04] border border-white/[0.12]">
            <polyline fill="none" stroke={color} strokeWidth="1" points={pts} />
        </svg>
    );
};

// ── Hook: live calibration samples for sparkline ──

function useCalibrationSeries(ctl: PIDController | null, active: boolean): number[] {
    const [series, setSeries] = useState<number[]>([]);
    useEffect(() => {
        if (!ctl || !active) return;
        let raf: number | null = null;
        const tick = () => {
            try {
                if (ctl.isCalibrating?.()) {
                    const samples = ctl.getCalibrationSamples?.() || [];
                    setSeries(samples.map(s => s.error));
                }
            } catch { /* ignore */ }
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => { if (raf) cancelAnimationFrame(raf); };
    }, [ctl, active]);
    return series;
}

// ── Hook: sync controller gains into local state ──

function useSyncGains(ctl: PIDController | null): [GainStates, (key: GainKey, value: number) => void] {
    const [gains, setGains] = useState<GainStates>({});

    useEffect(() => {
        if (!ctl) return;
        const next: GainStates = {};
        for (const key of GAIN_KEYS) {
            next[key] = { value: ctl.getGain(key), isChanged: false };
        }
        setGains(next);
    }, [ctl]);

    const update = (key: GainKey, value: number) => {
        setGains(prev => ({ ...prev, [key]: { value, isChanged: true } }));
    };

    return [gains, update];
}

// ── Single controller section (replaces 4x duplicated blocks) ──

interface ControllerSectionProps {
    title: string;
    controller: PIDController;
    gains: GainStates;
    isCalibrating: boolean;
    sparkColor?: string;
    onGainChange: (key: GainKey, value: number) => void;
    onCalibrate: () => void;
}

const ControllerSection: React.FC<ControllerSectionProps> = ({
    title, controller, gains, isCalibrating, sparkColor, onGainChange, onCalibrate,
}) => {
    const series = useCalibrationSeries(controller, isCalibrating);
    return (
        <div className="space-y-0.5">
            <h3 className={SECTION_HEADER}>{title}</h3>
            {isCalibrating && series.length > 0 && (
                <div className="flex items-center gap-1 mb-0.5">
                    <Sparkline values={series} color={sparkColor} />
                    <span className="text-[10px] text-white/60 font-mono">n={series.length}</span>
                </div>
            )}
            {isCalibrating && series.length === 0 && (
                <div className="text-[10px] text-white/50 font-mono mb-0.5">Collecting samples…</div>
            )}
            <div className="space-y-0.5">
                {GAIN_KEYS.map((key) => (
                    <div key={key} className="flex items-center justify-between gap-1">
                        <label className={FIELD_LABEL}>{key}</label>
                        <NumberInput
                            value={gains[key]?.value ?? 0}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => onGainChange(key, parseFloat(e.target.value))}
                            step={0.01}
                            className={`w-16 ${gains[key]?.isChanged ? 'text-cyan-400' : ''}`}
                        />
                    </div>
                ))}
            </div>
            <button onClick={onCalibrate} disabled={isCalibrating} className={BUTTON_PRIMARY}>
                {isCalibrating ? 'Calibrating...' : 'Auto-Calibrate'}
            </button>
        </div>
    );
};

// ── Controller config for the four sections ──

interface ControllerConfig {
    type: ControllerType;
    title: string;
    sparkColor?: string;
}

const CONTROLLERS: ControllerConfig[] = [
    { type: 'rotation', title: 'Orientation (Attitude)' },
    { type: 'rotCancel', title: 'Cancel Rotation (Angular Momentum)', sparkColor: '#93c5fd' },
    { type: 'linear', title: 'Position', sparkColor: '#a7f3d0' },
    { type: 'momentum', title: 'Linear Momentum', sparkColor: '#fca5a5' },
];

// ── Main component ──

export const PIDControllerWindow: React.FC<PIDControllerWindowProps> = ({
    controller,
    rotationCancelController,
    linearController,
    momentumController,
    autopilot,
}) => {
    const ctlMap: Record<ControllerType, PIDController | null | undefined> = {
        rotation: controller,
        rotCancel: rotationCancelController,
        linear: linearController,
        momentum: momentumController,
    };

    const [rotGains, updateRotGains] = useSyncGains(controller);
    const [rotCancelGains, updateRotCancelGains] = useSyncGains(rotationCancelController ?? null);
    const [linGains, updateLinGains] = useSyncGains(linearController ?? null);
    const [momGains, updateMomGains] = useSyncGains(momentumController ?? null);

    const gainsMap: Record<ControllerType, [GainStates, (key: GainKey, value: number) => void]> = {
        rotation: [rotGains, updateRotGains],
        rotCancel: [rotCancelGains, updateRotCancelGains],
        linear: [linGains, updateLinGains],
        momentum: [momGains, updateMomGains],
    };

    // Poll calibration flags from controllers
    const [calibrating, setCalibrating] = useState<Record<ControllerType, boolean>>({
        rotation: false, rotCancel: false, linear: false, momentum: false,
    });

    useEffect(() => {
        let t: number | null = null;
        const poll = () => {
            setCalibrating({
                rotation: controller?.isCalibrating?.() || false,
                rotCancel: rotationCancelController?.isCalibrating?.() || false,
                linear: linearController?.isCalibrating?.() || false,
                momentum: momentumController?.isCalibrating?.() || false,
            });
            t = window.setTimeout(poll, 200);
        };
        poll();
        return () => { if (t) window.clearTimeout(t); };
    }, [controller, rotationCancelController, linearController, momentumController]);

    const handleGainChange = (type: ControllerType, key: GainKey, value: number) => {
        const ctl = ctlMap[type];
        if (!ctl) return;
        ctl.setGain(key, value);
        try { autopilot?.syncPidGainsToWorker?.(); } catch { /* ignore */ }
        gainsMap[type][1](key, value);
    };

    const startCalibration = async (type: ControllerType) => {
        const ctl = ctlMap[type];
        if (!ctl) return;
        setCalibrating(prev => ({ ...prev, [type]: true }));
        try {
            await ctl.autoCalibrate(1200);
            if (autopilot) {
                await autopilot.autoTune(AUTOTUNE_MAP[type] as Parameters<Autopilot['autoTune']>[0], 1200);
            }
            try { autopilot?.syncPidGainsToWorker?.(); } catch { /* ignore */ }
            // Refresh gains from controller after calibration
            for (const key of GAIN_KEYS) {
                gainsMap[type][1](key, ctl.getGain(key));
            }
        } catch (error) {
            console.error(`Failed to calibrate ${type} PID:`, error);
        } finally {
            setCalibrating(prev => ({ ...prev, [type]: false }));
        }
    };

    return (
        <div className={WINDOW_BODY + ' w-full'}>
            {CONTROLLERS.map(({ type, title, sparkColor }) => {
                const ctl = ctlMap[type];
                if (!ctl) return null;
                const [gains] = gainsMap[type];
                return (
                    <ControllerSection
                        key={type}
                        title={title}
                        controller={ctl}
                        gains={gains}
                        isCalibrating={calibrating[type]}
                        sparkColor={sparkColor}
                        onGainChange={(key, value) => handleGainChange(type, key, value)}
                        onCalibrate={() => startCalibration(type)}
                    />
                );
            })}
        </div>
    );
};
