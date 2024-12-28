import React from 'react';

export function ValueDisplay({ label, value }) {
  return (
    <div className="flex justify-between items-center text-white/90 font-mono mb-1 drop-shadow-md">
      <span className="text-cyan-300/90">{label}:</span>
      <span className="text-white font-medium">{value}</span>
    </div>
  );
} 