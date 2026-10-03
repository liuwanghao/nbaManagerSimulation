import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createCareer } from "../game/season/career";
import { executeSimulationTask, type SimulationRequest, type SimulationResult } from "./simulationTask";
import { createSimulationWorkerHandler, type SimulationWorkerRequest } from "./simulationWorkerProtocol";

type HarnessMessage = { id: number; request?: SimulationRequest; [key: string]: unknown };
type WorkerHarness = {
  messages: HarnessMessage[];
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  terminated: boolean;
  postMessage: (message: HarnessMessage) => void;
  emit: (message: unknown) => void;
};

const control = vi.hoisted(() => ({ instances: [] as WorkerHarness[], constructionFails: false, postFails: false }));

vi.mock("./simulation.worker?worker&inline", () => ({
  default: class {
    messages: HarnessMessage[] = [];
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    terminated = false;

    constructor() {
      if (control.constructionFails) throw new Error("Worker blocked");
      control.instances.push(this);
    }

    postMessage(message: HarnessMessage) {
      if (control.postFails) throw new Error("Cannot clone request");
      this.messages.push(structuredClone(message));
    }

    emit(message: unknown) {
      this.onmessage?.({ data: structuredClone(message) } as MessageEvent);
    }

    terminate() { this.terminated = true; }
  },
}));

function request(seed: string): SimulationRequest {
  return { state: createCareer(seed), pregameSelection: null, action: { kind: "CALENDAR", target: { kind: "ONE_GAME" } } };
}

function respond(harness: WorkerHarness): SimulationResult {
  const message = harness.messages.at(-1)!;
  const result = executeSimulationTask(message.request!, undefined, { ownsState: true });
  harness.emit({ id: message.id, kind: "RESULT", result });
  return result;
}

function process(harness: WorkerHarness, handler: (message: SimulationWorkerRequest) => void, index = harness.messages.length - 1): void {
  handler(structuredClone(harness.messages[index]) as SimulationWorkerRequest);
}

