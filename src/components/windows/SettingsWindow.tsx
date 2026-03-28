import React, { ChangeEvent } from 'react';
import {
  useSettings,
  setUiTheme,
  setAttitudeSphereTexture,
  setThrusterLights,
  setThrusterParticles,
} from '../../state/store';
import { BasicWorld } from '../../core/BasicWorld';
import { Spacecraft } from '../../core/spacecraft';
import { CHECKBOX, SECTION_HEADER, FIELD_LABEL, SELECT } from '../ui/styles';

interface SettingsWindowProps {
  world: BasicWorld | null;
}

const THEMES: { id: 'a' | 'b' | 'c'; label: string }[] = [
  { id: 'a', label: 'Cyan' },
  { id: 'b', label: 'Airforce' },
  { id: 'c', label: 'Sky' },
];

const TEXTURES: { path: string; label: string }[] = [
  { path: '/images/textures/rLHbWVB.png', label: 'Default' },
  { path: '/images/textures/GheWNEF.png', label: 'Alternate A' },
  { path: '/images/textures/pF3BC6V.png', label: 'Alternate B' },
];

export const SettingsWindow: React.FC<SettingsWindowProps> = ({ world }) => {
  const settings = useSettings();

  const applyToAll = (fn: (sc: Spacecraft) => void) => {
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
        <label className={SECTION_HEADER}>Theme</label>
        <div className="flex gap-1">
          {THEMES.map(({ id, label }) => (
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
        <label className={SECTION_HEADER}>Attitude Sphere</label>
        <select
          value={settings.attitudeSphereTexture}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => setAttitudeSphereTexture(e.target.value)}
          className={SELECT}
        >
          {TEXTURES.map(({ path, label }) => (
            <option key={path} value={path}>{label}</option>
          ))}
        </select>
      </div>

      {/* Thruster Effects */}
      <div className="flex flex-col gap-0.5">
        <label className={SECTION_HEADER}>Thruster Effects</label>
        <div className="flex items-center justify-between gap-1">
          <label className={FIELD_LABEL}>Point Lights</label>
          <input
            type="checkbox"
            checked={settings.thrusterLights}
            onChange={handleThrusterLightsToggle}
            className={CHECKBOX}
          />
        </div>
        <div className="flex items-center justify-between gap-1">
          <label className={FIELD_LABEL}>Exhaust Particles</label>
          <input
            type="checkbox"
            checked={settings.thrusterParticles}
            onChange={handleThrusterParticlesToggle}
            className={CHECKBOX}
          />
        </div>
      </div>
    </div>
  );
};
