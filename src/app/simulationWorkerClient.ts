import SimulationWorker from "./simulation.worker?worker&inline";
import { executeSimulationTask, type SimulationRequest, type SimulationResult } from "./simulationTask";

type WorkerMessage = { id: number; kind: "PROGRESS"; completed: number; total: number }
  | { id: number; kind: "RESULT"; result: SimulationResult }
  | { id: number; kind: "ERROR"; message: string };
type PendingTask = {
  request: SimulationRequest;
  resolve: (result: SimulationResult) => void;
  reject: (error: Error) => void;
  onProgress?: (completed: number, total: number) => void;
};

let worker: Worker | null = null;
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
}

function scheduleIdleShutdown(): void {
  if (idleTimer) clearTimeout(idleTimer);
  if (!pending.size) idleTimer = setTimeout(stopWorker, 300_000);
}

function getWorker(): Worker {
  if (worker) return worker;
  worker = new SimulationWorker();
  worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
    const message = event.data;
    const task = pending.get(message.id);
    if (!task) return;
    if (message.kind === "PROGRESS") {
      task.onProgress?.(message.completed, message.total);
      return;
    }
    pending.delete(message.id);
    if (message.kind === "RESULT") task.resolve(message.result);
    else task.reject(new Error(message.message));
    scheduleIdleShutdown();
  };
  worker.onerror = (event) => {
    for (const task of pending.values()) runOnMainThread(task);
    pending.clear();
    stopWorker();
  };
  return worker;
}

export function warmSimulationWorker(): void {
  try {
    getWorker();
    scheduleIdleShutdown();
  } catch {
    // Some embedded browsers block Blob workers; the simulation still has a fallback.
  }
}

export function simulateInBackground(request: SimulationRequest, onProgress?: (completed: number, total: number) => void): Promise<SimulationResult> {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    const task = { request, resolve, reject, onProgress };
    pending.set(id, task);
    try {
      getWorker().postMessage({ id, request });
    } catch (error) {
      pending.delete(id);
      runOnMainThread(task);
      if (!pending.size) stopWorker();
    }
  });
}
