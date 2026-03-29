import React, { useState, useEffect, useRef } from 'react';

interface RangeInputProps {
  label: string;
  value: number | null;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  min: number;
  max: number;
  unit?: string;
  defaultValue?: number | null;
  step?: number | null;
  className?: string;
  showValueDisplay?: boolean;
  /** Allow the text input to accept values outside the slider min/max range. */
  allowOverflow?: boolean;
}

export const RangeInput: React.FC<RangeInputProps> = ({
  label,
  value,
  onChange,
  min,
  max,
  unit = "",
  defaultValue = null,
  step = null,
  className = "",
  showValueDisplay = true,
  allowOverflow = false
}) => {
  const displayValue: number = value ?? defaultValue ?? min;
  const [textValue, setTextValue] = useState(displayValue.toFixed(1));
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync text value when external value changes (and not editing)
  useEffect(() => {
    if (!editing) {
      setTextValue(displayValue.toFixed(1));
    }
  }, [displayValue, editing]);

  // Create a synthetic-like change event for the number input
  const emitChange = (numValue: number) => {
    const syntheticEvent = {
      target: { value: String(numValue) },
    } as React.ChangeEvent<HTMLInputElement>;
    onChange(syntheticEvent);
  };

  const commitTextValue = () => {
    setEditing(false);
    const parsed = parseFloat(textValue);
    if (isNaN(parsed)) {
      setTextValue(displayValue.toFixed(1));
      return;
    }
    // Clamp to slider range unless overflow is allowed
    const clamped = allowOverflow ? parsed : Math.min(Math.max(parsed, min), max);
    setTextValue(clamped.toFixed(1));
    emitChange(clamped);
  };

  // Compute the slider range: if allowOverflow and value is outside, extend the range
  const sliderMin = allowOverflow ? Math.min(min, displayValue) : min;
  const sliderMax = allowOverflow ? Math.max(max, displayValue) : max;

  return (
    <div className={className}>
      <label className="text-[10px] text-white/70 block mb-0.5">
        {label} {unit}
      </label>
      <input
        type="range"
        min={sliderMin}
        max={sliderMax}
        step={step ?? undefined}
        value={displayValue}
        onChange={onChange}
        className="w-full h-1 bg-white/20 rounded-full appearance-none cursor-pointer"
      />
      {showValueDisplay && (
        <div className="flex justify-between items-center text-[10px] text-white/90">
          <span className="text-white/70">Current:</span>
          <input
            ref={inputRef}
            type="text"
            inputMode="decimal"
            className="w-16 text-right bg-transparent text-white/90 font-mono text-[10px] border-b border-transparent hover:border-white/20 focus:border-cyan-500/50 focus:outline-none px-0.5"
            value={editing ? textValue : displayValue.toFixed(1)}
            onFocus={() => {
              setEditing(true);
              setTextValue(displayValue.toFixed(1));
              // Select all text on focus
              setTimeout(() => inputRef.current?.select(), 0);
            }}
            onChange={(e) => setTextValue(e.target.value)}
            onBlur={commitTextValue}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                commitTextValue();
                inputRef.current?.blur();
              } else if (e.key === 'Escape') {
                setEditing(false);
                setTextValue(displayValue.toFixed(1));
                inputRef.current?.blur();
              }
            }}
          />
        </div>
      )}
    </div>
  );
};
