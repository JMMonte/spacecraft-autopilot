import React from 'react';
import { RangeInput } from '../ui/RangeInput';

export function DimensionsWindow({ spacecraft }) {
  const dimensions = [
    { key: 'length', label: 'Length', unit: 'm' },
    { key: 'width', label: 'Width', unit: 'm' },
    { key: 'height', label: 'Height', unit: 'm' }
  ];

  return (
    <div className="space-y-2">
      {dimensions.map(({ key, label, unit }) => (
        <RangeInput
          key={key}
          label={label}
          unit={unit}
          value={spacecraft?.dimensions?.[key] ?? 10}
          onChange={(e) => spacecraft?.setDimension?.(key, parseFloat(e.target.value))}
          min={1}
          max={20}
          defaultValue={10}
        />
      ))}
    </div>
  );
} 