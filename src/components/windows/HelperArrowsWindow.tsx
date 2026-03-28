import React, { ChangeEvent } from 'react';
import { Spacecraft } from '../../core/spacecraft';
import { BasicWorld } from '../../core/BasicWorld';
import { setGridVisible, useUi, useTraceSettings, setTraceSettings } from '../../state/store';
import type { TraceSettings } from '../../state/store';
import { CHECKBOX, WINDOW_BODY, FIELD_LABEL, FIELD_ROW, SELECT_DISABLED } from '../ui/styles';

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

  const handleGridToggle = (e: ChangeEvent<HTMLInputElement>) => {
    const v = e.target.checked;
    setGridVisible(v);
    // Also apply directly when a world reference is provided (BasicWorld may not
    // subscribe to the store in all setups)
    world?.setGridVisible?.(v);
  };

  return (
    <div className={WINDOW_BODY}>
      <div className={FIELD_ROW}>
        <label className={FIELD_LABEL}>Show Grid</label>
        <input type="checkbox" checked={ui.gridVisible} onChange={handleGridToggle} className={CHECKBOX} />
      </div>
      <div className={FIELD_ROW}>
        <label className={FIELD_LABEL}>Show Path</label>
        <input
          type="checkbox"
          checked={!!spacecraft?.isPathVisible?.()}
          onChange={(e: ChangeEvent<HTMLInputElement>) => spacecraft?.togglePath?.(e.target.checked)}
          className={CHECKBOX}
        />
      </div>
      <div className={FIELD_ROW}>
        <label className={FIELD_LABEL}>Show Trace Lines</label>
        <input
          type="checkbox"
          checked={!!spacecraft?.showTraceLines}
          onChange={(e: ChangeEvent<HTMLInputElement>) => spacecraft?.toggleTraceLines?.(e.target.checked)}
          className={CHECKBOX}
        />
      </div>
      {/* Scientific gradient controls */}
      <div className={FIELD_ROW}>
        <label className={FIELD_LABEL}>Scientific Gradient</label>
        <input
          type="checkbox"
          checked={traceSettings.gradientEnabled}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setTraceSettings({ gradientEnabled: e.target.checked })}
          className={CHECKBOX}
        />
      </div>
      <div className={FIELD_ROW}>
        <label className={FIELD_LABEL}>Metric</label>
        <select
          value={traceSettings.gradientMode}
          onChange={(e) => setTraceSettings({ gradientMode: e.target.value as TraceSettings['gradientMode'] })}
          disabled={!traceSettings.gradientEnabled || !spacecraft?.showTraceLines}
          className={SELECT_DISABLED}
        >
          <option value="velocity">Velocity</option>
          <option value="acceleration">Acceleration</option>
          <option value="forceAbs">Thrust Sum</option>
          <option value="forceNet">Thrust Net</option>
        </select>
      </div>
      <div className={FIELD_ROW}>
        <label className={FIELD_LABEL}>Palette</label>
        <select
          value={traceSettings.palette}
          onChange={(e) => setTraceSettings({ palette: e.target.value as TraceSettings['palette'] })}
          disabled={!traceSettings.gradientEnabled || !spacecraft?.showTraceLines}
          className={SELECT_DISABLED}
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
        <div key={key} className={FIELD_ROW}>
          <label className={FIELD_LABEL}>{label}</label>
          <input
            type="checkbox"
            checked={getArrowVisibility(key)}
            onChange={(e: ChangeEvent<HTMLInputElement>) => spacecraft?.toggleArrow?.(key, e.target.checked)}
            className={CHECKBOX}
          />
        </div>
      ))}
    </div>
  );
};
