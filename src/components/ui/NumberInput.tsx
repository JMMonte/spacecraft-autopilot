import React from 'react';

interface NumberInputProps {
  label?: string;
  value: number;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  step?: number;
  className?: string;
}

export const NumberInput: React.FC<NumberInputProps> = ({ 
  label, 
  value, 
  onChange,
  step,
  className = "" 
}) => {
  return (
    <div className={className}>
      {label && (
        <label className="text-[10px] text-white/70 font-mono">
          {label}
        </label>
      )}
      <input
        type="number"
        value={value}
        onChange={onChange}
        step={step}
        className="w-full px-1 py-0.5 bg-black/60 text-white/90 border border-white/20 
                  text-[10px] font-mono focus:outline-none focus:border-cyan-500/50"
      />
    </div>
  );
}; 