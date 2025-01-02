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
    <div className="flex flex-col gap-0.5 p-1 bg-black/40 text-white/90 backdrop-blur">
      {arrows.map(({ key, label }) => (
        <div key={key} className="flex items-center justify-between gap-1">
          <label className="text-[10px] text-white/70 font-mono">{label}</label>
          <input
            type="checkbox"
            checked={getArrowVisibility(key)}
            onChange={(e: ChangeEvent<HTMLInputElement>) => spacecraft?.toggleArrow?.(key, e.target.checked)}
            className="w-3 h-3 rounded border-white/30 bg-black/40 checked:bg-cyan-300/40 checked:border-cyan-300/60 focus:ring-0 focus:ring-offset-0"
          />
        </div>
      ))}
    </div>
  );
}; 