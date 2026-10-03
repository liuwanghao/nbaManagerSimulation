import { describe, expect, it } from "vitest";
import { createCareer } from "../game/season/career";
import { executeSimulationTask, type SimulationRequest } from "./simulationTask";
import { createSimulationWorkerHandler, type SimulationWorkerMessage } from "./simulationWorkerProtocol";

function request(seed: string): SimulationRequest {
  return { state: createCareer(seed), pregameSelection: null, action: { kind: "CALENDAR", target: { kind: "ONE_GAME" } } };
}

const reuse = (id: number, baseId: number, input: SimulationRequest) => ({
  id, baseId, kind: "REUSE" as const, action: input.action, pregameSelection: input.pregameSelection,
});

describe("simulation Worker private state protocol", () => {
  it("requests a full input when no successful state is retained", () => {
    const messages: SimulationWorkerMessage[] = [];
    const handle = createSimulationWorkerHandler((message) => messages.push(structuredClone(message)));
    handle({ id: 1, kind: "REUSE", baseId: 0, action: { kind: "CALENDAR", target: { kind: "ONE_GAME" } }, pregameSelection: null });
    expect(messages).toEqual([{ id: 1, kind: "RESYNC" }]);
  });

  it("rejects mismatched versions without advancing the valid retained state", () => {
    const messages: SimulationWorkerMessage[] = [];
    const handle = createSimulationWorkerHandler((message) => messages.push(structuredClone(message)));
    const input = request("worker-protocol-version");
    const before = structuredClone(input.state);
    handle({ id: 1, kind: "FULL", request: structuredClone(input) });
    const first = messages.find((message) => message.kind === "RESULT");
    if (first?.kind !== "RESULT") throw new Error("Missing first result");
    messages.length = 0;
    handle(reuse(2, 999, input));
    expect(messages).toEqual([{ id: 2, kind: "RESYNC" }]);
    handle(reuse(3, 1, input));
    const next = messages.find((message) => message.kind === "RESULT");
    expect(next?.kind === "RESULT" ? next.result : null).toEqual(executeSimulationTask({ ...input, state: first.result.state }));
    expect(input.state).toEqual(before);
  });

  it("discards private state after a partially completed task fails", () => {
    const messages: SimulationWorkerMessage[] = [];
    let failProgress = false;
    const handle = createSimulationWorkerHandler((message) => {
      if (failProgress && message.kind === "PROGRESS") throw new Error("Progress channel failed");
      messages.push(structuredClone(message));
    });
    const input = request("worker-protocol-partial-error");
    handle({ id: 1, kind: "FULL", request: structuredClone(input) });
    failProgress = true;
    messages.length = 0;
    handle(reuse(2, 1, input));
    expect(messages).toEqual([{ id: 2, kind: "ERROR", message: "Progress channel failed" }]);
    failProgress = false;
    handle(reuse(3, 1, input));
    expect(messages.at(-1)).toEqual({ id: 3, kind: "RESYNC" });
    handle({ id: 3, kind: "FULL", request: structuredClone(input) });
    const recovered = messages.find((message) => message.kind === "RESULT");
    expect(recovered?.kind === "RESULT" ? recovered.result : null).toEqual(executeSimulationTask(input));
  });

  it("discards cached results that could not cross the message boundary", () => {
    const messages: SimulationWorkerMessage[] = [];
    const handle = createSimulationWorkerHandler((message) => {
      if (message.kind === "RESULT") throw new Error("Cannot clone result");
      messages.push(structuredClone(message));
    });
    const input = request("worker-protocol-result-error");
    handle({ id: 1, kind: "FULL", request: structuredClone(input) });
    expect(messages.at(-1)).toEqual({ id: 1, kind: "ERROR", message: "Cannot clone result" });
    handle(reuse(2, 1, input));
    expect(messages.at(-1)).toEqual({ id: 2, kind: "RESYNC" });
  });
});
