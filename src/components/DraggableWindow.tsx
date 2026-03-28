import React, { useState, useRef, useEffect } from 'react';
import Draggable, { DraggableData, DraggableEvent } from 'react-draggable';
import { ChevronUp, ChevronDown, X } from 'lucide-react';

export interface WindowPosition {
  x: number;
  y: number;
}

type ResizeDir =
  | 'left' | 'right' | 'top' | 'bottom'
  | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

interface ResizeHandle {
  dir: ResizeDir;
  className: string;
  cursor: string;
}

const EDGE_HANDLES: ResizeHandle[] = [
  { dir: 'right',  className: 'top-0 right-0 h-full',  cursor: 'ew-resize' },
  { dir: 'left',   className: 'top-0 left-0 h-full',   cursor: 'ew-resize' },
  { dir: 'bottom', className: 'left-0 bottom-0 w-full', cursor: 'ns-resize' },
  { dir: 'top',    className: 'left-0 top-0 w-full',    cursor: 'ns-resize' },
];

const CORNER_HANDLES: ResizeHandle[] = [
  { dir: 'bottom-right', className: 'right-0 bottom-0', cursor: 'nwse-resize' },
  { dir: 'bottom-left',  className: 'left-0 bottom-0',  cursor: 'nesw-resize' },
  { dir: 'top-left',     className: 'left-0 top-0',     cursor: 'nwse-resize' },
  { dir: 'top-right',    className: 'right-0 top-0',    cursor: 'nesw-resize' },
];

interface DraggableWindowProps {
  title: string;
  children: React.ReactNode;
  onClose?: () => void;
  defaultPosition?: WindowPosition;
  isVisible?: boolean;
  onPositionChange?: (position: WindowPosition) => void;
  initiallyCollapsed?: boolean;
  resizable?: boolean;
  minWidth?: number;
  minHeight?: number;
  defaultWidth?: number;
  defaultHeight?: number;
  onSizeChange?: (size: { width?: number; height?: number }) => void;
  zIndex?: number;
  onFocus?: () => void;
}

export const DraggableWindow: React.FC<DraggableWindowProps> = ({
  title,
  children,
  onClose,
  defaultPosition,
  isVisible = true,
  onPositionChange,
  initiallyCollapsed = false,
  resizable = true,
  minWidth = 200,
  minHeight = 120,
  defaultWidth = 250,
  defaultHeight,
  onSizeChange,
  zIndex,
  onFocus
}) => {
  const [isCollapsed, setIsCollapsed] = useState(initiallyCollapsed);
  const nodeRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);

  const [width, setWidth] = useState<number>(defaultWidth);
  const [height, setHeight] = useState<number | undefined>(defaultHeight);
  const [headerHeight, setHeaderHeight] = useState(0);
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    if (headerRef.current) {
      setHeaderHeight(headerRef.current.getBoundingClientRect().height);
    }
  }, [isCollapsed]);

  const startResize = (dir: ResizeDir, e: React.MouseEvent) => {
    if (!resizable || isCollapsed) return;
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startY = e.clientY;
    const rect = nodeRef.current?.getBoundingClientRect();
    const startW = rect?.width ?? width;
    const startH = rect?.height ?? (height ?? 0);
    const startPosX = defaultPosition?.x ?? 0;
    const startPosY = defaultPosition?.y ?? 0;

    setIsResizing(true);

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;

      let nextW: number | undefined = width;
      let nextH: number | undefined = height;
      let nextX = startPosX;
      let nextY = startPosY;

      if (dir.includes('right')) {
        nextW = Math.max(minWidth, startW + dx);
        setWidth(nextW);
      }
      if (dir.includes('left')) {
        nextW = Math.max(minWidth, startW - dx);
        setWidth(nextW);
        nextX = startPosX + (startW - nextW);
      }
      if (dir === 'bottom' || dir === 'bottom-right' || dir === 'bottom-left') {
        nextH = Math.max(minHeight, startH + dy);
        setHeight(nextH);
      }
      if (dir === 'top' || dir === 'top-left' || dir === 'top-right') {
        nextH = Math.max(minHeight, startH - dy);
        setHeight(nextH);
        nextY = startPosY + (startH - nextH);
      }

      onSizeChange?.({ width: nextW, height: nextH });

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

  const containerStyle: React.CSSProperties = {
    width,
    height: isCollapsed ? undefined : height,
    minWidth,
    zIndex,
  };

  const contentStyle: React.CSSProperties | undefined =
    !isCollapsed && height
      ? { height: Math.max(0, height - headerHeight), overflow: 'auto' }
      : undefined;

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
        className={`absolute bg-black/60 backdrop-blur-sm border border-white/20 rounded pointer-events-auto ${isResizing ? 'select-none' : ''}`}
        onMouseDownCapture={() => onFocus?.()}
        style={containerStyle}
      >
        <div ref={headerRef} className="window-handle flex justify-between items-center px-1.5 py-0.5 border-b border-white/10 cursor-move">
          <h3 className="text-white/90 text-[10px] font-medium">{title}</h3>
          <div className="flex gap-1">
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="p-0.5 text-white/50 hover:text-white/90 transition-colors rounded"
            >
              {isCollapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
            </button>
            {onClose && (
              <button
                onClick={onClose}
                className="p-0.5 text-white/50 hover:text-white/90 transition-colors rounded"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        <div
          className={`min-h-0 pointer-events-auto ${isCollapsed ? 'h-0 p-0 overflow-hidden m-0' : 'p-1'}`}
          style={contentStyle}
        >
          {children}
        </div>

        {resizable && !isCollapsed && (
          <>
            {EDGE_HANDLES.map(({ dir, className, cursor }) => (
              <div
                key={dir}
                onMouseDown={(e) => startResize(dir, e)}
                className={`absolute z-10 ${className}`}
                style={{ [dir === 'left' || dir === 'right' ? 'width' : 'height']: 6, cursor }}
              />
            ))}
            {CORNER_HANDLES.map(({ dir, className, cursor }) => (
              <div
                key={dir}
                onMouseDown={(e) => startResize(dir, e)}
                className={`absolute z-10 ${className}`}
                style={{ width: 12, height: 12, cursor }}
              />
            ))}
          </>
        )}
      </div>
    </Draggable>
  );
};
