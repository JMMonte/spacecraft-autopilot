import React, { useState, useEffect, ChangeEvent } from 'react';
import * as THREE from 'three';
import { Spacecraft } from '../../core/spacecraft';
import { SpacecraftController } from '../../controllers/spacecraftController';
import { BasicWorld } from '../../core/BasicWorld';
import { NumberInput } from '../ui/NumberInput';

interface AutopilotWindowProps {
    spacecraft: Spacecraft | null;
    controller: SpacecraftController | null;
    world: BasicWorld | null;
}

interface TargetSettings {
    targetType: 'custom' | 'spacecraft';
    targetPoint: 'center' | 'front' | 'back';
    selectedSpacecraft: Spacecraft | null;
    customPosition: THREE.Vector3;
}

interface TargetSettingsMap {
    [key: string]: TargetSettings;
}

interface AutopilotButton {
    key: 'cancelAndAlign' | 'pointToPosition' | 'cancelRotation' | 'cancelLinearMotion' | 'goToPosition';
    label: string;
    description: string;
}

export const AutopilotWindow: React.FC<AutopilotWindowProps> = ({ spacecraft, controller, world }) => {
    const [targetSettings, setTargetSettings] = useState<TargetSettingsMap>({});
    const [targetType, setTargetType] = useState<'custom' | 'spacecraft'>('custom');
    const [targetPoint, setTargetPoint] = useState<'center' | 'front' | 'back'>('center');
    const [selectedSpacecraft, setSelectedSpacecraft] = useState<Spacecraft | null>(null);

    const autopilot = controller?.getAutopilot();

    useEffect(() => {
        if (spacecraft?.name) {
            const savedSettings = targetSettings[spacecraft.name] || {
                targetType: 'custom',
                targetPoint: 'center',
                selectedSpacecraft: null,
                customPosition: autopilot?.getTargetPosition()?.clone() || new THREE.Vector3()
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
                }
            }
        }
    }, [spacecraft?.name, world, autopilot]);

    const saveSettings = (updates: Partial<TargetSettings> = {}) => {
        if (!spacecraft?.name) return;

        const currentSettings = targetSettings[spacecraft.name] || {};
        const newSettings: TargetSettings = {
            ...currentSettings,
            targetType,
            targetPoint,
            selectedSpacecraft,
            customPosition: autopilot?.getTargetPosition()?.clone() || new THREE.Vector3(),
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
        } else if (autopilot) {
            autopilot.clearTargetObject();
            saveSettings({ selectedSpacecraft: null });
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

    const handleTargetTypeChange = (e: ChangeEvent<HTMLSelectElement>) => {
        const type = e.target.value as 'custom' | 'spacecraft';
        setTargetType(type);

        if (type === 'custom' && autopilot) {
            autopilot.clearTargetObject();
            saveSettings({ targetType: type });
        } else if (type === 'spacecraft' && selectedSpacecraft && autopilot) {
            autopilot.setTargetObject(selectedSpacecraft, targetPoint);
            saveSettings({ targetType: type });
        }
    };

    const handleCustomPositionChange = (axis: 'x' | 'y' | 'z', value: string) => {
        if (!autopilot) return;

        const currentPosition = autopilot.getTargetPosition();
        const newPosition = currentPosition.clone();
        newPosition[axis] = parseFloat(value);
        autopilot.setTargetPosition(newPosition);
        saveSettings({ customPosition: newPosition });
    };

    const autopilotButtons: AutopilotButton[] = [
        { key: 'cancelAndAlign', label: 'Cancel and Align (T)', description: 'Cancels rotation and aligns with current orientation' },
        { key: 'pointToPosition', label: 'Point to Position (Y)', description: 'Points spacecraft to target position' },
        { key: 'cancelRotation', label: 'Cancel Rotation (R)', description: 'Cancels all rotational movement' },
        { key: 'cancelLinearMotion', label: 'Cancel Linear Motion (G)', description: 'Cancels all linear movement' },
        { key: 'goToPosition', label: 'Go to Position (B)', description: 'Moves spacecraft to target position' }
    ];

    return (
        <div className="flex flex-col gap-2">
            {/* Autopilot Buttons */}
            <div className="flex flex-col gap-1">
                {autopilotButtons.map(({ key, label, description }) => (
                    <button
                        key={key}
                        className={`px-2 py-1 bg-black/60 hover:bg-white/20 text-white/90 rounded transition-colors duration-200 text-xs border border-white/20 font-mono drop-shadow-md w-full ${autopilot?.getActiveAutopilots()?.[key] ? 'bg-cyan-300/20 border-cyan-300/40 text-white' : ''
                            }`}
                        onClick={() => autopilot?.[key]?.()}
                        title={description}
                    >
                        {label}
                    </button>
                ))}
            </div>

            {/* Target Selection */}
            <div className="flex flex-col gap-2 mt-2">
                <h4 className="text-cyan-300/90 font-medium drop-shadow-md">Target Type</h4>
                <select
                    className="w-full px-2 py-1 bg-black/60 text-white/90 rounded border border-white/20 text-xs font-mono"
                    value={targetType}
                    onChange={handleTargetTypeChange}
                >
                    <option value="custom">Custom Position</option>
                    <option value="spacecraft">Spacecraft</option>
                </select>

                {targetType === 'spacecraft' ? (
                    <div className="flex flex-col gap-2">
                        {(world?.getSpacecraftList()?.length ?? 0) > 1 ? (
                            <>
                                <select
                                    className="w-full px-2 py-1 bg-black/60 text-white/90 rounded border border-white/20 text-xs font-mono"
                                    value={selectedSpacecraft?.name || ''}
                                    onChange={handleSpacecraftSelect}
                                >
                                    <option value="">Select Spacecraft</option>
                                    {world?.getSpacecraftList()
                                        .filter(s => s !== spacecraft)
                                        .map(s => (
                                            <option key={s.name} value={s.name}>
                                                {s.name}
                                            </option>
                                        ))}
                                </select>

                                <select
                                    className="w-full px-2 py-1 bg-black/60 text-white/90 rounded border border-white/20 text-xs font-mono"
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
                            <div className="text-white/50 italic text-center bg-black/40 p-2 rounded border border-white/10">
                                No other spacecraft available
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="grid grid-cols-3 gap-1">
                        {(['x', 'y', 'z'] as const).map(axis => (
                            <NumberInput
                                key={axis}
                                label={axis.toUpperCase()}
                                value={autopilot?.getTargetPosition()?.[axis] ?? 0}
                                onChange={(e: ChangeEvent<HTMLInputElement>) => handleCustomPositionChange(axis, e.target.value)}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}; 