import React, { ChangeEvent, useState, useEffect } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { RangeInput } from '../ui/RangeInput';
import { WINDOW_BODY, SECTION_HEADER, CHECKBOX } from '../ui/styles';
import { Spacecraft } from '../../core/spacecraft';
import { FUEL_TYPES, type FuelType } from '../../scenes/modules/SpacecraftBlueprint';

interface SpacecraftConfigWindowProps {
  spacecraft: Spacecraft | null;
}

// ── Collapsible section ─────────────────────────────────────────

function Section({ title, defaultOpen = true, children }: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        className={`${SECTION_HEADER} flex items-center gap-1 w-full text-left hover:text-cyan-200 transition-colors`}
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        {title}
      </button>
      {open && <div className="flex flex-col gap-1 mt-0.5">{children}</div>}
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────

export const SpacecraftConfigWindow: React.FC<SpacecraftConfigWindowProps> = ({ spacecraft }) => {
  // Force re-render on slider changes + periodic fuel level refresh
  const [, setTick] = useState(0);
  const bump = () => setTick(t => t + 1);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 500); // refresh 2x/sec for fuel
    return () => clearInterval(id);
  }, []);

  const hasSolarPanels = (spacecraft?.getSolarPanels().length ?? 0) > 0;
  const hasThrusters = spacecraft?.objects?.modelOptions?.includeThrusters !== false;

  return (
    <div className={WINDOW_BODY}>
      {/* ── Dimensions ──────────────────────────────────────── */}
      <Section title="Dimensions">
        <RangeInput
          label="Length"
          unit="m"
          value={spacecraft?.objects?.boxDepth ?? 2}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            const v = parseFloat(e.target.value);
            if (!spacecraft?.objects) return;
            spacecraft.objects.updateBox(spacecraft.objects.boxWidth, spacecraft.objects.boxHeight, v);
            bump();
          }}
          min={0.1} max={20} defaultValue={2} step={0.1}
          allowOverflow
          className="text-[10px]"
        />
        <RangeInput
          label="Width"
          unit="m"
          value={spacecraft?.objects?.boxWidth ?? 1}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            const v = parseFloat(e.target.value);
            if (!spacecraft?.objects) return;
            spacecraft.objects.updateBox(v, spacecraft.objects.boxHeight, spacecraft.objects.boxDepth);
            bump();
          }}
          min={1} max={20} defaultValue={1} step={0.1}
          className="text-[10px]"
        />
        <RangeInput
          label="Height"
          unit="m"
          value={spacecraft?.objects?.boxHeight ?? 1}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            const v = parseFloat(e.target.value);
            if (!spacecraft?.objects) return;
            spacecraft.objects.updateBox(spacecraft.objects.boxWidth, v, spacecraft.objects.boxDepth);
            bump();
          }}
          min={1} max={20} defaultValue={1} step={0.1}
          className="text-[10px]"
        />
      </Section>

      {/* ── Appearance ──────────────────────────────────────── */}
      <Section title="Appearance" defaultOpen={false}>
        <div className="flex items-center gap-2">
          <span className="text-white/70">Body</span>
          <select
            className="ml-auto text-[10px] bg-black/60 text-white/90 border border-white/20 rounded px-1 py-0.5"
            value={spacecraft?.objects?.bodyPreset ?? 'blue-gold'}
            onChange={(e) => {
              spacecraft?.objects?.setBodyPreset(e.target.value);
              bump();
            }}
          >
            <option value="blue-gold">Blue / Gold</option>
            <option value="gold-silver">Gold / Silver</option>
            <option value="silver">Silver</option>
            <option value="gold">Gold</option>
            <option value="white">White</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-white/70">Trusses</span>
          <select
            className="ml-auto text-[10px] bg-black/60 text-white/90 border border-white/20 rounded px-1 py-0.5"
            value={spacecraft?.objects?.getTrussShape() ?? 'round'}
            onChange={(e) => {
              spacecraft?.objects?.setTrussShape(e.target.value as 'round' | 'square');
              bump();
            }}
          >
            <option value="round">Round</option>
            <option value="square">Square</option>
          </select>
        </div>
      </Section>

      {/* ── RCS Thrust ──────────────────────────────────────── */}
      {hasThrusters && (
        <Section title="RCS Thrust">
          <RangeInput
            label="Thrust"
            unit="N"
            value={spacecraft?.spacecraftController?.getThrust() ?? 100}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              if (spacecraft?.spacecraftController) {
                spacecraft.spacecraftController.setThrust(parseFloat(e.target.value));
                bump();
              }
            }}
            min={0} max={1000} defaultValue={100}
            allowOverflow
            className="text-[10px]"
          />
        </Section>
      )}

      {/* ── Fuel ─────────────────────────────────────────────── */}
      {(() => {
        const fuelTank = spacecraft?.getFuelTank();
        const hasTankGeometry = spacecraft?.objects?.isFuelTankEnabled() ?? false;
        const hasFuel = spacecraft?.hasFuelAccess() ?? false;
        return (
          <Section title="Fuel">
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1 cursor-pointer">
                <input
                  type="checkbox"
                  className={CHECKBOX}
                  checked={hasTankGeometry}
                  onChange={(e) => {
                    spacecraft?.objects?.setFuelTankEnabled(e.target.checked);
                    bump();
                  }}
                />
                <span className="text-white/70">Fuel Tank</span>
              </label>
            </div>
            {hasTankGeometry && fuelTank && (
              <>
                <div className="flex items-center gap-2">
                  <span className="text-white/70">Type</span>
                  <select
                    className="ml-auto text-[10px] bg-black/60 text-white/90 border border-white/20 rounded px-1 py-0.5"
                    value={fuelTank.fuelType}
                    onChange={(e) => {
                      spacecraft?.setFuelType(e.target.value as FuelType);
                      bump();
                    }}
                  >
                    {Object.entries(FUEL_TYPES).map(([key, { label, density }]) => (
                      <option key={key} value={key}>{label} ({density} kg/m³)</option>
                    ))}
                  </select>
                </div>
                {/* Fuel level bar */}
                <div className="flex items-center gap-2">
                  <span className="text-white/70">Level</span>
                  <div className="flex-1 h-2 bg-white/10 rounded overflow-hidden">
                    <div
                      className={`h-full rounded transition-all ${
                        fuelTank.fuelLevel > 0.25 ? 'bg-cyan-400/60' :
                        fuelTank.fuelLevel > 0.1 ? 'bg-yellow-400/60' : 'bg-red-400/60'
                      }`}
                      style={{ width: `${fuelTank.fuelLevel * 100}%` }}
                    />
                  </div>
                  <span className="font-mono text-white/70 text-[10px] w-8 text-right">
                    {Math.round(fuelTank.fuelLevel * 100)}%
                  </span>
                </div>
                <div className="flex justify-between text-white/50">
                  <span>Fuel</span>
                  <span className="font-mono text-white/70">
                    {fuelTank.fuelMass.toFixed(0)} / {fuelTank.fuelCapacity.toFixed(0)} kg
                  </span>
                </div>
                <div className="flex justify-between text-white/50">
                  <span>Isp</span>
                  <span className="font-mono text-white/70">{fuelTank.isp} s</span>
                </div>
                <div className="flex justify-between text-white/50">
                  <span>Thrust</span>
                  <span className="font-mono text-white/70">×{FUEL_TYPES[fuelTank.fuelType].thrustFactor}</span>
                </div>
                <button
                  className="text-[10px] px-1 py-0.5 bg-white/10 hover:bg-white/20 rounded text-white/70 self-start"
                  onClick={() => { fuelTank.refuel(); bump(); }}
                >
                  Refuel
                </button>
              </>
            )}
            {!hasTankGeometry && hasFuel && (
              <div className="text-cyan-300/70 text-[10px]">Fuel via docked craft</div>
            )}
            {hasThrusters && !hasFuel && (
              <div className="text-red-400/80 text-[10px]">
                No fuel — thrusters disabled
              </div>
            )}
          </Section>
        );
      })()}

      {/* ── Solar Panels ────────────────────────────────────── */}
      {hasSolarPanels && (() => {
        // Use first panel as representative for shared config
        const panel = spacecraft!.getSolarPanels()[0];
        const state = panel.getState();
        const progress = panel.getProgress();
        return (
          <Section title="Solar Panels">
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1 cursor-pointer">
                <input
                  type="checkbox"
                  className={CHECKBOX}
                  checked={state === 'deployed' || state === 'deploying'}
                  onChange={(e) => {
                    if (e.target.checked) spacecraft!.deploySolarPanels();
                    else spacecraft!.retractSolarPanels();
                    bump();
                  }}
                />
                <span className="text-white/70">Deployed</span>
              </label>
              <span className="text-white/40 ml-auto">
                {state === 'deploying' || state === 'retracting'
                  ? `${Math.round(progress * 100)}%`
                  : state}
              </span>
            </div>
            <div className="flex justify-between text-white/50">
              <span>Span</span>
              <span className="font-mono text-white/70">{panel.span.toFixed(1)} m</span>
            </div>
            <RangeInput
              label="Panels"
              unit=""
              value={panel.panelCount}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                const v = Math.round(parseFloat(e.target.value));
                spacecraft!.getSolarPanels().forEach(p => p.reconfigure({ panelCount: v }));
                bump();
              }}
              min={1} max={10} defaultValue={4} step={1}
              className="text-[10px]"
            />
            <RangeInput
              label="Panel Width"
              unit="m"
              value={panel.panelWidth}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                const v = parseFloat(e.target.value);
                spacecraft!.getSolarPanels().forEach(p => p.reconfigure({ panelWidth: v }));
                bump();
              }}
              min={0.2} max={3} defaultValue={0.8} step={0.1}
              className="text-[10px]"
            />
            <RangeInput
              label="Boom"
              unit="m"
              value={panel.boomLength}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                const v = parseFloat(e.target.value);
                spacecraft!.getSolarPanels().forEach(p => p.reconfigure({ boomLength: v }));
                bump();
              }}
              min={0.1} max={3} defaultValue={0.5} step={0.1}
              allowOverflow
              className="text-[10px]"
            />
            <RangeInput
              label="Deployed angle"
              unit="°"
              value={panel.deployedAngle}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                const v = parseFloat(e.target.value);
                spacecraft!.getSolarPanels().forEach(p => p.reconfigure({ deployedAngle: v }));
                bump();
              }}
              min={-45} max={45} defaultValue={0} step={5}
              className="text-[10px]"
            />
            <RangeInput
              label="Stowed angle"
              unit="°"
              value={panel.stowedAngle}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                const v = parseFloat(e.target.value);
                spacecraft!.getSolarPanels().forEach(p => p.reconfigure({ stowedAngle: v }));
                bump();
              }}
              min={45} max={90} defaultValue={90} step={5}
              className="text-[10px]"
            />
            <div className="flex items-center gap-2">
              <span className="text-white/70">Side</span>
              <select
                className="ml-auto text-[10px] bg-black/60 text-white/90 border border-white/20 rounded px-1 py-0.5"
                value={panel.placement}
                onChange={(e) => {
                  const v = e.target.value as 'left' | 'right' | 'both';
                  spacecraft!.getSolarPanels().forEach(p => p.reconfigure({ placement: v }));
                  bump();
                }}
              >
                <option value="both">Both</option>
                <option value="left">Left</option>
                <option value="right">Right</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-white/70">Vertical</span>
              <select
                className="ml-auto text-[10px] bg-black/60 text-white/90 border border-white/20 rounded px-1 py-0.5"
                value={panel.verticalPosition}
                onChange={(e) => {
                  const v = e.target.value as 'top' | 'center' | 'bottom';
                  spacecraft!.getSolarPanels().forEach(p => p.reconfigure({ verticalPosition: v }));
                  bump();
                }}
              >
                <option value="center">Center</option>
                <option value="top">Top</option>
                <option value="bottom">Bottom</option>
              </select>
            </div>
          </Section>
        );
      })()}

      {/* ── Info ─────────────────────────────────────────────── */}
      <Section title="Info" defaultOpen={false}>
        <div className="text-white/50 flex flex-col gap-0.5">
          <div className="flex justify-between">
            <span>Name</span>
            <span className="text-white/70">{spacecraft?.name ?? '—'}</span>
          </div>
          <div className="flex justify-between">
            <span>Ports</span>
            <span className="text-white/70">{Object.keys(spacecraft?.dockingPorts ?? {}).length}</span>
          </div>
          <div className="flex justify-between">
            <span>Modules</span>
            <span className="text-white/70">
              {spacecraft?.objects?.modules?.map(m => m.type).join(', ') || 'legacy'}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Mass</span>
            <span className="text-white/70 font-mono">{spacecraft?.objects?.boxBody?.mass?.toFixed(1) ?? '—'} kg</span>
          </div>
        </div>
      </Section>
    </div>
  );
};
