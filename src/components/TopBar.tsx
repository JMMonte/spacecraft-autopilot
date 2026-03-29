import React, { ChangeEvent, useState } from 'react';
import {
  BarChart2,
  Crosshair,
  Rocket,
  ArrowRight,
  Settings,
  Cpu,
  Plus,
  List,
  Camera,
  SlidersHorizontal,
  LineChart,
  Navigation
} from 'lucide-react';
import { WINDOWS } from '../constants';
import { setCameraMode, useUi } from '../state/store';
import { TOGGLE_GROUP, TOGGLE_OPTION, TOGGLE_ACTIVE, TOGGLE_INACTIVE } from './ui/styles';
import { SCENE_PRESETS } from '../config/scenePresets';
import type { BasicWorld } from '../core/BasicWorld';

interface TopBarProps {
  visibleWindows: Record<string, boolean>;
  onToggleWindow: (windowName: string) => void;
  onCreateNewSpacecraft: () => void;
  world?: BasicWorld | null;
  onSceneLoad?: (presetId: string) => void;
}

const WINDOW_ICONS = {
  telemetry: BarChart2,
  horizon: Crosshair,
  spacecraftConfig: Rocket,
  arrows: ArrowRight,
  pid: Settings,
  autopilot: Cpu,
  spacecraftList: List,
  docking: Navigation,
  dockingCameras: Camera,
  settings: SlidersHorizontal,
  chart: LineChart
};

export const TopBar: React.FC<TopBarProps> = ({ visibleWindows, onToggleWindow, onCreateNewSpacecraft, world, onSceneLoad }) => {
  const { cameraMode } = useUi();
  const [loadingScene, setLoadingScene] = useState(false);
  const currentPresetId = world?.getCurrentScenePresetId() ?? 'default';

  const handleSceneChange = async (e: ChangeEvent<HTMLSelectElement>) => {
    const presetId = e.target.value;
    if (!world || loadingScene) return;
    setLoadingScene(true);
    try {
      await world.loadScenePreset(presetId);
      onSceneLoad?.(presetId);
    } finally {
      setLoadingScene(false);
    }
  };

  return (
    <div className="fixed top-0 left-0 right-0 h-8 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-between px-3 border-b border-white/10 pointer-events-auto">
      {/* Left cluster: brand/new + camera mode */}
      <div className="flex items-center gap-2">
        <button
          className="px-2 h-6 rounded-md bg-accent-30 text-white text-[10px] leading-6 hover:bg-white/20 transition-colors duration-200 flex items-center gap-1"
          onClick={onCreateNewSpacecraft}
          title="Create new spacecraft"
        >
          <Plus size={14} />
          <span className="hidden sm:inline">New</span>
        </button>
        <div className="h-5 w-px bg-white/20" aria-hidden="true" />
        <div className={`${TOGGLE_GROUP} h-6`}>
          <button
            className={`px-2 leading-6 ${TOGGLE_OPTION} ${cameraMode === 'follow' ? TOGGLE_ACTIVE : TOGGLE_INACTIVE}`}
            aria-pressed={cameraMode === 'follow'}
            onClick={() => setCameraMode('follow')}
            title="Camera: Follow"
          >Follow</button>
          <button
            className={`px-2 leading-6 ${TOGGLE_OPTION} ${cameraMode === 'free' ? TOGGLE_ACTIVE : TOGGLE_INACTIVE}`}
            aria-pressed={cameraMode === 'free'}
            onClick={() => setCameraMode('free')}
            title="Camera: Free"
          >Free</button>
        </div>
        <div className="h-5 w-px bg-white/20" aria-hidden="true" />
        <select
          value={currentPresetId}
          onChange={handleSceneChange}
          disabled={loadingScene}
          className="h-6 px-1 rounded-md bg-black/60 text-white/90 text-[10px] border border-white/20 focus:outline-none focus:border-cyan-500/50 disabled:opacity-50 cursor-pointer"
          title="Load scene preset"
        >
          {SCENE_PRESETS.map(({ id, name }) => (
            <option key={id} value={id}>{name}</option>
          ))}
        </select>
      </div>

      {/* Right cluster: window toggles as icons */}
      <div className="flex items-center gap-1">
        {Object.entries(WINDOWS).map(([key, { label }]) => {
          const Icon = WINDOW_ICONS[key as keyof typeof WINDOW_ICONS];
          const active = !!visibleWindows[key];
          return (
            <button
              key={key}
              className={`h-6 w-7 rounded-md flex items-center justify-center text-white/90 hover:bg-white/10 transition-colors duration-150 ${
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
