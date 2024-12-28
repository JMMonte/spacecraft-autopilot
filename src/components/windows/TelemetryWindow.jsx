import React from 'react';
import { ValueDisplay } from '../ui/ValueDisplay';

export function TelemetryWindow({ telemetryValues }) {
  const sections = [
    {
      title: "Velocity (m/s)",
      values: telemetryValues.velocity
    },
    {
      title: "Angular Velocity (rad/s)",
      values: telemetryValues.angularVelocity
    },
    {
      title: "Orientation (quaternion)",
      values: telemetryValues.orientation
    }
  ];

  return (
    <div className="space-y-2">
      {sections.map(section => (
        <div key={section.title}>
          <h4 className="text-cyan-300/90 font-medium mb-1 drop-shadow-md">
            {section.title}
          </h4>
          {Object.entries(section.values).map(([key, value]) => (
            <ValueDisplay key={key} label={key.toUpperCase()} value={value} />
          ))}
        </div>
      ))}
    </div>
  );
} 