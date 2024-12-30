import React, { ChangeEvent } from 'react';
import { NumberInput } from '../ui/NumberInput';
import { PIDController } from '../../controllers/pidController';

interface PIDControllerWindowProps {
  controller: PIDController | null;
}

interface GainConfig {
  key: 'Kp' | 'Ki' | 'Kd';
  label: string;
}

export const PIDControllerWindow: React.FC<PIDControllerWindowProps> = ({ controller }) => {
  const gains: GainConfig[] = [
    { key: 'Kp', label: 'Proportional Gain (Kp)' },
    { key: 'Ki', label: 'Integral Gain (Ki)' },
    { key: 'Kd', label: 'Derivative Gain (Kd)' }
  ];

  return (
    <div className="space-y-2">
      {gains.map(({ key, label }) => (
        <NumberInput
          key={key}
          label={label}
          value={controller?.getGain(key) ?? 0}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            if (controller) {
              controller.setGain(key, parseFloat(e.target.value));
            }
          }}
        />
      ))}
    </div>
  );
}; 