import React, { useState, useRef, useEffect } from 'react';
import Draggable, { DraggableData, DraggableEvent } from 'react-draggable';
import { ChevronUp, ChevronDown, X } from 'lucide-react';

export interface WindowPosition {
  x: number;
  y: number;
}

interface DraggableWindowProps {
  title: string;
  children: React.ReactNode;
  onClose?: () => void;
  defaultPosition?: WindowPosition;
  isVisible?: boolean;
  onPositionChange?: (position: WindowPosition) => void;
  style?: React.CSSProperties;
  initiallyCollapsed?: boolean;
  // Resizing options
  resizable?: boolean;
  minWidth?: number;
  minHeight?: number;
  defaultSize?: { width?: number; height?: number };
  onSizeChange?: (size: { width?: number; height?: number }) => void;
}

export const DraggableWindow: React.FC<DraggableWindowProps> = ({ 
  title, 
  children, 
  onClose, 
  defaultPosition, 
  isVisible = true, 
  onPositionChange, 
  style,
  initiallyCollapsed = true,
  resizable = true,
  minWidth = 200,
  minHeight = 120,
  defaultSize,
  onSizeChange
}) => {
  const [isCollapsed, setIsCollapsed] = useState(initiallyCollapsed);
  const nodeRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);

  // Size state (width always applied when set; height only when expanded)
  const initialWidth = (() => {
    if (typeof defaultSize?.width === 'number') return defaultSize.width;
    const w = style?.width;
    if (typeof w === 'number') return w;
    if (typeof w === 'string') {
      const n = parseFloat(w);
      if (!Number.isNaN(n)) return n;
    }
    // Default width aligns with cockpit layout expectations
    return 250;
  })();
  const initialHeight = (() => {
    if (typeof defaultSize?.height === 'number') return defaultSize.height;
    const h = style?.height;
    if (typeof h === 'number') return h;
    if (typeof h === 'string') {
      const n = parseFloat(h);
      if (!Number.isNaN(n)) return n;
    }
    return undefined;
  })();

  const [width, setWidth] = useState<number | undefined>(initialWidth);
  const [height, setHeight] = useState<number | undefined>(initialHeight);
  const [headerHeight, setHeaderHeight] = useState<number>(0);
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    if (headerRef.current) {
      setHeaderHeight(headerRef.current.getBoundingClientRect().height);
    }
  }, [isCollapsed]);

  // Helper to merge external style with internal sizing
  const mergedStyle: React.CSSProperties = {
    ...style,
    width,
    // Only apply height when expanded; collapsed uses natural header height
    height: isCollapsed ? undefined : height,
    minWidth,
  };

  type ResizeDir =
    | 'left'
    | 'right'
    | 'top'
    | 'bottom'
    | 'top-left'
    | 'top-right'
    | 'bottom-left'
    | 'bottom-right';

  const [hoveredEdge, setHoveredEdge] = useState<ResizeDir | null>(null);

  const startResize = (dir: ResizeDir, e: React.MouseEvent) => {
    if (!resizable || isCollapsed) return;
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startY = e.clientY;
    const rect = nodeRef.current?.getBoundingClientRect();
    const startW = rect?.width ?? (width ?? 0);
    const startH = rect?.height ?? (height ?? 0);
    const startPosX = (defaultPosition?.x ?? 0);
    const startPosY = (defaultPosition?.y ?? 0);

    setIsResizing(true);

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;

      let nextW = width;
      let nextH = height;
      let nextX = startPosX;
      let nextY = startPosY;

      if (dir === 'right' || dir === 'bottom-right' || dir === 'top-right') {
        nextW = Math.max(minWidth, startW + dx);
        setWidth(nextW);
      }
      if (dir === 'left' || dir === 'top-left' || dir === 'bottom-left') {
        // Left edge: width decreases when dragging right (dx>0)
        const targetW = startW - dx;
        nextW = Math.max(minWidth, targetW);
        setWidth(nextW);
        // Move X by the actual applied delta on the left edge
        const appliedDx = startW - (nextW ?? startW);
        nextX = startPosX + appliedDx;
      }
      if (dir === 'bottom' || dir === 'bottom-right' || dir === 'bottom-left') {
        nextH = Math.max(minHeight, startH + dy);
        setHeight(nextH);
      }
      if (dir === 'top' || dir === 'top-left' || dir === 'top-right') {
        // Top edge: height decreases when dragging down (dy>0)
        const targetH = startH - dy;
        nextH = Math.max(minHeight, targetH);
        setHeight(nextH);
        const appliedDy = startH - (nextH ?? startH);
        nextY = startPosY + appliedDy;
      }

      onSizeChange?.({ width: nextW, height: nextH });

      // Update position live when resizing from left/top edges
      if (onPositionChange && (dir.includes('left') || dir.includes('top'))) {
        onPositionChange({ x: nextX, y: nextY });
      }
    };

    const onUp = () => {
      setIsResizing(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  if (!isVisible) return null;

  return (
    <Draggable 
      handle=".window-handle"
      position={defaultPosition}
      onStop={(_e: DraggableEvent, data: DraggableData) => 
        onPositionChange?.({ x: data.x, y: data.y })
      }
      nodeRef={nodeRef}
    >
      <div 
        ref={nodeRef} 
        className={`absolute bg-black/60 backdrop-blur-sm border border-white/20 rounded shadow-lg pointer-events-auto ${isResizing ? 'select-none' : ''}`}
        style={mergedStyle}
      >
        <div ref={headerRef} className="window-handle flex justify-between items-center px-2 py-1 bg-black/60 border-b border-white/20 cursor-move">
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
        <div
          className={`transition-all duration-200 min-h-0 pointer-events-auto ${isCollapsed ? 'h-0 p-0 overflow-hidden m-0' : 'p-2'}`}
          style={!isCollapsed && height ? { height: Math.max(0, (height ?? 0) - headerHeight), overflow: 'auto' } : undefined}
        >
          {children}
        </div>

        {resizable && !isCollapsed && (
          <>
            {/* Right edge */}
            <div
              onMouseDown={(e) => startResize('right', e)}
              onMouseEnter={() => setHoveredEdge('right')}
              onMouseLeave={() => setHoveredEdge(null)}
              className="absolute top-0 right-0 h-full z-10"
              style={{ width: 6, cursor: 'ew-resize', background: hoveredEdge === 'right' ? 'rgba(34,211,238,0.25)' : 'transparent' }}
            />
            {/* Left edge */}
            <div
              onMouseDown={(e) => startResize('left', e)}
              onMouseEnter={() => setHoveredEdge('left')}
              onMouseLeave={() => setHoveredEdge(null)}
              className="absolute top-0 left-0 h-full z-10"
              style={{ width: 6, cursor: 'ew-resize', background: hoveredEdge === 'left' ? 'rgba(34,211,238,0.25)' : 'transparent' }}
            />
            {/* Bottom edge */}
            <div
              onMouseDown={(e) => startResize('bottom', e)}
              onMouseEnter={() => setHoveredEdge('bottom')}
              onMouseLeave={() => setHoveredEdge(null)}
              className="absolute left-0 bottom-0 w-full z-10"
              style={{ height: 6, cursor: 'ns-resize', background: hoveredEdge === 'bottom' ? 'rgba(34,211,238,0.25)' : 'transparent' }}
            />
            {/* Top edge */}
            <div
              onMouseDown={(e) => startResize('top', e)}
              onMouseEnter={() => setHoveredEdge('top')}
              onMouseLeave={() => setHoveredEdge(null)}
              className="absolute left-0 top-0 w-full z-10"
              style={{ height: 6, cursor: 'ns-resize', background: hoveredEdge === 'top' ? 'rgba(34,211,238,0.25)' : 'transparent' }}
            />
            {/* Bottom-right corner */}
            <div
              onMouseDown={(e) => startResize('bottom-right', e)}
              onMouseEnter={() => setHoveredEdge('bottom-right')}
              onMouseLeave={() => setHoveredEdge(null)}
              className="absolute z-10"
              style={{ width: 12, height: 12, right: 0, bottom: 0, cursor: 'nwse-resize', background: hoveredEdge === 'bottom-right' ? 'rgba(34,211,238,0.35)' : 'transparent' }}
            />
            {/* Bottom-left corner */}
            <div
              onMouseDown={(e) => startResize('bottom-left', e)}
              onMouseEnter={() => setHoveredEdge('bottom-left')}
              onMouseLeave={() => setHoveredEdge(null)}
              className="absolute z-10"
              style={{ width: 12, height: 12, left: 0, bottom: 0, cursor: 'nesw-resize', background: hoveredEdge === 'bottom-left' ? 'rgba(34,211,238,0.35)' : 'transparent' }}
            />
            {/* Top-left corner */}
            <div
              onMouseDown={(e) => startResize('top-left', e)}
              onMouseEnter={() => setHoveredEdge('top-left')}
              onMouseLeave={() => setHoveredEdge(null)}
              className="absolute z-10"
              style={{ width: 12, height: 12, left: 0, top: 0, cursor: 'nwse-resize', background: hoveredEdge === 'top-left' ? 'rgba(34,211,238,0.35)' : 'transparent' }}
            />
            {/* Top-right corner */}
            <div
              onMouseDown={(e) => startResize('top-right', e)}
              onMouseEnter={() => setHoveredEdge('top-right')}
              onMouseLeave={() => setHoveredEdge(null)}
              className="absolute z-10"
              style={{ width: 12, height: 12, right: 0, top: 0, cursor: 'nesw-resize', background: hoveredEdge === 'top-right' ? 'rgba(34,211,238,0.35)' : 'transparent' }}
            />
          </>
        )}
      </div>
    </Draggable>
  );
};
