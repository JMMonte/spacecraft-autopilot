import React from 'react';

export function HelperArrowsWindow({ spacecraft }) {
  const arrows = [
    { key: 'velocity', label: 'Show Velocity' },
    { key: 'angularVelocity', label: 'Show Angular Velocity' }
  ];

  return (
    <div className="space-y-2">
      {arrows.map(({ key, label }) => (
        <div key={key} className="flex items-center justify-between">
          <label className="text-white/90 drop-shadow-md">{label}</label>
          <input
            type="checkbox"
            checked={spacecraft?.[`show${key.charAt(0).toUpperCase() + key.slice(1)}Arrow`] ?? false}
            onChange={(e) => spacecraft?.toggleArrow?.(key, e.target.checked)}
            className="w-3 h-3 rounded border-white/30 bg-black/60 checked:bg-cyan-300/40 checked:border-cyan-300/60 focus:ring-0 focus:ring-offset-0"
          />
        </div>
      ))}
    </div>
  );
} 