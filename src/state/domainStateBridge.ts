import { simulationEvents } from '../domain/simulationEvents';
import { setAutopilotState, setDockingPlan, traceStore, toggleCameraMode } from './appState';

// Bridge domain/runtime events into app state mutations.
// Keeping this in one place avoids direct state writes across simulation modules.
export function installDomainStateBridge(): () => void {
  const unsubscribers: Array<() => void> = [];

  unsubscribers.push(
    simulationEvents.on('autopilotStateChanged', ({ enabled, activeAutopilots }) => {
      setAutopilotState(enabled, activeAutopilots);
    })
  );

  unsubscribers.push(
    simulationEvents.on('dockingPlanChanged', ({ plan }) => {
      setDockingPlan(plan);
    })
  );

  unsubscribers.push(
    simulationEvents.on('cameraModeToggleRequested', () => {
      toggleCameraMode();
    })
  );

  unsubscribers.push(
    simulationEvents.on('traceSampleAppended', ({ spacecraftId, sample }) => {
      traceStore.appendTraceSample(spacecraftId, sample);
    })
  );

  unsubscribers.push(
    simulationEvents.on('traceSamplesCleared', ({ spacecraftId }) => {
      traceStore.clearTraceSamples(spacecraftId);
    })
  );

  return () => {
    unsubscribers.forEach((u) => {
      try { u(); } catch {}
    });
  };
}

let installedCleanup: (() => void) | null = null;

export function ensureDomainStateBridgeInstalled(): () => void {
  if (!installedCleanup) installedCleanup = installDomainStateBridge();
  return installedCleanup;
}

export function resetDomainStateBridgeForTests(): void {
  if (installedCleanup) {
    try { installedCleanup(); } catch {}
    installedCleanup = null;
  }
}
