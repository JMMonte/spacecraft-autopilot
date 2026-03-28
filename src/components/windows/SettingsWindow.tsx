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
import { CHECKBOX, SECTION_HEADER, FIELD_LABEL, SELECT, TOGGLE_GROUP, TOGGLE_OPTION, TOGGLE_ACTIVE, TOGGLE_INACTIVE } from '../ui/styles';

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
    <div className="flex flex-col gap-1 p-1 text-white/90 text-[10px]">
      {/* Theme */}
      <div className="flex flex-col gap-0.5">
        <label className={SECTION_HEADER}>Theme</label>
        <div className={TOGGLE_GROUP}>
          {THEMES.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setUiTheme(id)}
              className={`flex-1 py-0.5 ${TOGGLE_OPTION} ${
                settings.uiTheme === id ? TOGGLE_ACTIVE : TOGGLE_INACTIVE
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
