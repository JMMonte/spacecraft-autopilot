import React from 'react';

interface ArtificialHorizonWindowProps {
  horizonRef: React.RefObject<HTMLCanvasElement>;
}

export const ArtificialHorizonWindow: React.FC<ArtificialHorizonWindowProps> = ({ horizonRef }) => {
  return (
    <div className="w-[200px] h-[200px] flex justify-center items-center bg-black/60 border border-white/20 rounded-full overflow-hidden shadow-[inset_0_2px_4px_rgba(0,0,0,0.3)]">
      <canvas ref={horizonRef} className="w-full h-full" />
    </div>
  );
}; 