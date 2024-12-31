import React, { ChangeEvent } from 'react';
import { Spacecraft } from '../../core/spacecraft';

interface HelperArrowsWindowProps {
  spacecraft: Spacecraft | null;
}

interface ArrowConfig {
  key: 'velocity' | 'angularVelocity';
  label: string;
}

export const HelperArrowsWindow: React.FC<HelperArrowsWindowProps> = ({ spacecraft }) => {
  const arrows: ArrowConfig[] = [
    { key: 'velocity', label: 'Show Velocity' },
    { key: 'angularVelocity', label: 'Show Angular Velocity' }
  ];

  const getArrowVisibility = (key: ArrowConfig['key']): boolean => {
    if (!spacecraft) return false;
    return key === 'velocity' ? spacecraft.showVelocityArrow : spacecraft.showAngularVelocityArrow;
  };

  return (
    <div className="space-y-2">
      {arrows.map(({ key, label }) => (
        <div key={key} className="flex items-center justify-between">
          <label className="text-white/90 drop-shadow-md">{label}</label>
          <input
            type="checkbox"
            checked={getArrowVisibility(key)}
            onChange={(e: ChangeEvent<HTMLInputElement>) => spacecraft?.toggleArrow?.(key, e.target.checked)}
            className="w-3 h-3 rounded border-white/30 bg-black/60 checked:bg-cyan-300/40 checked:border-cyan-300/60 focus:ring-0 focus:ring-offset-0"
          />
        </div>
      ))}
    </div>
  );
}; 