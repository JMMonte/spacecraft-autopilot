import React, { ChangeEvent } from 'react';
import { RangeInput } from '../ui/RangeInput';
import { Spacecraft } from '../../core/spacecraft';
import { WINDOW_BODY, SECTION_HEADER } from '../ui/styles';

interface RCSControlsWindowProps {
  spacecraft: Spacecraft | null;
}

export const RCSControlsWindow: React.FC<RCSControlsWindowProps> = ({ spacecraft }) => {
  return (
    <div className={WINDOW_BODY}>
      <h3 className={SECTION_HEADER}>RCS Thrust</h3>
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
