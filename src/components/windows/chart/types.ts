/** Which Y-axis a series binds to. */
export type AxisSide = 'left' | 'right';

/** Describes one data source the chart will record. */
export interface ChartSource {
  /** Unique key, e.g. "vel.x" */
  id: string;
  /** Display label shown in legend */
  label: string;
  /** CSS color string, e.g. "#7dd3fc" */
  color: string;
  /** Which vertical axis */
  axis: AxisSide;
  /** Called each sample tick to read the current value. Return null for a gap. */
  sample: () => number | null;
}

export interface ChartWindowProps {
  sources: ChartSource[];
  /** Visible time window in seconds (default 30) */
  timeWindow?: number;
  /** Sample interval in ms (default 100) */
  sampleInterval?: number;
  /** Ring buffer capacity per source (default 600) */
  capacity?: number;
}
