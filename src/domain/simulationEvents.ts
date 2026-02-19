export type AutopilotModeName =
  | 'orientationMatch'
  | 'cancelRotation'
  | 'cancelLinearMotion'
  | 'pointToPosition'
  | 'goToPosition';

export type AutopilotModes = Record<AutopilotModeName, boolean>;

export type DockingPlan = {
  sourceUuid: string;
  targetUuid: string;
  sourceQuat: { x: number; y: number; z: number; w: number };
  targetQuat: { x: number; y: number; z: number; w: number };
};

export type TraceSample = {
  t: number;
  x: number; y: number; z: number;
  speed: number;
  accel: number;
  forceAbs: number;
  forceNet: number;
};

type SimulationEventMap = {
  autopilotStateChanged: {
    enabled: boolean;
    activeAutopilots: AutopilotModes;
  };
  dockingPlanChanged: {
    plan: DockingPlan | null;
  };
  cameraModeToggleRequested: {
    source: 'keyboard' | 'ui';
  };
  traceSampleAppended: {
    spacecraftId: string;
    sample: TraceSample;
  };
  traceSamplesCleared: {
    spacecraftId: string;
  };
};

type EventName = keyof SimulationEventMap;
type EventListener<K extends EventName> = (payload: SimulationEventMap[K]) => void;

class SimulationEventBus {
  private listeners: {
    [K in EventName]?: Set<EventListener<K>>;
  } = {};

  on<K extends EventName>(event: K, listener: EventListener<K>): () => void {
    const set = (this.listeners[event] || new Set()) as Set<EventListener<K>>;
    set.add(listener);
    this.listeners[event] = set as any;
    return () => set.delete(listener);
  }

  emit<K extends EventName>(event: K, payload: SimulationEventMap[K]): void {
    const set = this.listeners[event] as Set<EventListener<K>> | undefined;
    if (!set || set.size === 0) return;
    for (const listener of set) listener(payload);
  }

  clearAll(): void {
    (Object.keys(this.listeners) as EventName[]).forEach((event) => {
      this.listeners[event]?.clear();
    });
  }
}

export const simulationEvents = new SimulationEventBus();

export function emitAutopilotStateChanged(payload: SimulationEventMap['autopilotStateChanged']): void {
  simulationEvents.emit('autopilotStateChanged', payload);
}

export function emitDockingPlanChanged(payload: SimulationEventMap['dockingPlanChanged']): void {
  simulationEvents.emit('dockingPlanChanged', payload);
}

export function emitCameraModeToggleRequested(source: 'keyboard' | 'ui' = 'ui'): void {
  simulationEvents.emit('cameraModeToggleRequested', { source });
}

export function emitTraceSampleAppended(payload: SimulationEventMap['traceSampleAppended']): void {
  simulationEvents.emit('traceSampleAppended', payload);
}

export function emitTraceSamplesCleared(spacecraftId: string): void {
  simulationEvents.emit('traceSamplesCleared', { spacecraftId });
}

export function resetSimulationEventsForTests(): void {
  simulationEvents.clearAll();
}
