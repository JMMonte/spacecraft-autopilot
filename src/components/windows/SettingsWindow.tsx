import React from 'react';
import { useSettings, setAttitudeSphereTexture, setUiTheme } from '../../state/store';

// Available attitude sphere styles (public assets)
const SPHERE_TEXTURES: Array<{ id: 'a' | 'b' | 'c'; label: string; url: string }> = [
  { id: 'a', label: 'Spaceforce', url: '/images/textures/rLHbWVB.png' },
  { id: 'b', label: 'Airforce', url: '/images/textures/GheWNEF.png' },
  { id: 'c', label: 'Navy', url: '/images/textures/pF3BC6V.png' },
];

export const SettingsWindow: React.FC = () => {
  const { attitudeSphereTexture, uiTheme } = useSettings();

  return (
    <div className="space-y-2 text-[11px]">
      <div>
        <h4 className="text-cyan-300/90 font-medium mb-1 drop-shadow-md">Attitude Sphere</h4>
        <div className="grid grid-cols-3 gap-2">
          {SPHERE_TEXTURES.map(tex => {
            const selected = attitudeSphereTexture === tex.url && uiTheme === tex.id;
            return (
              <button
                key={tex.id}
                className={`relative rounded overflow-hidden border transition-colors duration-150 ${
                  selected ? 'border-cyan-400 ring-2 ring-cyan-400/40' : 'border-white/20 hover:border-white/40'
                }`}
                onClick={() => { setAttitudeSphereTexture(tex.url); setUiTheme(tex.id); }}
                title={tex.label}
              >
                <img
                  src={tex.url}
                  alt={tex.label}
                  className="w-full h-16 object-cover opacity-90"
                />
                <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] px-1 py-0.5 text-center">
                  {tex.label}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default SettingsWindow;
