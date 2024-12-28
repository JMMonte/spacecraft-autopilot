import React from 'react';
import { NumberInput } from '../ui/NumberInput';

export function PIDControllerWindow({ controller }) {
  const gains = [
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
          value={controller?.[key] ?? 0}
          onChange={(e) => controller?.setGains?.({ [key]: parseFloat(e.target.value) })}
        />
      ))}
    </div>
  );
} 