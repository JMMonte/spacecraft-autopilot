import React, { ChangeEvent, useState, useEffect } from 'react';
import { NumberInput } from '../ui/NumberInput';
import { PIDController } from '../../controllers/pidController';

interface PIDControllerWindowProps {
    controller: PIDController | null;
    linearController?: PIDController | null;
    momentumController?: PIDController | null;
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
    linearController,
    momentumController 
}) => {
    const gains: GainConfig[] = [
        { key: 'Kp' },
        { key: 'Ki' },
        { key: 'Kd' }
    ];

    // Separate states for each controller
    const [rotationGains, setRotationGains] = useState<GainStates>({});
    const [linearGains, setLinearGains] = useState<GainStates>({});
    const [momentumGains, setMomentumGains] = useState<GainStates>({});
    const [isCalibrating, setIsCalibrating] = useState<{
        rotation: boolean, 
        linear: boolean,
        momentum: boolean
    }>({ 
        rotation: false, 
        linear: false,
        momentum: false 
    });

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

    const handleGainChange = (type: 'rotation' | 'linear' | 'momentum', key: 'Kp' | 'Ki' | 'Kd', value: number) => {
        const targetController = type === 'rotation' ? controller : 
                               type === 'linear' ? linearController : 
                               momentumController;
        if (!targetController) return;

        targetController.setGain(key, value);
        
        switch (type) {
            case 'rotation':
                setRotationGains(prev => ({
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

    const startCalibration = async (type: 'rotation' | 'linear' | 'momentum') => {
        const targetController = type === 'rotation' ? controller : 
                               type === 'linear' ? linearController : 
                               momentumController;
        if (!targetController) return;

        setIsCalibrating(prev => ({ ...prev, [type]: true }));

        try {
            await targetController.autoCalibrate();
            
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
            setIsCalibrating(prev => ({ ...prev, [type]: false }));
        }
    };

    return (
        <div className="flex flex-col gap-0.5 p-1 bg-black/40 text-white/90 backdrop-blur w-[160px]">
            {controller && (
                <div className="space-y-0.5">
                    <h3 className="text-cyan-300/90 font-medium text-[10px] uppercase">Angular Momentum</h3>
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
            
            {linearController && (
                <div className="space-y-0.5">
                    <h3 className="text-cyan-300/90 font-medium text-[10px] uppercase">Position</h3>
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