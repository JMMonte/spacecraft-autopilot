import React, { ChangeEvent } from 'react';
import { Spacecraft } from '../../core/spacecraft';
import { BasicWorld } from '../../core/BasicWorld';
import { setGridVisible, useUi, useTraceSettings, setTraceSettings } from '../../state/store';

interface HelperArrowsWindowProps {
  spacecraft: Spacecraft | null;
  world?: BasicWorld | null;
}

interface ArrowConfig {
  key: 'velocity' | 'angularVelocity';
  label: string;
}

export const HelperArrowsWindow: React.FC<HelperArrowsWindowProps> = ({ spacecraft, world }) => {
  const arrows: ArrowConfig[] = [
    { key: 'velocity', label: 'Show Velocity' },
    { key: 'angularVelocity', label: 'Show Angular Velocity' }
  ];
  const ui = useUi();
  const traceSettings = useTraceSettings();

  const getArrowVisibility = (key: ArrowConfig['key']): boolean => {
    if (!spacecraft) return false;
    return key === 'velocity' ? spacecraft.showVelocityArrow : spacecraft.showAngularVelocityArrow;
  };

  return (
    <div className="flex flex-col gap-0.5 p-1 bg-black/40 text-white/90 backdrop-blur">
      <div className="flex items-center justify-between gap-1">
        <label className="text-[10px] text-white/70 font-mono">Show Grid</label>
        <input
          type="checkbox"
          checked={ui.gridVisible}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            const v = e.target.checked;
            // Update global store; BasicWorld listens and applies scene change
            setGridVisible(v);
            // Also apply directly when a world reference is provided
            world?.setGridVisible?.(v);
          }}
          className="w-3 h-3 rounded border-white/30 bg-black/40 checked:bg-cyan-300/40 checked:border-cyan-300/60 focus:ring-0 focus:ring-offset-0"
        />
      </div>
      <div className="flex items-center justify-between gap-1">
        <label className="text-[10px] text-white/70 font-mono">Show Path</label>
        <input
          type="checkbox"
          checked={!!spacecraft?.isPathVisible?.()}
          onChange={(e: ChangeEvent<HTMLInputElement>) => spacecraft?.togglePath?.(e.target.checked)}
          className="w-3 h-3 rounded border-white/30 bg-black/40 checked:bg-cyan-300/40 checked:border-cyan-300/60 focus:ring-0 focus:ring-offset-0"
        />
      </div>
      <div className="flex items-center justify-between gap-1">
        <label className="text-[10px] text-white/70 font-mono">Show Trace Lines</label>
        <input
          type="checkbox"
          checked={!!spacecraft?.showTraceLines}
          onChange={(e: ChangeEvent<HTMLInputElement>) => spacecraft?.toggleTraceLines?.(e.target.checked)}
          className="w-3 h-3 rounded border-white/30 bg-black/40 checked:bg-cyan-300/40 checked:border-cyan-300/60 focus:ring-0 focus:ring-offset-0"
        />
      </div>
      {/* Scientific gradient controls */}
      <div className="flex items-center justify-between gap-1">
        <label className="text-[10px] text-white/70 font-mono">Scientific Gradient</label>
        <input
          type="checkbox"
          checked={traceSettings.gradientEnabled}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setTraceSettings({ gradientEnabled: e.target.checked })}
          className="w-3 h-3 rounded border-white/30 bg-black/40 checked:bg-cyan-300/40 checked:border-cyan-300/60 focus:ring-0 focus:ring-offset-0"
        />
      </div>
      <div className="flex items-center justify-between gap-1">
        <label className="text-[10px] text-white/70 font-mono">Metric</label>
        <select
          value={traceSettings.gradientMode}
          onChange={(e) => setTraceSettings({ gradientMode: e.target.value as any })}
          disabled={!traceSettings.gradientEnabled || !spacecraft?.showTraceLines}
          className="text-[10px] font-mono bg-black/40 text-white/90 border border-white/20 rounded px-1 py-0.5 disabled:opacity-40"
        >
          <option value="velocity">Velocity</option>
          <option value="acceleration">Acceleration</option>
          <option value="forceAbs">Thrust Sum</option>
          <option value="forceNet">Thrust Net</option>
        </select>
      </div>
      <div className="flex items-center justify-between gap-1">
        <label className="text-[10px] text-white/70 font-mono">Palette</label>
        <select
          value={traceSettings.palette}
          onChange={(e) => setTraceSettings({ palette: e.target.value as any })}
          disabled={!traceSettings.gradientEnabled || !spacecraft?.showTraceLines}
          className="text-[10px] font-mono bg-black/40 text-white/90 border border-white/20 rounded px-1 py-0.5 disabled:opacity-40"
        >
          <option value="turbo">Turbo</option>
          <option value="viridis">Viridis</option>
        </select>
      </div>
      <div className="flex items-center justify-end gap-1">
        <button
          onClick={() => spacecraft?.clearTraceLines?.()}
          disabled={!spacecraft || !spacecraft.showTraceLines}
          className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-white/10 text-white/80 hover:bg-white/20 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Clear Trace
        </button>
      </div>
      {arrows.map(({ key, label }) => (
        <div key={key} className="flex items-center justify-between gap-1">
          <label className="text-[10px] text-white/70 font-mono">{label}</label>
          <input
            type="checkbox"
            checked={getArrowVisibility(key)}
            onChange={(e: ChangeEvent<HTMLInputElement>) => spacecraft?.toggleArrow?.(key, e.target.checked)}
            className="w-3 h-3 rounded border-white/30 bg-black/40 checked:bg-cyan-300/40 checked:border-cyan-300/60 focus:ring-0 focus:ring-offset-0"
          />
        </div>
      ))}
    </div>
  );
};
