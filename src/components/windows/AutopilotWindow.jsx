import React, { useState, useEffect } from 'react';
import { NumberInput } from '../ui/NumberInput';

export function AutopilotWindow({ controller, world }) {
  // Store target settings per spacecraft using their names as keys
  const [targetSettings, setTargetSettings] = useState({});
  
  // Local state for current spacecraft's settings
  const [targetType, setTargetType] = useState('custom');
  const [targetPoint, setTargetPoint] = useState('center');
  const [selectedSpacecraft, setSelectedSpacecraft] = useState(null);

  // Load settings when active spacecraft changes
  useEffect(() => {
    if (controller?.spacecraft?.name) {
      const savedSettings = targetSettings[controller.spacecraft.name] || {
        targetType: 'custom',
        targetPoint: 'center',
        selectedSpacecraft: null,
        customPosition: controller?.autopilot?.targetPosition?.clone() || { x: 0, y: 0, z: 0 }
      };
      
      setTargetType(savedSettings.targetType);
      setTargetPoint(savedSettings.targetPoint);
      setSelectedSpacecraft(savedSettings.selectedSpacecraft);

      // Restore autopilot target
      if (savedSettings.targetType === 'spacecraft' && savedSettings.selectedSpacecraft) {
        const target = world.spacecraft.find(s => s.name === savedSettings.selectedSpacecraft.name);
        if (target) {
          controller?.autopilot?.setTargetObject(target, savedSettings.targetPoint);
        }
      } else if (savedSettings.customPosition) {
        controller?.autopilot?.targetPosition?.copy(savedSettings.customPosition);
      }
    }
  }, [controller?.spacecraft?.name]);

  // Save settings whenever they change
  const saveSettings = (updates = {}) => {
    if (!controller?.spacecraft?.name) return;

    const currentSettings = targetSettings[controller.spacecraft.name] || {};
    const newSettings = {
      ...currentSettings,
      targetType,
      targetPoint,
      selectedSpacecraft,
      customPosition: controller?.autopilot?.targetPosition?.clone(),
      ...updates
    };

    setTargetSettings(prev => ({
      ...prev,
      [controller.spacecraft.name]: newSettings
    }));
  };

  const handleSpacecraftSelect = (e) => {
    const selectedId = e.target.value;
    const spacecraft = world.spacecraft.find(s => s !== controller.spacecraft && s.name === selectedId);
    setSelectedSpacecraft(spacecraft);
    
    if (spacecraft) {
      controller?.autopilot?.setTargetObject(spacecraft, targetPoint);
      saveSettings({ selectedSpacecraft: spacecraft });
    } else {
      controller?.autopilot?.clearTargetObject();
      saveSettings({ selectedSpacecraft: null });
    }
  };

  const handleTargetPointChange = (e) => {
    const point = e.target.value;
    setTargetPoint(point);
    
    if (selectedSpacecraft) {
      controller?.autopilot?.setTargetObject(selectedSpacecraft, point);
      saveSettings({ targetPoint: point });
    }
  };

  const handleTargetTypeChange = (e) => {
    const type = e.target.value;
    setTargetType(type);
    
    if (type === 'custom') {
      controller?.autopilot?.clearTargetObject();
      saveSettings({ targetType: type });
    } else if (type === 'spacecraft' && selectedSpacecraft) {
      controller?.autopilot?.setTargetObject(selectedSpacecraft, targetPoint);
      saveSettings({ targetType: type });
    }
  };

  const handleCustomPositionChange = (axis, value) => {
    const newPosition = { ...controller?.autopilot?.targetPosition };
    newPosition[axis] = parseFloat(value);
    controller?.autopilot?.targetPosition?.copy?.(newPosition);
    saveSettings({ customPosition: newPosition });
  };

  const autopilotButtons = [
    { key: 'cancelAndAlign', label: 'Cancel and Align (T)', description: 'Cancels rotation and aligns with current orientation' },
    { key: 'pointToPosition', label: 'Point to Position (Y)', description: 'Points spacecraft to target position' },
    { key: 'cancelRotation', label: 'Cancel Rotation (R)', description: 'Cancels all rotational movement' },
    { key: 'cancelLinearMotion', label: 'Cancel Linear Motion (G)', description: 'Cancels all linear movement' },
    { key: 'goToPosition', label: 'Go to Position (B)', description: 'Moves spacecraft to target position' }
  ];

  return (
    <div className="flex flex-col gap-2">
      {/* Autopilot Buttons */}
      <div className="flex flex-col gap-1">
        {autopilotButtons.map(({ key, label, description }) => (
          <button
            key={key}
            className={`px-2 py-1 bg-black/60 hover:bg-white/20 text-white/90 rounded transition-colors duration-200 text-xs border border-white/20 font-mono drop-shadow-md w-full ${
              controller?.autopilot?.activeAutopilots?.[key] ? 'bg-cyan-300/20 border-cyan-300/40 text-white' : ''
            }`}
            onClick={() => controller?.autopilot?.[key]?.()}
            title={description}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Target Selection */}
      <div className="flex flex-col gap-2 mt-2">
        <h4 className="text-cyan-300/90 font-medium drop-shadow-md">Target Type</h4>
        <select
          className="w-full px-2 py-1 bg-black/60 text-white/90 rounded border border-white/20 text-xs font-mono"
          value={targetType}
          onChange={handleTargetTypeChange}
        >
          <option value="custom">Custom Position</option>
          <option value="spacecraft">Spacecraft</option>
        </select>

        {targetType === 'spacecraft' ? (
          <div className="flex flex-col gap-2">
            <select
              className="w-full px-2 py-1 bg-black/60 text-white/90 rounded border border-white/20 text-xs font-mono"
              value={selectedSpacecraft?.name || ''}
              onChange={handleSpacecraftSelect}
            >
              <option value="">Select Spacecraft</option>
              {world.spacecraft
                .filter(s => s !== controller.spacecraft)
                .map(s => (
                  <option key={s.name} value={s.name}>{s.name}</option>
                ))
              }
            </select>

            <select
              className="w-full px-2 py-1 bg-black/60 text-white/90 rounded border border-white/20 text-xs font-mono"
              value={targetPoint}
              onChange={handleTargetPointChange}
            >
              <option value="center">Center of Mass</option>
              <option value="dockingPort">Docking Port</option>
            </select>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-1">
            {['x', 'y', 'z'].map(axis => (
              <NumberInput
                key={axis}
                value={controller?.autopilot?.targetPosition?.[axis] ?? 0}
                onChange={(e) => handleCustomPositionChange(axis, e.target.value)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
} 