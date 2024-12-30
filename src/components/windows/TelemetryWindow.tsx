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

interface TelemetrySection {
  title: string;
  values: Record<string, number>;
}

export const TelemetryWindow: React.FC<TelemetryWindowProps> = ({ telemetry }) => {
  if (!telemetry) return null;

  const sections: TelemetrySection[] = [
    {
      title: "Position (m)",
      values: {
        x: telemetry.position.x,
        y: telemetry.position.y,
        z: telemetry.position.z
      }
    },
    {
      title: "Velocity (m/s)",
      values: {
        x: telemetry.velocity.x,
        y: telemetry.velocity.y,
        z: telemetry.velocity.z
      }
    },
    {
      title: "Angular Velocity (rad/s)",
      values: {
        x: telemetry.angularVelocity.x,
        y: telemetry.angularVelocity.y,
        z: telemetry.angularVelocity.z
      }
    },
    {
      title: "Orientation (quaternion)",
      values: {
        x: telemetry.orientation.x,
        y: telemetry.orientation.y,
        z: telemetry.orientation.z,
        w: telemetry.orientation.w
      }
    },
    {
      title: "Mass (kg)",
      values: {
        mass: telemetry.mass
      }
    }
  ];

  return (
    <div className="space-y-1">
      {sections.map(section => (
        <div key={section.title} className="text-xs">
          <h4 className="text-cyan-300/90 font-medium mb-0.5 drop-shadow-md">
            {section.title}
          </h4>
          <div className="flex flex-wrap gap-2">
            {(Object.entries(section.values) as [string, number][]).map(([key, value]) => (
              <div key={key} className="flex items-center gap-1">
                <span className="text-cyan-300/90">{key.toUpperCase()}:</span>
                <span className="text-white font-medium">{value.toFixed(3)}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
      <div className="text-xs">
        <h4 className="text-cyan-300/90 font-medium mb-0.5 drop-shadow-md">
          Thrusters
        </h4>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 w-fit">
          {/* Rotation controls */}
          <div>
            <div className="text-cyan-300/90 text-[10px] mb-0.5">PITCH</div>
            <div className="flex gap-0.5 mb-0.5">
              {[0, 2, 5, 7, 8, 9, 14, 15].map(i => (
                <div 
                  key={i}
                  className={`w-4 text-center px-0.5 py-0.5 rounded ${telemetry.thrusterStatus[i] ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'}`}
                  title={`Pitch Up - T${i + 1}`}
                >
                  {i + 1}
                </div>
              ))}
            </div>
            <div className="flex gap-0.5 mb-1">
              {[1, 3, 4, 6, 10, 11, 12, 13].map(i => (
                <div 
                  key={i}
                  className={`w-4 text-center px-0.5 py-0.5 rounded ${telemetry.thrusterStatus[i] ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'}`}
                  title={`Pitch Down - T${i + 1}`}
                >
                  {i + 1}
                </div>
              ))}
            </div>

            <div className="text-cyan-300/90 text-[10px] mb-0.5">YAW</div>
            <div className="flex gap-0.5 mb-0.5">
              {[0, 1, 6, 7, 16, 17, 22, 23].map(i => (
                <div 
                  key={i}
                  className={`w-4 text-center px-0.5 py-0.5 rounded ${telemetry.thrusterStatus[i] ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'}`}
                  title={`Yaw Left - T${i + 1}`}
                >
                  {i + 1}
                </div>
              ))}
            </div>
            <div className="flex gap-0.5 mb-1">
              {[2, 3, 4, 5, 18, 19, 20, 21].map(i => (
                <div 
                  key={i}
                  className={`w-4 text-center px-0.5 py-0.5 rounded ${telemetry.thrusterStatus[i] ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'}`}
                  title={`Yaw Right - T${i + 1}`}
                >
                  {i + 1}
                </div>
              ))}
            </div>

            <div className="text-cyan-300/90 text-[10px] mb-0.5">ROLL</div>
            <div className="flex gap-0.5 mb-0.5">
              {[8, 11, 13, 14, 16, 18, 21, 23].map(i => (
                <div 
                  key={i}
                  className={`w-4 text-center px-0.5 py-0.5 rounded ${telemetry.thrusterStatus[i] ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'}`}
                  title={`Roll CCW - T${i + 1}`}
                >
                  {i + 1}
                </div>
              ))}
            </div>
            <div className="flex gap-0.5">
              {[9, 10, 12, 15, 17, 19, 20, 22].map(i => (
                <div 
                  key={i}
                  className={`w-4 text-center px-0.5 py-0.5 rounded ${telemetry.thrusterStatus[i] ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'}`}
                  title={`Roll CW - T${i + 1}`}
                >
                  {i + 1}
                </div>
              ))}
            </div>
          </div>

          {/* Translation controls */}
          <div>
            <div className="text-cyan-300/90 text-[10px] mb-0.5">TRANSLATION</div>
            <div className="flex gap-0.5 mb-0.5">
              <div className="flex gap-0.5">
                {[0, 1, 2, 3].map(i => (
                  <div 
                    key={i}
                    className={`w-4 text-center px-0.5 py-0.5 rounded ${telemetry.thrusterStatus[i] ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'}`}
                    title={`Forward - T${i + 1}`}
                  >
                    {i + 1}
                  </div>
                ))}
              </div>
              <div className="text-[10px] text-cyan-300/90">FWD</div>
            </div>
            <div className="flex gap-0.5 mb-1">
              <div className="flex gap-0.5">
                {[4, 5, 6, 7].map(i => (
                  <div 
                    key={i}
                    className={`w-4 text-center px-0.5 py-0.5 rounded ${telemetry.thrusterStatus[i] ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'}`}
                    title={`Back - T${i + 1}`}
                  >
                    {i + 1}
                  </div>
                ))}
              </div>
              <div className="text-[10px] text-cyan-300/90">BCK</div>
            </div>

            <div className="flex gap-0.5 mb-0.5">
              <div className="flex gap-0.5">
                {[12, 13, 14, 15].map(i => (
                  <div 
                    key={i}
                    className={`w-4 text-center px-0.5 py-0.5 rounded ${telemetry.thrusterStatus[i] ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'}`}
                    title={`Up - T${i + 1}`}
                  >
                    {i + 1}
                  </div>
                ))}
              </div>
              <div className="text-[10px] text-cyan-300/90">UP</div>
            </div>
            <div className="flex gap-0.5 mb-1">
              <div className="flex gap-0.5">
                {[8, 9, 10, 11].map(i => (
                  <div 
                    key={i}
                    className={`w-4 text-center px-0.5 py-0.5 rounded ${telemetry.thrusterStatus[i] ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'}`}
                    title={`Down - T${i + 1}`}
                  >
                    {i + 1}
                  </div>
                ))}
              </div>
              <div className="text-[10px] text-cyan-300/90">DN</div>
            </div>

            <div className="flex gap-0.5 mb-0.5">
              <div className="flex gap-0.5">
                {[16, 17, 18, 19].map(i => (
                  <div 
                    key={i}
                    className={`w-4 text-center px-0.5 py-0.5 rounded ${telemetry.thrusterStatus[i] ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'}`}
                    title={`Left - T${i + 1}`}
                  >
                    {i + 1}
                  </div>
                ))}
              </div>
              <div className="text-[10px] text-cyan-300/90">LFT</div>
            </div>
            <div className="flex gap-0.5">
              <div className="flex gap-0.5">
                {[20, 21, 22, 23].map(i => (
                  <div 
                    key={i}
                    className={`w-4 text-center px-0.5 py-0.5 rounded ${telemetry.thrusterStatus[i] ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'}`}
                    title={`Right - T${i + 1}`}
                  >
                    {i + 1}
                  </div>
                ))}
              </div>
              <div className="text-[10px] text-cyan-300/90">RGT</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}; 