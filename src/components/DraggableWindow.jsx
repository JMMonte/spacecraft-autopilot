import React, { useState, useRef, useEffect } from 'react';
import Draggable from 'react-draggable';
import { ChevronUp, ChevronDown, X } from 'lucide-react';

export function DraggableWindow({ 
  title, 
  children, 
  onClose, 
  defaultPosition, 
  isVisible, 
  onPositionChange, 
  style,
  initiallyCollapsed = true 
}) {
  const [isCollapsed, setIsCollapsed] = useState(initiallyCollapsed);
  const nodeRef = useRef(null);

  if (!isVisible) return null;

  return (
    <Draggable 
      handle=".window-handle"
      position={defaultPosition}
      onStop={(e, data) => onPositionChange?.({ x: data.x, y: data.y })}
      nodeRef={nodeRef}
    >
      <div 
        ref={nodeRef} 
        className="absolute bg-black/60 backdrop-blur-sm border border-white/20 rounded shadow-lg pointer-events-auto" 
        style={{ ...style }}
      >
        <div className="window-handle flex justify-between items-center px-2 py-1 bg-black/60 border-b border-white/20 cursor-move">
          <h3 className="text-white/90 text-xs font-medium uppercase tracking-wide drop-shadow-md">
            {title}
          </h3>
          <div className="flex gap-1">
            <button 
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="p-0.5 text-white/90 hover:text-white transition-colors duration-200 rounded"
            >
              {isCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
            </button>
            {onClose && (
              <button 
                onClick={onClose}
                className="p-0.5 text-white/90 hover:text-white transition-colors duration-200 rounded"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>
        <div className={`transition-all duration-200 min-h-0 pointer-events-auto ${isCollapsed ? 'h-0 p-0 overflow-hidden m-0' : 'p-2'}`}>
          {children}
        </div>
      </div>
    </Draggable>
  );
} 