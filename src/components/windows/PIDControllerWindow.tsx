import React, { ChangeEvent, useState, useEffect } from 'react';
import { NumberInput } from '../ui/NumberInput';
import { PIDController } from '../../controllers/pidController';

interface PIDControllerWindowProps {
    controller: PIDController | null;
    linearController?: PIDController | null;
}

interface GainConfig {
    key: 'Kp' | 'Ki' | 'Kd';
    label: string;
}

interface GainState {
    value: number;
    isChanged: boolean;
}

interface GainStates {
    [key: string]: GainState;
}

export const PIDControllerWindow: React.FC<PIDControllerWindowProps> = ({ controller, linearController }) => {
    const gains: GainConfig[] = [
        { key: 'Kp', label: 'Proportional Gain (Kp)' },
        { key: 'Ki', label: 'Integral Gain (Ki)' },
        { key: 'Kd', label: 'Derivative Gain (Kd)' }
    ];

    // Separate states for rotation and linear gains
    const [rotationGains, setRotationGains] = useState<GainStates>({});
    const [linearGains, setLinearGains] = useState<GainStates>({});

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

    // Handle gain changes
    const handleGainChange = (type: 'rotation' | 'linear', key: 'Kp' | 'Ki' | 'Kd', value: number) => {
        const targetController = type === 'rotation' ? controller : linearController;
        const setGains = type === 'rotation' ? setRotationGains : setLinearGains;
        
        if (targetController) {
            targetController.setGain(key, value);
            setGains(prev => ({
                ...prev,
                [key]: { value, isChanged: true }
            }));

            // Reset the changed state after animation
            setTimeout(() => {
                setGains(prev => ({
                    ...prev,
                    [key]: { value, isChanged: false }
                }));
            }, 300);
        }
    };

    return (
        <div className="space-y-4">
            <div>
                <h3 className="text-cyan-300/90 font-medium mb-2">Rotation Control</h3>
                <div className="space-y-2">
                    {gains.map(({ key, label }) => (
                        <NumberInput
                            key={`rotation-${key}`}
                            label={label}
                            value={rotationGains[key]?.value ?? 0}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => {
                                handleGainChange('rotation', key, parseFloat(e.target.value));
                            }}
                            className={rotationGains[key]?.isChanged ? 'text-green-400 transition-colors duration-300' : ''}
                        />
                    ))}
                </div>
            </div>

            {linearController && (
                <div>
                    <h3 className="text-cyan-300/90 font-medium mb-2">Linear Control</h3>
                    <div className="space-y-2">
                        {gains.map(({ key, label }) => (
                            <NumberInput
                                key={`linear-${key}`}
                                label={label}
                                value={linearGains[key]?.value ?? 0}
                                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                                    handleGainChange('linear', key, parseFloat(e.target.value));
                                }}
                                className={linearGains[key]?.isChanged ? 'text-green-400 transition-colors duration-300' : ''}
                            />
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}; 