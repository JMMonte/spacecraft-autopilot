import { useMemo, useState } from 'react';
import { Plus, Trash2, Box } from 'lucide-react';
import { EMPTY_STATE } from '../ui/styles';
import { BasicWorld } from '../../core/BasicWorld';
import { Spacecraft } from '../../core/spacecraft';

interface SpacecraftListWindowProps {
  world: BasicWorld | null;
  activeSpacecraft: Spacecraft | null;
  onCreateSpacecraft?: () => void;
  onCreateNodeSpacecraft?: (portCount?: 2 | 4 | 6) => void;
  onSelectSpacecraft: (spacecraft: Spacecraft) => void;
  onDeleteSpacecraft: (spacecraft: Spacecraft) => void;
  version: number;
}

const NODE_TYPES: Array<{ ports: 2 | 4 | 6; label: string; desc: string }> = [
  { ports: 2, label: '2p', desc: 'Coupler' },
  { ports: 4, label: '4p', desc: 'Node' },
  { ports: 6, label: '6p', desc: 'Hub' },
];

export function SpacecraftListWindow({
  world,
  activeSpacecraft,
  onCreateSpacecraft,
  onCreateNodeSpacecraft,
  onSelectSpacecraft,
  onDeleteSpacecraft,
  version
}: SpacecraftListWindowProps) {
  const spacecraftList = useMemo(() => {
    return world?.getSpacecraftList() ?? [];
  }, [world, version]);

  const [nodeMenuOpen, setNodeMenuOpen] = useState(false);

  return (
    <div className="flex flex-col gap-1 text-[10px]">
      <div className="flex gap-1">
        <button
          className="flex-1 px-1 py-0.5 text-[10px] text-white/70 hover:text-white/90 hover:bg-white/10 rounded transition-colors flex items-center justify-center gap-1"
          onClick={onCreateSpacecraft}
          disabled={!onCreateSpacecraft}
        >
          <Plus size={12} />
          Spacecraft
        </button>
        <div className="relative flex-1">
          <button
            className="w-full px-1 py-0.5 text-[10px] text-white/70 hover:text-white/90 hover:bg-white/10 rounded transition-colors flex items-center justify-center gap-1"
            onClick={() => setNodeMenuOpen(!nodeMenuOpen)}
            disabled={!onCreateNodeSpacecraft}
          >
            <Box size={12} />
            Node
          </button>
          {nodeMenuOpen && (
            <div className="absolute top-full left-0 right-0 mt-0.5 bg-black/90 border border-white/20 rounded z-50 overflow-hidden">
              {NODE_TYPES.map(nt => (
                <button
                  key={nt.ports}
                  className="w-full px-2 py-1 text-left text-[10px] text-white/70 hover:text-white hover:bg-white/10 transition-colors flex justify-between"
                  onClick={() => { onCreateNodeSpacecraft?.(nt.ports); setNodeMenuOpen(false); }}
                >
                  <span>{nt.desc}</span>
                  <span className="text-white/40">{nt.ports} ports</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col">
        {spacecraftList.length > 0 ? (
          spacecraftList.map((spacecraft: Spacecraft) => {
            const isActive = spacecraft === activeSpacecraft;
            const portCount = Object.keys(spacecraft.dockingPorts).length;
            return (
              <div
                key={spacecraft.name}
                className={`flex items-center gap-2 px-1 py-0.5 rounded transition-colors ${
                  isActive
                    ? 'bg-accent-30 text-white'
                    : 'text-white/90 hover:bg-white/10 cursor-pointer'
                }`}
                onClick={() => !isActive && onSelectSpacecraft(spacecraft)}
              >
                <span className="flex-grow">
                  {spacecraft.name}
                </span>
                <span className="text-white/30">{portCount}p</span>
                {!isActive && (
                  <button
                    className="text-white/50 hover:text-red-400 transition-colors"
                    onClick={(e) => { e.stopPropagation(); onDeleteSpacecraft(spacecraft); }}
                    title="Delete"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            );
          })
        ) : (
          <div className={EMPTY_STATE}>
            No spacecraft available
          </div>
        )}
      </div>
    </div>
  );
}
