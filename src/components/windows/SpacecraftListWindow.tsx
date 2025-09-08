import { useMemo } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { BasicWorld } from '../../core/BasicWorld';
import { Spacecraft } from '../../core/spacecraft';

interface SpacecraftListWindowProps {
  world: BasicWorld | null;
  activeSpacecraft: Spacecraft | null;
  onCreateSpacecraft: () => void;
  onSelectSpacecraft: (spacecraft: Spacecraft) => void;
  onDeleteSpacecraft: (spacecraft: Spacecraft) => void;
  version: number;
}

export function SpacecraftListWindow({ 
  world, 
  activeSpacecraft, 
  onCreateSpacecraft, 
  onSelectSpacecraft, 
  onDeleteSpacecraft, 
  version 
}: SpacecraftListWindowProps) {
  const spacecraftList = useMemo(() => {
    // Get spacecraft list from BasicWorld in creation order
    return world?.getSpacecraftList() ?? [];
  }, [world, version]);

  return (
    <div className="flex flex-col gap-2">
      {/* Create New Spacecraft Button */}
      <button
        className="px-1 py-0.5 bg-cyan-500/30 text-white/90 text-[10px] rounded hover:bg-cyan-500/50 transition-colors duration-200 border border-cyan-500/50 flex items-center justify-center gap-1 font-mono drop-shadow-md"
        onClick={onCreateSpacecraft}
      >
        <Plus size={14} />
        New Spacecraft
      </button>

      {/* Spacecraft List */}
      <div className="flex flex-col gap-1">
        {spacecraftList.length > 0 ? (
          spacecraftList.map((spacecraft: Spacecraft) => {
            const isActive = spacecraft === activeSpacecraft;
            const containerClass = isActive
              ? 'bg-cyan-500/30 border-cyan-500/50 text-white'
              : 'bg-black/40 border-white/20 text-white/90 hover:bg-white/20';
            return (
              <div
                key={spacecraft.name}
                className={`flex items-center gap-2 px-1 py-0.5 rounded border text-[10px] font-mono ${containerClass}`}
              >
                {/* Spacecraft Name & Selection */}
                <button
                  className="flex-grow text-left"
                  onClick={() => !isActive && onSelectSpacecraft(spacecraft)}
                  disabled={isActive}
                >
                  {spacecraft.name}{isActive ? ' (Active)' : ''}
                </button>

                {/* Delete Button for non-active spacecraft */}
                {!isActive && (
                  <button
                    className="text-red-400/70 hover:text-red-400 transition-colors"
                    onClick={() => onDeleteSpacecraft(spacecraft)}
                    title="Delete Spacecraft"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            );
          })
        ) : (
          <div className="text-white/50 italic text-center bg-black/40 p-1 rounded border border-white/10 text-[10px]">
            No spacecraft available
          </div>
        )}
      </div>
    </div>
  );
}
