import React from 'react';
import { ValueDisplay } from './ValueDisplay';

export function RangeInput({ 
  label, 
  value, 
  onChange, 
  min, 
  max, 
  unit = "", 
  defaultValue = null,
  step = null
}) {
  const displayValue = value ?? defaultValue;
  
  return (
    <div>
      <label className="text-white/90 block mb-1 drop-shadow-md">
        {label} {unit}
      </label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={displayValue}
        onChange={onChange}
        className="w-full h-1 bg-white/20 rounded-full appearance-none cursor-pointer"
      />
      <ValueDisplay 
        label="Current" 
        value={typeof displayValue === 'number' ? displayValue.toFixed(1) : displayValue} 
      />
    </div>
  );
} 