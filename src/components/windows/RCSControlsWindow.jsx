import React from 'react';
import { RangeInput } from '../ui/RangeInput';

export function RCSControlsWindow({ spacecraft }) {
  return (
    <div className="space-y-2">
      <RangeInput
        label="RCS Thrust"
        unit="N"
        value={spacecraft?.rcsThrust ?? 100}
        onChange={(e) => spacecraft?.setRCSThrust?.(parseFloat(e.target.value))}
        min={0}
        max={1000}
        defaultValue={100}
      />
    </div>
  );
} 