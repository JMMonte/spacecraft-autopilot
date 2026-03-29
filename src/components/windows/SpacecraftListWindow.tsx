import { useMemo, useState } from 'react';
import { Plus, Trash2, ChevronDown } from 'lucide-react';
import { EMPTY_STATE } from '../ui/styles';
import { BasicWorld } from '../../core/BasicWorld';
import { Spacecraft } from '../../core/spacecraft';

export type BlueprintType =
  | { kind: 'node'; portCount: 2 | 4 | 6 }
  | { kind: 'solar' };

interface SpacecraftListWindowProps {
  world: BasicWorld | null;
  activeSpacecraft: Spacecraft | null;
  onCreateSpacecraft?: () => void;
  onCreateBlueprint?: (bp: BlueprintType) => void;
  onSelectSpacecraft: (spacecraft: Spacecraft) => void;
  onDeleteSpacecraft: (spacecraft: Spacecraft) => void;
  version: number;
}

interface BlueprintMenuItem {
  label: string;
  detail?: string;
  value: BlueprintType;
}

const BLUEPRINT_MENU: BlueprintMenuItem[] = [
  { label: 'Coupler', detail: '2 ports', value: { kind: 'node', portCount: 2 } },
  { label: 'Node', detail: '4 ports', value: { kind: 'node', portCount: 4 } },
  { label: 'Hub', detail: '6 ports', value: { kind: 'node', portCount: 6 } },
  { label: 'Solar', detail: 'panels', value: { kind: 'solar' } },
];

export function SpacecraftListWindow({
  world,
  activeSpacecraft,
  onCreateSpacecraft,
  onCreateBlueprint,
  onSelectSpacecraft,
  onDeleteSpacecraft,
  version
}: SpacecraftListWindowProps) {
  const spacecraftList = useMemo(() => {
    return world?.getSpacecraftList() ?? [];
  }, [world, version]);

  const [menuOpen, setMenuOpen] = useState(false);

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
            onClick={() => setMenuOpen(!menuOpen)}
            disabled={!onCreateBlueprint}
          >
            <Plus size={12} />
            More
            <ChevronDown size={10} />
          </button>
          {menuOpen && (
            <div className="absolute top-full left-0 right-0 mt-0.5 bg-black/90 border border-white/20 rounded z-50 overflow-hidden">
              {BLUEPRINT_MENU.map(item => (
                <button
                  key={item.label}
                  className="w-full px-2 py-1 text-left text-[10px] text-white/70 hover:text-white hover:bg-white/10 transition-colors flex justify-between"
                  onClick={() => { onCreateBlueprint?.(item.value); setMenuOpen(false); }}
                >
                  <span>{item.label}</span>
                  {item.detail && <span className="text-white/40">{item.detail}</span>}
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
                key={spacecraft.uuid}
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
