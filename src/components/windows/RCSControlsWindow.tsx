import React, { ChangeEvent } from 'react';
import { RangeInput } from '../ui/RangeInput';
import { Spacecraft } from '../../core/spacecraft';

interface RCSControlsWindowProps {
  spacecraft: Spacecraft | null;
}

export const RCSControlsWindow: React.FC<RCSControlsWindowProps> = ({ spacecraft }) => {
  return (
    <div className="flex flex-col gap-0.5 p-1 bg-black/40 text-white/90 backdrop-blur">
      <h3 className="text-cyan-300/90 font-medium text-[10px] uppercase">RCS Thrust</h3>
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
        className="text-[10px] font-mono"
      />
    </div>
  );
}; 
