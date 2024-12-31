import React from 'react';

interface NumberInputProps {
  label: string;
  value: number;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  className?: string;
}

export const NumberInput: React.FC<NumberInputProps> = ({ 
  label, 
  value, 
  onChange, 
  className = "" 
}) => {
  return (
    <div className={className}>
      <label className="text-white/90 block mb-1 drop-shadow-md">
        {label}
      </label>
      <input
        type="number"
        value={value}
        onChange={onChange}
        className="bg-black/60 text-white/90 px-1 py-0.5 rounded w-16 border border-white/20 font-mono drop-shadow-md"
      />
    </div>
  );
}; 