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
  List,
  Camera,
  SlidersHorizontal
} from 'lucide-react';
import { WINDOWS } from '../constants';
import { setCameraMode, useUi } from '../state/store';

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
  spacecraftList: List,
  dockingCameras: Camera
  ,settings: SlidersHorizontal
};

export const TopBar: React.FC<TopBarProps> = ({ visibleWindows, onToggleWindow, onCreateNewSpacecraft }) => {
  const { cameraMode } = useUi();
  return (
    <div className="fixed top-0 left-0 right-0 h-8 bg-black/40 backdrop-blur-md z-50 flex items-center justify-between px-3 border-b border-white/20 pointer-events-auto">
      {/* Left cluster: brand/new + camera mode */}
      <div className="flex items-center gap-2">
        <button
          className="px-2 h-6 rounded-md bg-accent-30 text-white text-[11px] leading-6 hover:bg-white/20 transition-colors duration-200 flex items-center gap-1"
          onClick={onCreateNewSpacecraft}
          title="Create new spacecraft"
        >
          <Plus size={14} />
          <span className="hidden sm:inline">New</span>
        </button>
        <div className="h-5 w-px bg-white/20" aria-hidden="true" />
        <div className="inline-flex items-center h-6 rounded-md overflow-hidden border border-white/20">
          <button
            className={`px-2 text-[11px] leading-6 transition-colors duration-200 ${
              cameraMode === 'follow' ? 'bg-accent-30 text-white' : 'text-white/80 hover:bg-white/10'
            }`}
            aria-pressed={cameraMode === 'follow'}
            onClick={() => setCameraMode('follow')}
            title="Camera: Follow"
          >
            Follow
          </button>
          <button
            className={`px-2 text-[11px] leading-6 transition-colors duration-200 ${
              cameraMode === 'free' ? 'bg-accent-30 text-white' : 'text-white/80 hover:bg-white/10'
            }`}
            aria-pressed={cameraMode === 'free'}
            onClick={() => setCameraMode('free')}
            title="Camera: Free"
          >
            Free
          </button>
        </div>
      </div>

      {/* Right cluster: window toggles as icons */}
      <div className="flex items-center gap-1">
        {Object.entries(WINDOWS).map(([key, { label }]) => {
          const Icon = WINDOW_ICONS[key as keyof typeof WINDOW_ICONS];
          const active = !!visibleWindows[key];
          return (
            <button
              key={key}
              className={`h-6 w-7 rounded-md flex items-center justify-center text-white/85 hover:bg-white/10 transition-colors duration-150 ${
                active ? 'bg-accent-30 text-white' : ''
              }`}
              aria-pressed={active}
              title={label}
              onClick={() => onToggleWindow(key)}
            >
              <Icon size={14} />
            </button>
          );
        })}
      </div>
    </div>
  );
};
