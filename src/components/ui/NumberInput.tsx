import React from 'react';
import { INPUT_BASE, FIELD_LABEL } from './styles';

interface NumberInputProps {
  label?: string;
  value: number;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  step?: number;
  className?: string;
}

export const NumberInput: React.FC<NumberInputProps> = ({
  label,
  value,
  onChange,
  step,
  className = ""
}) => {
  return (
    <div className={className}>
      {label && (
        <label className={FIELD_LABEL}>
          {label}
        </label>
      )}
      <input
        type="number"
        value={value}
        onChange={onChange}
        step={step}
        className={INPUT_BASE}
      />
    </div>
  );
}; 