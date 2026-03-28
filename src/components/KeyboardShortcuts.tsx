import React from 'react';

interface Shortcut {
  key: string;
  description: string;
}

interface KeyboardShortcutsProps {
  isVisible: boolean;
  onClose: () => void;
}

const SHORTCUTS: Shortcut[] = [
  { key: 'WASD', description: 'Translate spacecraft' },
  { key: 'QE', description: 'Roll spacecraft' },
  { key: 'Arrow Keys', description: 'Rotate spacecraft' },
  { key: 'Shift (Hold)', description: 'Increase thrust' },
  { key: 'Space', description: 'Toggle RCS' },
  { key: 'P', description: 'Toggle position hold' },
  { key: 'O', description: 'Toggle orientation hold' },
  { key: 'V', description: 'Toggle velocity arrow' },
  { key: 'B', description: 'Toggle angular velocity arrow' },
  { key: 'C', description: 'Toggle camera (Follow/Free)' }
];

export const KeyboardShortcuts: React.FC<KeyboardShortcutsProps> = ({ isVisible, onClose }) => {
  if (!isVisible) return null;

  return (
    <div 
      className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 backdrop-blur-sm pointer-events-auto"
      onClick={onClose}
    >
      <div 
        className="bg-black/60 backdrop-blur-sm rounded max-w-md w-full mx-4 border border-white/20"
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center px-2 py-1 border-b border-white/20">
          <h3 className="text-white/90 text-[10px] font-medium">
            Keyboard Shortcuts
          </h3>
          <button
            className="text-white/90 hover:text-white text-lg cursor-pointer"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="p-2 space-y-1 text-white/90 text-[10px]">
          {SHORTCUTS.map(({ key, description }) => (
            <div key={key}>
              <span className="text-cyan-300/90">{key}</span> - {description}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}; 
