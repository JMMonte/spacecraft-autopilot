import React from 'react';

interface ValueDisplayProps {
  label: string;
  value: string;
}

export const ValueDisplay: React.FC<ValueDisplayProps> = ({ label, value }) => {
  return (
    <div className="flex justify-between items-center text-[10px] text-white/90">
      <span className="text-white/70">{label}:</span>
      <span className="text-white/90 font-mono">{value}</span>
    </div>
  );
}; 