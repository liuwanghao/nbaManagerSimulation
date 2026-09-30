import { executeSimulationTask, type SimulationRequest } from "./simulationTask";

self.onmessage = (event: MessageEvent<{ id: number; request: SimulationRequest }>) => {
  const { id, request } = event.data;
  try {
    const result = executeSimulationTask(request, (completed, total) => {
      self.postMessage({ id, kind: "PROGRESS", completed, total });
    });
    self.postMessage({ id, kind: "RESULT", result });
  } catch (error) {
    self.postMessage({ id, kind: "ERROR", message: error instanceof Error ? error.message : String(error) });
  }
};
