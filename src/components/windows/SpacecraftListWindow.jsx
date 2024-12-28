import React, { useMemo } from 'react';
import { Plus, Trash2 } from 'lucide-react';

export function SpacecraftListWindow({ world, activeSpacecraft, onCreateSpacecraft, onSelectSpacecraft, onDeleteSpacecraft, version }) {
  const otherSpacecraft = useMemo(() => {
    console.log('SpacecraftListWindow: Recalculating spacecraft list, version:', version);
    console.log('SpacecraftListWindow: World object:', world ? 'exists' : 'undefined');
    console.log('SpacecraftListWindow: World spacecraft array:', world?.spacecraft ? 'exists' : 'undefined');
    console.log('SpacecraftListWindow: World spacecraft count:', world?.spacecraft?.length);
    console.log('SpacecraftListWindow: Active spacecraft:', activeSpacecraft?.name);
    console.log('SpacecraftListWindow: World spacecraft names:', world?.spacecraft?.map(s => s.name));
    
    const filtered = world?.spacecraft?.filter(s => s !== activeSpacecraft) || [];
    console.log('SpacecraftListWindow: Filtered spacecraft:', filtered.map(s => s.name));
    
    return filtered;
  }, [world?.spacecraft, activeSpacecraft, version]);

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
        {/* Active spacecraft */}
        {activeSpacecraft && (
          <div
            className="flex items-center gap-2 px-2 py-1 rounded border text-xs font-mono bg-cyan-500/30 border-cyan-500/50 text-white"
          >
            <button className="flex-grow text-left">
              {activeSpacecraft.name} (Active)
            </button>
          </div>
        )}

        {/* Other spacecraft */}
        {otherSpacecraft.length > 0 ? (
          otherSpacecraft.map(spacecraft => (
            <div
              key={spacecraft.name}
              className="flex items-center gap-2 px-2 py-1 rounded border text-xs font-mono bg-black/60 border-white/20 text-white/90 hover:bg-white/20"
            >
              {/* Spacecraft Name & Selection */}
              <button
                className="flex-grow text-left"
                onClick={() => onSelectSpacecraft(spacecraft)}
              >
                {spacecraft.name}
              </button>

              {/* Delete Button */}
              <button
                className="text-red-400/70 hover:text-red-400 transition-colors"
                onClick={() => onDeleteSpacecraft(spacecraft)}
                title="Delete Spacecraft"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))
        ) : (
          <div className="text-white/50 italic text-center bg-black/40 p-2 rounded border border-white/10">
            No other spacecraft available
          </div>
        )}
      </div>
    </div>
  );
} 