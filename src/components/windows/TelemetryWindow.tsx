import React from 'react';
import * as THREE from 'three';

interface TelemetryWindowProps {
  telemetry: {
    position: THREE.Vector3;
    velocity: THREE.Vector3;
    orientation: THREE.Quaternion;
    angularVelocity: THREE.Vector3;
    mass: number;
    thrusterStatus: boolean[];
  } | null;
}

const _euler = new THREE.Euler();

function quatToEulerDeg(q: THREE.Quaternion): { pitch: number; yaw: number; roll: number } {
  _euler.setFromQuaternion(q, 'YXZ');
  return {
    pitch: THREE.MathUtils.radToDeg(_euler.x),
    yaw:   THREE.MathUtils.radToDeg(_euler.y),
    roll:  THREE.MathUtils.radToDeg(_euler.z),
  };
}

/** Compact row: label + x/y/z values + optional magnitude. */
function VectorRow({ label, v, decimals = 2, unit, showMag }: {
  label: string;
  v: THREE.Vector3;
  decimals?: number;
  unit?: string;
  showMag?: boolean;
}) {
  const mag = showMag ? v.length() : undefined;
  return (
    <div className="flex items-baseline gap-2 text-[10px]">
      <span className="text-white/70 w-14 shrink-0">{label}</span>
      <span className="font-mono text-white/90">{v.x.toFixed(decimals)}</span>
      <span className="font-mono text-white/90">{v.y.toFixed(decimals)}</span>
      <span className="font-mono text-white/90">{v.z.toFixed(decimals)}</span>
      {mag !== undefined && (
        <span className="font-mono text-cyan-300/90 ml-auto">{mag.toFixed(decimals)}{unit ? ` ${unit}` : ''}</span>
      )}
    </div>
  );
}

/** One row: direction label + a dot per thruster. */
function ThrusterGroup({ label, indices, status }: { label: string; indices: number[]; status: boolean[] }) {
  const active = indices.filter(i => status[i]).length;
  return (
    <div className="flex items-center gap-1">
      <span className={`w-12 shrink-0 text-right ${active > 0 ? 'text-white/90' : 'text-white/50'}`}>{label}</span>
      <div className="flex gap-px">
        {indices.map(i => (
          <div key={i} className={`w-2 h-2 rounded-sm ${status[i] ? 'bg-green-400' : 'bg-white/10'}`} />
        ))}
      </div>
    </div>
  );
}

export const TelemetryWindow: React.FC<TelemetryWindowProps> = ({ telemetry }) => {
  if (!telemetry) return null;

  const att = quatToEulerDeg(telemetry.orientation);

  return (
    <div className="flex flex-col gap-1 text-[10px]">
      {/* Axis header */}
      <div className="flex items-baseline gap-2 text-white/50">
        <span className="w-14 shrink-0" />
        <span>x</span>
        <span>y</span>
        <span>z</span>
      </div>

      <VectorRow label="Position" v={telemetry.position} decimals={1} />
      <VectorRow label="Velocity" v={telemetry.velocity} decimals={2} unit="m/s" showMag />
      <VectorRow label="Ang. vel" v={telemetry.angularVelocity} decimals={3} unit="rad/s" showMag />

      {/* Attitude in degrees */}
      <div className="flex items-baseline gap-2 text-[10px]">
        <span className="text-white/70 w-14 shrink-0">Attitude</span>
        <span className="text-white/50">P</span>
        <span className="font-mono text-white/90">{att.pitch.toFixed(1)}°</span>
        <span className="text-white/50">Y</span>
        <span className="font-mono text-white/90">{att.yaw.toFixed(1)}°</span>
        <span className="text-white/50">R</span>
        <span className="font-mono text-white/90">{att.roll.toFixed(1)}°</span>
      </div>

      {/* Mass — inline */}
      <div className="flex items-baseline gap-2 text-[10px]">
        <span className="text-white/70 w-14 shrink-0">Mass</span>
        <span className="font-mono text-white/90">{telemetry.mass.toFixed(1)} kg</span>
      </div>

      {/* Thrusters — grouped by direction */}
      <div className="flex flex-col gap-0.5 text-[10px] pt-0.5 border-t border-white/10">
        <ThrusterGroup label="Pitch +" indices={[0,2,5,7,8,9,14,15]} status={telemetry.thrusterStatus} />
        <ThrusterGroup label="Pitch −" indices={[1,3,4,6,10,11,12,13]} status={telemetry.thrusterStatus} />
        <ThrusterGroup label="Yaw +"   indices={[0,1,6,7,16,17,22,23]} status={telemetry.thrusterStatus} />
        <ThrusterGroup label="Yaw −"   indices={[2,3,4,5,18,19,20,21]} status={telemetry.thrusterStatus} />
        <ThrusterGroup label="Roll +"  indices={[8,11,13,14,16,18,21,23]} status={telemetry.thrusterStatus} />
        <ThrusterGroup label="Roll −"  indices={[9,10,12,15,17,19,20,22]} status={telemetry.thrusterStatus} />
        <div className="h-px bg-white/10 my-0.5" />
        <ThrusterGroup label="Fwd"     indices={[0,1,2,3]}   status={telemetry.thrusterStatus} />
        <ThrusterGroup label="Back"    indices={[4,5,6,7]}   status={telemetry.thrusterStatus} />
        <ThrusterGroup label="Up"      indices={[12,13,14,15]} status={telemetry.thrusterStatus} />
        <ThrusterGroup label="Down"    indices={[8,9,10,11]}  status={telemetry.thrusterStatus} />
        <ThrusterGroup label="Left"    indices={[16,17,18,19]} status={telemetry.thrusterStatus} />
        <ThrusterGroup label="Right"   indices={[20,21,22,23]} status={telemetry.thrusterStatus} />
      </div>
    </div>
  );
};
