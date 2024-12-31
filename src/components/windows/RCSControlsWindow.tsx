import React, { ChangeEvent } from 'react';
import { RangeInput } from '../ui/RangeInput';
import { Spacecraft } from '../../core/spacecraft';

interface RCSControlsWindowProps {
  spacecraft: Spacecraft | null;
}

export const RCSControlsWindow: React.FC<RCSControlsWindowProps> = ({ spacecraft }) => {
  return (
    <div className="space-y-2">
      <RangeInput
        label="RCS Thrust"
        unit="N"
        value={spacecraft?.spacecraftController?.getThrust() ?? 100}
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          if (spacecraft?.spacecraftController) {
            spacecraft.spacecraftController.setThrust(parseFloat(e.target.value));
          }
        }}
        min={0}
        max={1000}
        defaultValue={100}
      />
    </div>
  );
}; 