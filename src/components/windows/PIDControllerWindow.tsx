import React, { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { NumberInput } from '../ui/NumberInput';
import { PIDController } from '../../controllers/pidController';
import type { Autopilot } from '../../controllers/autopilot/Autopilot';

interface PIDControllerWindowProps {
    controller: PIDController | null;
    rotationCancelController?: PIDController | null;
    linearController?: PIDController | null;
    momentumController?: PIDController | null;
    autopilot?: Autopilot | null;
}

interface GainConfig {
    key: 'Kp' | 'Ki' | 'Kd';
}

interface GainState {
    value: number;
    isChanged: boolean;
}

interface GainStates {
    [key: string]: GainState;
}

export const PIDControllerWindow: React.FC<PIDControllerWindowProps> = ({ 
    controller, 
    rotationCancelController,
    linearController,
    momentumController,
    autopilot,
}) => {
    const gains: GainConfig[] = [
        { key: 'Kp' },
        { key: 'Ki' },
        { key: 'Kd' }
    ];

    // Separate states for each controller
    const [rotationGains, setRotationGains] = useState<GainStates>({});
    const [rotCancelGains, setRotCancelGains] = useState<GainStates>({});
    const [linearGains, setLinearGains] = useState<GainStates>({});
    const [momentumGains, setMomentumGains] = useState<GainStates>({});
    const [isCalibrating, setIsCalibrating] = useState<{
        rotation: boolean, 
        rotCancel: boolean,
        linear: boolean,
        momentum: boolean
    }>({ 
        rotation: false, 
        rotCancel: false,
        linear: false,
        momentum: false 
    });

    // Track external calibrations (e.g., triggered by autopilot) and reflect in UI
    useEffect(() => {
        let t: number | null = null;
        const poll = () => {
            const rot = controller?.isCalibrating?.() || false;
            const rotCancel = rotationCancelController?.isCalibrating?.() || false;
            const lin = linearController?.isCalibrating?.() || false;
            const mom = momentumController?.isCalibrating?.() || false;
            setIsCalibrating({ rotation: rot, rotCancel, linear: lin, momentum: mom });
            t = window.setTimeout(poll, 200);
        };
        poll();
        return () => { if (t) window.clearTimeout(t); };
    }, [controller, rotationCancelController, linearController, momentumController]);

    // Simple sparkline renderer helper
    const Sparkline: React.FC<{ values: number[]; width?: number; height?: number; color?: string }>
      = ({ values, width = 140, height = 28, color = '#7dd3fc' }) => {
        const max = Math.max(1e-6, ...values);
        const min = 0; // errors are >= 0
        const pts = values.map((v, i) => {
            const x = (i / Math.max(1, values.length - 1)) * (width - 2) + 1;
            const y = height - 1 - ((v - min) / Math.max(1e-6, max - min)) * (height - 2);
            return `${x},${y}`;
        }).join(' ');
        return (
            <svg width={width} height={height} style={{ display: 'block', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)' }}>
                <polyline fill="none" stroke={color} strokeWidth="1" points={pts} />
            </svg>
        );
    };

    // Live calibration samples for each controller (for sparkline)
    const useCalibrationSeries = (ctl: PIDController | null, flag: boolean) => {
        const [series, setSeries] = useState<number[]>([]);
        useEffect(() => {
            if (!ctl) return;
            let raf: number | null = null;
            let timer: number | null = null;
            const tick = () => {
                try {
                    if (ctl.isCalibrating?.()) {
                        const samples = ctl.getCalibrationSamples?.() || [];
                        setSeries(samples.map(s => s.error));
                    }
                } catch {}
                raf = requestAnimationFrame(tick);
            };
            if (flag) {
                raf = requestAnimationFrame(tick);
            }
            return () => {
                if (raf) cancelAnimationFrame(raf);
                if (timer) clearInterval(timer);
            };
        }, [ctl, flag]);
        return series;
    };

    const CalibrationSpark: React.FC<{ controller: PIDController; color?: string }> = ({ controller, color }) => {
        const series = useCalibrationSeries(controller, true);
        if (!controller?.isCalibrating?.()) return null;
        if (!series || series.length === 0) {
            return <div className="text-[10px] text-white/50 font-mono">Collecting samples…</div>;
        }
        return (
            <div className="flex items-center gap-1">
                <Sparkline values={series} color={color ?? '#7dd3fc'} />
                <span className="text-[10px] text-white/60 font-mono">n={series.length}</span>
            </div>
        );
    };

    // Update states when controllers change
    useEffect(() => {
        if (controller) {
            const newGains: GainStates = {};
            gains.forEach(({ key }) => {
                newGains[key] = {
                    value: controller.getGain(key),
                    isChanged: false
                };
            });
            setRotationGains(newGains);
        }
    }, [controller]);

    useEffect(() => {
        if (rotationCancelController) {
            const newGains: GainStates = {};
            gains.forEach(({ key }) => {
                newGains[key] = {
                    value: rotationCancelController.getGain(key),
                    isChanged: false
                };
            });
            setRotCancelGains(newGains);
        }
    }, [rotationCancelController]);

    useEffect(() => {
        if (linearController) {
            const newGains: GainStates = {};
            gains.forEach(({ key }) => {
                newGains[key] = {
                    value: linearController.getGain(key),
                    isChanged: false
                };
            });
            setLinearGains(newGains);
        }
    }, [linearController]);

    useEffect(() => {
        if (momentumController) {
            const newGains: GainStates = {};
            gains.forEach(({ key }) => {
                newGains[key] = {
                    value: momentumController.getGain(key),
                    isChanged: false
                };
            });
            setMomentumGains(newGains);
        }
    }, [momentumController]);

    const handleGainChange = (type: 'rotation' | 'rotCancel' | 'linear' | 'momentum', key: 'Kp' | 'Ki' | 'Kd', value: number) => {
        const targetController = type === 'rotation' ? controller : 
                               type === 'rotCancel' ? rotationCancelController : 
                               type === 'linear' ? linearController : 
                               momentumController;
        if (!targetController) return;

        targetController.setGain(key, value);
        // Sync updated gains to worker if applicable
        try { autopilot?.syncPidGainsToWorker?.(); } catch {}
        
        switch (type) {
            case 'rotation':
                setRotationGains(prev => ({
                    ...prev,
                    [key]: { value, isChanged: true }
                }));
                break;
            case 'rotCancel':
                setRotCancelGains(prev => ({
                    ...prev,
                    [key]: { value, isChanged: true }
                }));
                break;
            case 'linear':
                setLinearGains(prev => ({
                    ...prev,
                    [key]: { value, isChanged: true }
                }));
                break;
            case 'momentum':
                setMomentumGains(prev => ({
                    ...prev,
                    [key]: { value, isChanged: true }
                }));
                break;
        }
    };

    const startCalibration = async (type: 'rotation' | 'rotCancel' | 'linear' | 'momentum') => {
        const targetController = type === 'rotation' ? controller : 
                               type === 'rotCancel' ? rotationCancelController : 
                               type === 'linear' ? linearController : 
                               momentumController;
        if (!targetController) return;

        setIsCalibrating(prev => ({ ...prev, [type]: true } as any));

        try {
            // Kick the controller's calibrating flag for sparkline
            await targetController.autoCalibrate(1200);
            // Run active auto-tune via Autopilot so we actually fit gains from samples
            if (autopilot) {
                const map = type === 'rotation' ? 'attitude'
                          : type === 'rotCancel' ? 'rotCancel'
                          : type === 'linear' ? 'position'
                          : 'linMomentum';
                await autopilot.autoTune(map as any, 1200);
            }
            try { autopilot?.syncPidGainsToWorker?.(); } catch {}
            
            // Update gains after calibration
            const newGains: GainStates = {};
            gains.forEach(({ key }) => {
                newGains[key] = {
                    value: targetController.getGain(key),
                    isChanged: true
                };
            });

            switch (type) {
                case 'rotation':
                    setRotationGains(newGains);
                    break;
                case 'rotCancel':
                    setRotCancelGains(newGains);
                    break;
                case 'linear':
                    setLinearGains(newGains);
                    break;
                case 'momentum':
                    setMomentumGains(newGains);
                    break;
            }
        } catch (error) {
            console.error(`Failed to calibrate ${type} PID:`, error);
        } finally {
            setIsCalibrating(prev => ({ ...prev, [type]: false } as any));
        }
    };

    return (
        <div className="flex flex-col gap-0.5 p-1 bg-black/40 text-white/90 backdrop-blur w-full">
            {controller && (
                <div className="space-y-0.5">
                    <h3 className="text-cyan-300/90 font-medium text-[10px] uppercase">Orientation (Attitude)</h3>
                    {/* Sparkline while calibrating */}
                    {isCalibrating.rotation && (
                        <div className="mb-0.5">
                            <CalibrationSpark controller={controller} />
                        </div>
                    )}
                    <div className="space-y-0.5">
                        {gains.map(({ key }) => (
                            <div key={key} className="flex items-center justify-between gap-1">
                                <label className="text-[10px] text-white/70 font-mono">{key}</label>
                                <NumberInput
                                    value={rotationGains[key]?.value ?? 0}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => 
                                        handleGainChange('rotation', key, parseFloat(e.target.value))}
                                    step={0.01}
                                    className={`w-16 ${rotationGains[key]?.isChanged ? 'text-cyan-400' : ''}`}
                                />
                            </div>
                        ))}
                    </div>
                    <button
                        onClick={() => startCalibration('rotation')}
                        disabled={isCalibrating.rotation}
                        className="w-full px-1 py-0.5 bg-black/60 hover:bg-white/20 text-white/90 
                                  text-[10px] border border-white/20 font-mono disabled:opacity-50"
                    >
                        {isCalibrating.rotation ? 'Calibrating...' : 'Auto-Calibrate'}
                    </button>
                </div>
            )}

            {rotationCancelController && (
                <div className="space-y-0.5">
                    <h3 className="text-cyan-300/90 font-medium text-[10px] uppercase">Cancel Rotation (Angular Momentum)</h3>
                    {isCalibrating.rotCancel && (
                        <div className="mb-0.5">
                            <CalibrationSpark controller={rotationCancelController} color="#93c5fd" />
                        </div>
                    )}
                    <div className="space-y-0.5">
                        {gains.map(({ key }) => (
                            <div key={key} className="flex items-center justify-between gap-1">
                                <label className="text-[10px] text-white/70 font-mono">{key}</label>
                                <NumberInput
                                    value={rotCancelGains[key]?.value ?? 0}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => 
                                        handleGainChange('rotCancel', key, parseFloat(e.target.value))}
                                    step={0.01}
                                    className={`w-16 ${rotCancelGains[key]?.isChanged ? 'text-cyan-400' : ''}`}
                                />
                            </div>
                        ))}
                    </div>
                    <button
                        onClick={() => startCalibration('rotCancel')}
                        disabled={isCalibrating.rotCancel}
                        className="w-full px-1 py-0.5 bg-black/60 hover:bg-white/20 text-white/90 
                                  text-[10px] border border-white/20 font-mono disabled:opacity-50"
                    >
                        {isCalibrating.rotCancel ? 'Calibrating...' : 'Auto-Calibrate'}
                    </button>
                </div>
            )}
            
            {linearController && (
                <div className="space-y-0.5">
                    <h3 className="text-cyan-300/90 font-medium text-[10px] uppercase">Position</h3>
                    {isCalibrating.linear && (
                        <div className="mb-0.5">
                            <CalibrationSpark controller={linearController} color="#a7f3d0" />
                        </div>
                    )}
                    <div className="space-y-0.5">
                        {gains.map(({ key }) => (
                            <div key={key} className="flex items-center justify-between gap-1">
                                <label className="text-[10px] text-white/70 font-mono">{key}</label>
                                <NumberInput
                                    value={linearGains[key]?.value ?? 0}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => 
                                        handleGainChange('linear', key, parseFloat(e.target.value))}
                                    step={0.01}
                                    className={`w-16 ${linearGains[key]?.isChanged ? 'text-cyan-400' : ''}`}
                                />
                            </div>
                        ))}
                    </div>
                    <button
                        onClick={() => startCalibration('linear')}
                        disabled={isCalibrating.linear}
                        className="w-full px-1 py-0.5 bg-black/60 hover:bg-white/20 text-white/90 
                                  text-[10px] border border-white/20 font-mono disabled:opacity-50"
                    >
                        {isCalibrating.linear ? 'Calibrating...' : 'Auto-Calibrate'}
                    </button>
                </div>
            )}

            {momentumController && (
                <div className="space-y-0.5">
                    <h3 className="text-cyan-300/90 font-medium text-[10px] uppercase">Linear Momentum</h3>
                    {isCalibrating.momentum && (
                        <div className="mb-0.5">
                            <CalibrationSpark controller={momentumController} color="#fca5a5" />
                        </div>
                    )}
                    <div className="space-y-0.5">
                        {gains.map(({ key }) => (
                            <div key={key} className="flex items-center justify-between gap-1">
                                <label className="text-[10px] text-white/70 font-mono">{key}</label>
                                <NumberInput
                                    value={momentumGains[key]?.value ?? 0}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => 
                                        handleGainChange('momentum', key, parseFloat(e.target.value))}
                                    step={0.01}
                                    className={`w-16 ${momentumGains[key]?.isChanged ? 'text-cyan-400' : ''}`}
                                />
                            </div>
                        ))}
                    </div>
                    <button
                        onClick={() => startCalibration('momentum')}
                        disabled={isCalibrating.momentum}
                        className="w-full px-1 py-0.5 bg-black/60 hover:bg-white/20 text-white/90 
                                  text-[10px] border border-white/20 font-mono disabled:opacity-50"
                    >
                        {isCalibrating.momentum ? 'Calibrating...' : 'Auto-Calibrate'}
                    </button>
                </div>
            )}
        </div>
    );
}; 
