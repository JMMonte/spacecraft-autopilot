import React from 'react';

export function LoadingOverlay({ progress, status }) {
  return (
    <div className="fixed inset-0 bg-black z-50 flex items-center justify-center">
      <div className="flex flex-col items-center gap-6 max-w-sm mx-auto px-4">
        <div className="text-white/90 text-sm font-mono text-center drop-shadow-md">
          {status}
        </div>
        <div className="w-full bg-white/10 rounded-full h-1 overflow-hidden">
          <div 
            className="h-full bg-cyan-300/30 transition-all duration-300 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </div>
  );
} 