async function establishReusableState(simulate: typeof import("./simulationWorkerClient").simulateInBackground, seed: string) {
  const original = request(seed);
  const waiting = simulate(original);
  const harness = control.instances[0];
  const handler = createSimulationWorkerHandler((message) => harness.emit(message));
  process(harness, handler);
  return { original, harness, handler, result: await waiting };
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  control.instances.length = 0;
  control.constructionFails = false;
  control.postFails = false;
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("simulation Worker boundary regression", () => {
  it("simulates a cloned input and preserves the caller state", async () => {
    const { simulateInBackground } = await import("./simulationWorkerClient");
    const original = request("worker-clone-regression");
    const before = structuredClone(original.state);
    const expected = executeSimulationTask(original);
    const progress = vi.fn();
    const waiting = simulateInBackground(original, progress);
    const harness = control.instances[0];
    expect(harness.messages[0].request!.state).not.toBe(original.state);
    harness.emit({ id: harness.messages[0].id, kind: "PROGRESS", completed: 1, total: 2 });
    const workerResult = respond(harness);
    const result = await waiting;
    expect(result).toEqual(expected);
    expect(result.state).not.toBe(workerResult.state);
    expect(original.state).toEqual(before);
    expect(progress).toHaveBeenCalledWith(1, 2);
  });

  it("keeps the main-thread fallback pure when Worker construction is blocked", async () => {
    const { simulateInBackground } = await import("./simulationWorkerClient");
    const original = request("worker-blocked-regression");
    const before = structuredClone(original.state);
    control.constructionFails = true;
    const waiting = simulateInBackground(original);
    await vi.advanceTimersByTimeAsync(0);
    expect(await waiting).toEqual(executeSimulationTask(original));
    expect(original.state).toEqual(before);
  });

  it("falls back from a failed postMessage without changing input", async () => {
    const { simulateInBackground } = await import("./simulationWorkerClient");
    const original = request("worker-post-regression");
    const before = structuredClone(original.state);
    control.postFails = true;
    const waiting = simulateInBackground(original);
    await vi.advanceTimersByTimeAsync(0);
    expect(await waiting).toEqual(executeSimulationTask(original));
    expect(original.state).toEqual(before);
    expect(control.instances[0].terminated).toBe(true);
  });

  it("replays original requests on a Worker runtime failure", async () => {
    const { simulateInBackground } = await import("./simulationWorkerClient");
    const original = request("worker-runtime-regression");
    const before = structuredClone(original.state);
    const waiting = simulateInBackground(original);
    const harness = control.instances[0];
    harness.onerror?.({} as ErrorEvent);
    await vi.advanceTimersByTimeAsync(0);
    expect(await waiting).toEqual(executeSimulationTask(original));
    expect(original.state).toEqual(before);
    expect(harness.terminated).toBe(true);
  });

  it("rejects task errors without replaying or committing results", async () => {
    const { simulateInBackground } = await import("./simulationWorkerClient");
    const original = request("worker-task-error-regression");
    const before = structuredClone(original.state);
    const waiting = simulateInBackground(original);
    const rejected = expect(waiting).rejects.toThrow("simulation failed");
    const harness = control.instances[0];
    harness.emit({ id: harness.messages[0].id, kind: "ERROR", message: "simulation failed" });
    await rejected;
    expect(original.state).toEqual(before);
    expect(harness.messages).toHaveLength(1);
  });
});

describe("simulation Worker state reuse", () => {
  it("sends only an operation for the exact returned state and preserves deterministic results", async () => {
    const { simulateInBackground } = await import("./simulationWorkerClient");
    const { original, harness, handler, result: first } = await establishReusableState(simulateInBackground, "worker-reuse-sequential");
    const before = structuredClone(first.state);
    const expected = executeSimulationTask({ ...original, state: first.state });
    const waiting = simulateInBackground({ ...original, state: first.state });
    expect(harness.messages[1]).toEqual({ id: 2, kind: "REUSE", baseId: 1, action: original.action, pregameSelection: null });
    expect(JSON.stringify(harness.messages[1])).not.toContain('"state"');
    process(harness, handler);
    expect(await waiting).toEqual(expected);
    expect(first.state).toEqual(before);
    expect(original.state.calendar.currentDateIndex).toBe(0);
  });

  it.each(["manager edit", "loaded state", "uncommitted old state"])("fully resynchronizes after %s", async (scenario) => {
    const { simulateInBackground } = await import("./simulationWorkerClient");
    const { original, harness, handler, result: first } = await establishReusableState(simulateInBackground, `worker-resync-${scenario}`);
    const state = scenario === "uncommitted old state" ? original.state : structuredClone(first.state);
    if (scenario === "manager edit") state.teams[state.userTeamId].fanSupport += 1;
    const input = { ...original, state };
    const before = structuredClone(state);
    const waiting = simulateInBackground(input);
    expect(harness.messages[1].kind).toBe("FULL");
    expect(harness.messages[1].request!.state).toEqual(state);
    process(harness, handler);
    expect(await waiting).toEqual(executeSimulationTask(input));
    expect(state).toEqual(before);
  });

  it("fully resynchronizes a previously returned committed state after the next save fails", async () => {
    const { simulateInBackground } = await import("./simulationWorkerClient");
    const { original, harness, handler, result: committed } = await establishReusableState(simulateInBackground, "worker-reuse-failed-save-retry");
    const input = { ...original, state: committed.state };
    const before = structuredClone(committed.state);
    const uncommittedWaiting = simulateInBackground(input);
    expect(harness.messages[1].kind).toBe("REUSE");
    process(harness, handler);
    const uncommitted = await uncommittedWaiting;
    expect(uncommitted.state.calendar.currentDateIndex).toBeGreaterThan(committed.state.calendar.currentDateIndex);
    // Persistence failed, so App keeps the first returned snapshot and retries from that state.
    const retryWaiting = simulateInBackground(input);
    expect(harness.messages[2]).toMatchObject({ id: 3, kind: "FULL", request: input });
    process(harness, handler);
    const retry = await retryWaiting;
    expect(retry).toEqual(executeSimulationTask(input));
    expect(retry).toEqual(uncommitted);
    expect(committed.state).toEqual(before);
  });

  it("resynchronizes concurrent stale tokens using the same task id and original input", async () => {
    const { simulateInBackground } = await import("./simulationWorkerClient");
    const { original, harness, handler, result: first } = await establishReusableState(simulateInBackground, "worker-reuse-concurrent");
    const input = { ...original, state: first.state };
    const progress = vi.fn();
    const firstPending = simulateInBackground(input);
    const secondPending = simulateInBackground(input, progress);
    expect(harness.messages[1].kind).toBe("REUSE");
    expect(harness.messages[2].kind).toBe("REUSE");
    process(harness, handler, 1);
    process(harness, handler, 2);
    expect(harness.messages[3]).toMatchObject({ id: 3, kind: "FULL", request: input });
    harness.emit({ id: 3, kind: "PROGRESS", completed: 1, total: 5 });
    process(harness, handler, 3);
    const expected = executeSimulationTask(input);
    expect(await firstPending).toEqual(expected);
    expect(await secondPending).toEqual(expected);
    expect(progress).toHaveBeenCalledWith(1, 5);
    const oldResult = await firstPending;
    const staleWaiting = simulateInBackground({ ...input, state: oldResult.state });
    expect(harness.messages[4].kind).toBe("FULL");
    process(harness, handler, 4);
    await staleWaiting;
  });

  it("invalidates reuse after a task error", async () => {
    const { simulateInBackground } = await import("./simulationWorkerClient");
    const { original, harness, handler, result: first } = await establishReusableState(simulateInBackground, "worker-reuse-error");
    const input = { ...original, state: first.state };
    const failed = simulateInBackground({ ...input, action: { kind: "OPERATION", operation: "ENTER_POSTSEASON", usePregameSelection: false } });
    const rejection = expect(failed).rejects.toThrow("REGULAR_SEASON_NOT_COMPLETE");
    process(harness, handler);
    await rejection;
    const waiting = simulateInBackground(input);
    expect(harness.messages.at(-1)!.kind).toBe("FULL");
    process(harness, handler);
    expect(await waiting).toEqual(executeSimulationTask(input));
  });

  it("restarts with a full request after idle shutdown and ignores old Worker replies", async () => {
    const { simulateInBackground } = await import("./simulationWorkerClient");
    const { original, harness: oldWorker, result: first } = await establishReusableState(simulateInBackground, "worker-reuse-restart");
    await vi.advanceTimersByTimeAsync(300_000);
    expect(oldWorker.terminated).toBe(true);
    const input = { ...original, state: first.state };
    const waiting = simulateInBackground(input);
    const newWorker = control.instances[1];
    expect(newWorker.messages[0].kind).toBe("FULL");
    const currentId = newWorker.messages[0].id;
    oldWorker.emit({ id: currentId, kind: "ERROR", message: "stale error" });
    oldWorker.emit({ id: currentId, kind: "RESULT", result: first });
    oldWorker.onerror?.({} as ErrorEvent);
    expect(newWorker.terminated).toBe(false);
    const handler = createSimulationWorkerHandler((message) => newWorker.emit(message));
    process(newWorker, handler);
    const second = await waiting;
    expect(second).toEqual(executeSimulationTask(input));
    const thirdWaiting = simulateInBackground({ ...input, state: second.state });
    expect(newWorker.messages[1].kind).toBe("REUSE");
    process(newWorker, handler);
    await thirdWaiting;
  });

  it("falls back from a reuse post failure with the original main-thread state", async () => {
    const { simulateInBackground } = await import("./simulationWorkerClient");
    const { original, harness, result: first } = await establishReusableState(simulateInBackground, "worker-reuse-post-failure");
    const input = { ...original, state: first.state };
    const before = structuredClone(first.state);
    control.postFails = true;
    const waiting = simulateInBackground(input);
    await vi.advanceTimersByTimeAsync(0);
    expect(await waiting).toEqual(executeSimulationTask(input));
    expect(first.state).toEqual(before);
    expect(harness.terminated).toBe(true);
    control.postFails = false;
    const nextWaiting = simulateInBackground(input);
    expect(control.instances[1].messages[0].kind).toBe("FULL");
    respond(control.instances[1]);
    await nextWaiting;
  });

  it("falls back safely on a repeated resync request without unbounded retries", async () => {
    const { simulateInBackground } = await import("./simulationWorkerClient");
    const { original, harness, result: first } = await establishReusableState(simulateInBackground, "worker-reuse-repeat-resync");
    const input = { ...original, state: first.state };
    const waiting = simulateInBackground(input);
    const id = harness.messages[1].id;
    harness.emit({ id, kind: "RESYNC" });
    harness.emit({ id, kind: "RESYNC" });
    harness.emit({ id, kind: "RESYNC" });
    await vi.advanceTimersByTimeAsync(0);
    expect(await waiting).toEqual(executeSimulationTask(input));
    expect(harness.messages).toHaveLength(3);
    expect(harness.terminated).toBe(true);
  });
});
