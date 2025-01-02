import React from 'react';
import { ValueDisplay } from './ValueDisplay';

interface RangeInputProps {
  label: string;
  value: number | null;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  min: number;
  max: number;
  unit?: string;
  defaultValue?: number | null;
  step?: number | null;
  className?: string;
}

export const RangeInput: React.FC<RangeInputProps> = ({ 
  label, 
  value, 
  onChange, 
  min, 
  max, 
  unit = "", 
  defaultValue = null,
  step = null,
  className = ""
}) => {
  const displayValue: number | null = value ?? defaultValue;
  
  return (
    <div className={className}>
      <label className="text-[10px] text-white/70 font-mono block mb-0.5">
        {label} {unit}
      </label>
      <input
        type="range"
        min={min}
        max={max}
        step={step ?? undefined}
        value={displayValue ?? undefined}
        onChange={onChange}
        className="w-full h-1 bg-white/20 rounded-full appearance-none cursor-pointer"
      />
      <ValueDisplay 
        label="Current" 
        value={displayValue !== null ? displayValue.toFixed(1) : ''} 
      />
    </div>
  );
}; 