import React, { ChangeEvent } from 'react';
import { RangeInput } from '../ui/RangeInput';
import { Spacecraft } from '../../core/spacecraft';

interface DimensionsWindowProps {
  spacecraft: Spacecraft | null;
}

interface DimensionConfig {
  key: 'length' | 'width' | 'height';
  label: string;
  unit: string;
}

export const DimensionsWindow: React.FC<DimensionsWindowProps> = ({ spacecraft }) => {
  const dimensions: DimensionConfig[] = [
    { key: 'length', label: 'Length', unit: 'm' },
    { key: 'width', label: 'Width', unit: 'm' },
    { key: 'height', label: 'Height', unit: 'm' }
  ];

  const handleDimensionChange = (key: 'length' | 'width' | 'height', value: number) => {
    if (!spacecraft?.objects) return;

    const currentWidth = spacecraft.objects.boxWidth;
    const currentHeight = spacecraft.objects.boxHeight;
    const currentDepth = spacecraft.objects.boxDepth;

    // Update the appropriate dimension
    let newWidth = currentWidth;
    let newHeight = currentHeight;
    let newDepth = currentDepth;

    if (key === 'width') newWidth = value;
    else if (key === 'height') newHeight = value;
    else if (key === 'length') newDepth = value;

    // Update the box with new dimensions
    spacecraft.objects.updateBox(newWidth, newHeight, newDepth);
  };

  return (
    <div className="space-y-2">
      {dimensions.map(({ key, label, unit }) => (
        <RangeInput
          key={key}
          label={label}
          unit={unit}
          value={
            key === 'length' 
              ? spacecraft?.objects?.boxDepth ?? 1 
              : key === 'width' 
                ? spacecraft?.objects?.boxWidth ?? 1 
                : spacecraft?.objects?.boxHeight ?? 1
          }
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            const value = parseFloat(e.target.value);
            handleDimensionChange(key, value);
          }}
          min={1}
          max={20}
          defaultValue={1}
          step={0.1}
        />
      ))}
    </div>
  );
}; 