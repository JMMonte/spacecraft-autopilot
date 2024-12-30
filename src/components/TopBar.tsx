import React from 'react';
import { 
  BarChart2, 
  Crosshair, 
  Ruler, 
  Rocket, 
  ArrowRight, 
  Settings, 
  Cpu,
  Plus,
  List
} from 'lucide-react';
import { WINDOWS } from '../constants';

interface TopBarProps {
  visibleWindows: Record<string, boolean>;
  onToggleWindow: (windowName: string) => void;
  onCreateNewSpacecraft: () => void;
}

const WINDOW_ICONS = {
  telemetry: BarChart2,
  horizon: Crosshair,
  dimensions: Ruler,
  rcs: Rocket,
  arrows: ArrowRight,
  pid: Settings,
  autopilot: Cpu,
  spacecraftList: List
};

export const TopBar: React.FC<TopBarProps> = ({ visibleWindows, onToggleWindow, onCreateNewSpacecraft }) => {
  return (
    <div className="fixed top-0 left-0 right-0 h-8 bg-black/60 backdrop-blur-md z-50 flex items-center px-2 border-b border-white/20 pointer-events-auto">
      <div className="flex gap-1">
        <button
          className="px-2 py-0.5 bg-cyan-500/30 text-white/90 text-xs rounded hover:bg-cyan-500/50 transition-colors duration-200 border border-cyan-500/50 flex items-center gap-1 font-mono drop-shadow-md"
          onClick={onCreateNewSpacecraft}
        >
          <Plus size={14} />
          New Spacecraft
        </button>
        {Object.entries(WINDOWS).map(([key, { label }]) => {
          const Icon = WINDOW_ICONS[key as keyof typeof WINDOW_ICONS];
          return (
            <button
              key={key}
              className={`px-2 py-0.5 bg-black/60 text-white/90 text-xs rounded hover:bg-white/20 transition-colors duration-200 border border-white/20 flex items-center gap-1 font-mono drop-shadow-md ${
                visibleWindows[key] ? 'bg-white/20 text-white' : ''
              }`}
              onClick={() => onToggleWindow(key)}
            >
              <Icon size={14} />
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}; 