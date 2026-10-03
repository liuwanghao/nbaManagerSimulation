import type { ReactElement, ReactNode } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createCareer } from "../game/season/career";
import type { ContractLifecycleCommand } from "../game/contracts/ContractLifecycleService";
import type { GameState } from "../game/state/types";
import { MemoryStorageAdapter } from "../platform/storage/StorageAdapter";
import { SaveService } from "../storage/SaveService";
import { Stage4Flow } from "./Stage4Flow";
import { GameIssueFeedbackAction } from "./GameIssueFeedbackAction";

const hooks = vi.hoisted(() => ({ cursor: 0, values: [] as unknown[], effects: [] as Array<{ effect: () => void | (() => void); deps?: unknown[] }> }));
const platform = vi.hoisted(() => ({ storage: null as unknown }));
const contract = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === "function" ? initial() : initial;
    return [hooks.values[index], (next: unknown) => {
      hooks.values[index] = typeof next === "function" ? next(hooks.values[index]) : next;
    }];
  },
  useRef: (initial: unknown) => {
    const index = hooks.cursor++;
    return hooks.values[index] ??= { current: initial };
  },
  useMemo: (factory: () => unknown) => factory(),
  useEffect: (effect: () => void | (() => void), deps?: unknown[]) => { hooks.effects.push({ effect, deps }); },
  useLayoutEffect: () => undefined,
  startTransition: (action: () => void) => action(),
}));
vi.mock("../platform/PlatformAdapter", () => ({ createBrowserPlatform: () => platform }));
vi.mock("react-dom", () => ({ createPortal: (children: ReactNode) => children }));
vi.mock("../game/contracts/ContractLifecycleService", () => ({ executeContractLifecycleCommand: contract.execute }));

let App: typeof import("./App").default;
let initial: GameState;

function findElement(node: ReactNode, predicate: (element: ReactElement<Record<string, unknown>>) => boolean): ReactElement<Record<string, unknown>> | undefined {
  if (Array.isArray(node)) return node.map((child) => findElement(child, predicate)).find(Boolean);
  if (!node || typeof node !== "object" || !("props" in node)) return undefined;
  const element = node as ReactElement<Record<string, unknown> & { children?: ReactNode }>;
  return predicate(element) ? element : findElement(element.props.children, predicate);
}

function render() {
  hooks.cursor = 0;
  hooks.effects = [];
  return App({ initialState: initial });
}

function flow(tree = render()) {
  return findElement(tree, (element) => element.type === Stage4Flow)!.props as unknown as Parameters<typeof Stage4Flow>[0];
}

const cases = [
  { type: "ROLLOVER_LEAGUE_YEAR", kind: "年度切换失败", computeStep: "计算下一联盟年度", saveStep: "保存新赛季存档", payload: {} },
  { type: "RESOLVE_TEAM_OPTION", kind: "球队选项处理失败", computeStep: "处理球队选项", saveStep: "保存球队选项存档", payload: { playerId: "test-player", decision: "PICK_UP" } },
  { type: "FINALIZE_OPTION_PHASE", kind: "进入选秀前休赛期失败", computeStep: "完成合同选项结算", saveStep: "保存选秀前休赛期存档", payload: {} },
] as const;

