import type { GameState } from "../game/state/types";
import { executeSimulationTask, type SimulationRequest, type SimulationResult } from "./simulationTask";

export type SimulationWorkerRequest = { id: number; kind: "FULL"; request: SimulationRequest }
  | { id: number; kind: "REUSE"; baseId: number; action: SimulationRequest["action"]; pregameSelection: SimulationRequest["pregameSelection"] };

export type SimulationWorkerMessage = { id: number; kind: "PROGRESS"; completed: number; total: number }
  | { id: number; kind: "RESULT"; result: SimulationResult }
  | { id: number; kind: "RESYNC" }
  | { id: number; kind: "ERROR"; message: string };

/** Retains only the latest private result; callers identify its exact version before reuse. */
export function createSimulationWorkerHandler(send: (message: SimulationWorkerMessage) => void): (message: SimulationWorkerRequest) => void {
  let state: GameState | null = null;
  let stateId: number | null = null;
  return (message) => {
    if (message.kind === "REUSE" && (!state || stateId !== message.baseId)) {
      send({ id: message.id, kind: "RESYNC" });
      return;
    }
    const request = message.kind === "FULL" ? message.request
      : { state: state!, action: message.action, pregameSelection: message.pregameSelection };
    if (message.kind === "FULL") {
      // The authoritative input supersedes the cache; release it before allocating simulation work.
      state = null;
      stateId = null;
    }
    try {
      const result = executeSimulationTask(request, (completed, total) => {
        send({ id: message.id, kind: "PROGRESS", completed, total });
      }, { ownsState: true });
      state = result.state;
      stateId = message.id;
      send({ id: message.id, kind: "RESULT", result });
    } catch (error) {
      // A failed task may already have changed its private input; it cannot be reused.
      state = null;
      stateId = null;
      send({ id: message.id, kind: "ERROR", message: error instanceof Error ? error.message : String(error) });
    }
  };
}
