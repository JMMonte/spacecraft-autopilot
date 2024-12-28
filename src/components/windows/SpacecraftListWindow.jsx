import React from 'react';
import { Plus, Trash2 } from 'lucide-react';

export function SpacecraftListWindow({ world, activeSpacecraft, onCreateSpacecraft, onSelectSpacecraft, onDeleteSpacecraft }) {
  return (
    <div className="flex flex-col gap-2">
      {/* Create New Spacecraft Button */}
      <button
        className="px-2 py-1 bg-cyan-500/30 text-white/90 text-xs rounded hover:bg-cyan-500/50 transition-colors duration-200 border border-cyan-500/50 flex items-center justify-center gap-1 font-mono drop-shadow-md"
        onClick={onCreateSpacecraft}
      >
        <Plus size={14} />
        New Spacecraft
      </button>

      {/* Spacecraft List */}
      <div className="flex flex-col gap-1">
        {world.spacecraft.map(spacecraft => (
          <div
            key={spacecraft.name}
            className={`flex items-center gap-2 px-2 py-1 rounded border text-xs font-mono ${
              spacecraft === activeSpacecraft
                ? 'bg-cyan-500/30 border-cyan-500/50 text-white'
                : 'bg-black/60 border-white/20 text-white/90 hover:bg-white/20'
            }`}
          >
            {/* Spacecraft Name & Selection */}
            <button
              className="flex-grow text-left"
              onClick={() => onSelectSpacecraft(spacecraft)}
            >
              {spacecraft.name}
            </button>

            {/* Delete Button (hidden for active spacecraft) */}
            {spacecraft !== activeSpacecraft && (
              <button
                className="text-red-400/70 hover:text-red-400 transition-colors"
                onClick={() => onDeleteSpacecraft(spacecraft)}
                title="Delete Spacecraft"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
} 