beforeAll(async () => {
  platform.storage = new MemoryStorageAdapter();
  vi.stubGlobal("window", {
    setTimeout: (callback: () => void, delay: number) => globalThis.setTimeout(callback, delay),
    clearTimeout: (timer: ReturnType<typeof setTimeout>) => globalThis.clearTimeout(timer),
  });
  vi.stubGlobal("document", { body: {} });
  App = (await import("./App")).default;
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.restoreAllMocks();
  hooks.values = [];
  initial = createCareer("contract-feedback-regression");
  initial.league.currentPhase = "OPTION_PHASE";
  initial.contractLifecycle = { rolloverSeasonId: initial.league.seasonId, pendingUserTeamOptionPlayerIds: [], transactionLog: [], completed: false };
  contract.execute.mockReset().mockImplementation((state: GameState) => {
    const next = structuredClone(state);
    next.league.currentPhase = "OFFSEASON_PRE_DRAFT";
    next.contractLifecycle!.completed = true;
    return next;
  });
  vi.spyOn(SaveService.prototype, "saveCheckpoint").mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());
afterAll(() => vi.unstubAllGlobals());

describe("contract command failure feedback", () => {
  it.each(cases)("identifies $type when saving fails and retains the current state", async ({ type, kind, saveStep, payload }) => {
    const save = vi.spyOn(SaveService.prototype, "save").mockRejectedValue(new Error("WRITE_FAILED"));
    const command = { commandId: `feedback-${type}`, type, payload } as ContractLifecycleCommand;
    const pending = flow().onContractCommand(command);
    await vi.runAllTimersAsync();
    await pending;

    const tree = render();
    const dialog = findElement(tree, (element) => element.props.role === "alertdialog")!;
    const heading = findElement(dialog, (element) => element.type === "h2")!;
    const report = findElement(dialog, (element) => element.type === GameIssueFeedbackAction)!.props.content as string;
    expect(heading.props.children).toBe(kind);
    expect(report).toContain(`【游戏异常】${kind}`);
    expect(report).toContain(`处理步骤：${saveStep}`);
    expect(report).toContain(`错误：${saveStep}失败：Error: WRITE_FAILED`);
    expect(report).toContain("游戏阶段：OPTION_PHASE");
    expect(report).toContain(`赛季：${initial.league.seasonId}`);
    expect(report).toContain("存档槽位：1");
    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0][1]).not.toBe(initial);
    expect(flow(tree).state).toBe(initial);
    expect(flow(tree).busy).toBe(false);
  });

  it.each(cases)("identifies the execution step for $type without attempting a save", async ({ type, kind, computeStep, payload }) => {
    const save = vi.spyOn(SaveService.prototype, "save");
    contract.execute.mockImplementation(() => { throw new Error("COMMAND_FAILED"); });
    const pending = flow().onContractCommand({ commandId: `invalid-${type}`, type, payload } as ContractLifecycleCommand);
    await vi.runAllTimersAsync();
    await pending;

    const report = findElement(render(), (element) => element.type === GameIssueFeedbackAction)!.props.content as string;
    expect(report).toContain(`【游戏异常】${kind}`);
    expect(report).toContain(`处理步骤：${computeStep}`);
    expect(save).not.toHaveBeenCalled();
    expect(flow().state).toBe(initial);
  });

  it("keeps the failed slot in feedback after the active slot changes", async () => {
    vi.spyOn(SaveService.prototype, "save").mockRejectedValue(new Error("WRITE_FAILED"));
    await flow().onContractCommand({ commandId: "feedback-option", type: "RESOLVE_TEAM_OPTION", payload: { playerId: "test-player", decision: "PICK_UP" } });
    flow().onSlotChange?.(2);

    const tree = render();
    expect(flow(tree).activeSlot).toBe(2);
    const report = findElement(tree, (element) => element.type === GameIssueFeedbackAction)!.props.content as string;
    expect(report).toContain("存档槽位：1");
  });

  it("shows rollover diagnostics during a slow save and retains the state when it fails", async () => {
    initial.league.currentPhase = "OFFSEASON";
    let rejectSave!: (error: Error) => void;
    vi.spyOn(SaveService.prototype, "save").mockImplementation(() => new Promise((_, reject) => { rejectSave = reject; }));
    const button = findElement(render(), (element) => element.type === "button" && element.props.children === "进入下一联盟年度")!;
    const pending = (button.props.onClick as () => Promise<void>)();
    render();
    const cleanup = hooks.effects.find(({ deps }) => deps?.length === 1 && deps[0] === "rollover")!.effect();
    await vi.advanceTimersByTimeAsync(12_000);

    const report = findElement(render(), (element) => element.type === GameIssueFeedbackAction)!.props.content as string;
    expect(report).toContain("【游戏异常】年度切换耗时过长");
    expect(report).toContain("处理步骤：保存新赛季存档");
    expect(report).toContain("游戏阶段：OFFSEASON");
    rejectSave(new Error("WRITE_FAILED"));
    await pending;
    cleanup?.();

    const tree = render();
    const dialog = findElement(tree, (element) => element.props.role === "alertdialog")!;
    expect(findElement(dialog, (element) => element.type === "h2")!.props.children).toBe("年度切换失败");
    expect(hooks.values[0]).toBe(initial);
  });
});
