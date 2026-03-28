import React, { ChangeEvent, useState } from 'react';
import { useSettings, setUiTheme, setAttitudeSphereTexture } from '../../state/store';
import { BasicWorld } from '../../core/BasicWorld';

interface SettingsWindowProps {
  world: BasicWorld | null;
}

const themes: { id: 'a' | 'b' | 'c'; label: string }[] = [
  { id: 'a', label: 'Cyan' },
  { id: 'b', label: 'Airforce' },
  { id: 'c', label: 'Sky' },
];

const textures: { path: string; label: string }[] = [
  { path: '/images/textures/rLHbWVB.png', label: 'Default' },
  { path: '/images/textures/GheWNEF.png', label: 'Alternate A' },
  { path: '/images/textures/pF3BC6V.png', label: 'Alternate B' },
];

export const SettingsWindow: React.FC<SettingsWindowProps> = ({ world }) => {
  const settings = useSettings();
  const [thrusterLights, setThrusterLights] = useState(true);
  const [thrusterParticles, setThrusterParticles] = useState(true);

  const applyToAll = (fn: (sc: any) => void) => {
    const list = world?.getSpacecraftList?.() ?? [];
    for (const sc of list) fn(sc);
  };

  const handleThrusterLightsToggle = (e: ChangeEvent<HTMLInputElement>) => {
    const enabled = e.target.checked;
    setThrusterLights(enabled);
    applyToAll(sc => sc.rcsVisuals?.setThrusterLightsEnabled(enabled));
  };

  const handleThrusterParticlesToggle = (e: ChangeEvent<HTMLInputElement>) => {
    const enabled = e.target.checked;
    setThrusterParticles(enabled);
    applyToAll(sc => sc.rcsVisuals?.setThrusterParticlesEnabled(enabled));
  };

  return (
    <div className="flex flex-col gap-1.5 p-1 bg-black/40 text-white/90 backdrop-blur">
      {/* Theme */}
      <div className="flex flex-col gap-0.5">
        <label className="text-[10px] text-cyan-300/90 font-medium uppercase">Theme</label>
        <div className="flex gap-1">
          {themes.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setUiTheme(id)}
              className={`flex-1 px-2 py-1 text-[10px] font-mono rounded transition-colors ${
                settings.uiTheme === id
                  ? 'bg-cyan-300/30 border border-cyan-300/60 text-white'
                  : 'bg-black/40 border border-white/20 text-white/70 hover:bg-white/10'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Attitude Sphere Texture */}
      <div className="flex flex-col gap-0.5">
        <label className="text-[10px] text-cyan-300/90 font-medium uppercase">Attitude Sphere</label>
        <select
          value={settings.attitudeSphereTexture}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => setAttitudeSphereTexture(e.target.value)}
          className="text-[10px] font-mono bg-black/40 text-white/90 border border-white/20 rounded px-1 py-0.5 focus:outline-none focus:border-cyan-500/50"
        >
          {textures.map(({ path, label }) => (
            <option key={path} value={path}>{label}</option>
          ))}
        </select>
      </div>

      {/* Thruster Effects */}
      <div className="flex flex-col gap-0.5">
        <label className="text-[10px] text-cyan-300/90 font-medium uppercase">Thruster Effects</label>
        <div className="flex items-center justify-between gap-1">
          <label className="text-[10px] text-white/70 font-mono">Point Lights</label>
          <input
            type="checkbox"
            checked={thrusterLights}
            onChange={handleThrusterLightsToggle}
            className="w-3 h-3 rounded border-white/30 bg-black/40 checked:bg-cyan-300/40 checked:border-cyan-300/60 focus:ring-0 focus:ring-offset-0"
          />
        </div>
        <div className="flex items-center justify-between gap-1">
          <label className="text-[10px] text-white/70 font-mono">Exhaust Particles</label>
          <input
            type="checkbox"
            checked={thrusterParticles}
            onChange={handleThrusterParticlesToggle}
            className="w-3 h-3 rounded border-white/30 bg-black/40 checked:bg-cyan-300/40 checked:border-cyan-300/60 focus:ring-0 focus:ring-offset-0"
          />
        </div>
      </div>
    </div>
  );
};
