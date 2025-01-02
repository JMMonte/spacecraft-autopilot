import React from 'react';

interface ValueDisplayProps {
  label: string;
  value: string;
}

export const ValueDisplay: React.FC<ValueDisplayProps> = ({ label, value }) => {
  return (
    <div className="flex justify-between items-center text-[10px] text-white/90 font-mono">
      <span className="text-cyan-300/90">{label}:</span>
      <span className="text-white/90">{value}</span>
    </div>
  );
}; 