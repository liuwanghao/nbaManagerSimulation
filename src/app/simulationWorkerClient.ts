import SimulationWorker from "./simulation.worker?worker&inline";
import { executeSimulationTask, type SimulationRequest, type SimulationResult } from "./simulationTask";
import type { GameState } from "../game/state/types";
import type { SimulationWorkerMessage, SimulationWorkerRequest } from "./simulationWorkerProtocol";

type PendingTask = {
  request: SimulationRequest;
  resolve: (result: SimulationResult) => void;
  reject: (error: Error) => void;
  onProgress?: (completed: number, total: number) => void;
  reuseSent: boolean;
};

let worker: Worker | null = null;
let workerStateId: number | null = null;
const returnedStates = new WeakMap<GameState, { worker: Worker; id: number }>();
let nextId = 0;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
const pending = new Map<number, PendingTask>();

function runOnMainThread(task: PendingTask): void {
  setTimeout(() => {
    try {
      task.resolve(executeSimulationTask(task.request, task.onProgress));
    } catch (error) {
      task.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }, 0);
}

function stopWorker(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  worker?.terminate();
  worker = null;
  workerStateId = null;
}

function scheduleIdleShutdown(): void {
  if (idleTimer) clearTimeout(idleTimer);
  if (!pending.size) idleTimer = setTimeout(stopWorker, 300_000);
}

function getWorker(): Worker {
  if (worker) return worker;
  const currentWorker = new SimulationWorker();
  worker = currentWorker;
  workerStateId = null;
  currentWorker.onmessage = (event: MessageEvent<SimulationWorkerMessage>) => {
    if (worker !== currentWorker) return;
    const message = event.data;
    const task = pending.get(message.id);
    if (!task) return;
    if (message.kind === "PROGRESS") {
      task.onProgress?.(message.completed, message.total);
      return;
    }
    if (message.kind === "RESYNC") {
      if (!task.reuseSent) {
        fallbackTask(message.id, task);
        return;
      }
      task.reuseSent = false;
      workerStateId = null;
      try {
        currentWorker.postMessage({ id: message.id, kind: "FULL", request: task.request } satisfies SimulationWorkerRequest);
      } catch {
        fallbackTask(message.id, task);
      }
      return;
    }
    pending.delete(message.id);
    if (message.kind === "RESULT") {
      workerStateId = message.id;
      returnedStates.set(message.result.state, { worker: currentWorker, id: message.id });
      task.resolve(message.result);
    } else {
      workerStateId = null;
      task.reject(new Error(message.message));
    }
    scheduleIdleShutdown();
  };
  currentWorker.onerror = () => {
    if (worker !== currentWorker) return;
    for (const task of pending.values()) runOnMainThread(task);
    pending.clear();
    stopWorker();
  };
  return currentWorker;
}

function fallbackTask(id: number, task: PendingTask): void {
  workerStateId = null;
  pending.delete(id);
  runOnMainThread(task);
  if (!pending.size) stopWorker();
}

export function warmSimulationWorker(): void {
  try {
    getWorker();
    scheduleIdleShutdown();
  } catch {
    // Some embedded browsers block Blob workers; the simulation still has a fallback.
  }
}

// Returned GameState values are immutable snapshots. Manager edits must replace the root object
// so Worker reuse is invalidated, as App's command and load flows already do.
export function simulateInBackground(request: SimulationRequest, onProgress?: (completed: number, total: number) => void): Promise<SimulationResult> {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    const task: PendingTask = { request, resolve, reject, onProgress, reuseSent: false };
    pending.set(id, task);
    try {
      const currentWorker = getWorker();
      const known = returnedStates.get(request.state);
      task.reuseSent = known?.worker === currentWorker && known.id === workerStateId;
      const message: SimulationWorkerRequest = task.reuseSent
        ? { id, kind: "REUSE", baseId: known!.id, action: request.action, pregameSelection: request.pregameSelection }
        : { id, kind: "FULL", request };
      currentWorker.postMessage(message);
    } catch {
      fallbackTask(id, task);
    }
  });
}
