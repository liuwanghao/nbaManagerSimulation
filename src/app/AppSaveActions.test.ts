import type { ReactElement, ReactNode } from "react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createCareer } from "../game/season/career";
import type { GameState } from "../game/state/types";
import { MemoryStorageAdapter } from "../platform/storage/StorageAdapter";
import { SaveService } from "../storage/SaveService";
import { GameChrome, type SeasonTab } from "./GameChrome";
import { CareerPages } from "./CareerPages";

const hooks = vi.hoisted(() => ({ cursor: 0, values: [] as unknown[] }));
const platform = vi.hoisted(() => ({ storage: null as unknown }));
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
  useEffect: () => undefined,
  useLayoutEffect: () => undefined,
  startTransition: (action: () => void) => action(),
}));
vi.mock("../platform/PlatformAdapter", () => ({ createBrowserPlatform: () => platform }));
vi.mock("react-dom", () => ({ createPortal: (children: ReactNode) => children }));

let App: typeof import("./App").default;
let storage: MemoryStorageAdapter;
let saves: SaveService;
let initial: GameState;

function findChrome(node: ReactNode): ReactElement<Parameters<typeof GameChrome>[0]> | undefined {
  if (Array.isArray(node)) return node.map(findChrome).find(Boolean);
  if (!node || typeof node !== "object" || !("props" in node)) return undefined;
  const element = node as ReactElement<{ children?: ReactNode }>;
  if (element.type === GameChrome) return element as ReactElement<Parameters<typeof GameChrome>[0]>;
  return findChrome(element.props.children);
}
function renderTree(activeTab: SeasonTab = "home") {
  hooks.cursor = 0;
  return App({ initialState: initial, initialActiveTab: activeTab });
}
function render() { return findChrome(renderTree())!.props; }
function findCareer(node: ReactNode): ReactElement<Parameters<typeof CareerPages>[0]> | undefined {
  if (Array.isArray(node)) return node.map(findCareer).find(Boolean);
  if (!node || typeof node !== "object" || !("props" in node)) return undefined;
  const element = node as ReactElement<{ children?: ReactNode }>;
  if (element.type === CareerPages) return element as ReactElement<Parameters<typeof CareerPages>[0]>;
  return findCareer(element.props.children);
}

beforeAll(async () => {
  storage = new MemoryStorageAdapter();
  platform.storage = storage;
  vi.stubGlobal("window", { setTimeout, clearTimeout });
  vi.stubGlobal("document", { body: {} });
  App = (await import("./App")).default;
  saves = new SaveService(storage);
});
beforeEach(async () => {
  vi.restoreAllMocks();
  for (const slot of [1, 2, 3]) {
    for (const suffix of ["", ":pending", ":previous-valid"]) await storage.remove(`basketball-manager:career:${slot}${suffix}`);
  }
  hooks.values = [];
  initial = createCareer("save-actions-regression");
  initial.meta.dataVersion = "hupu.nba.live-roster.test";
  await saves.save(1, initial);
});
afterAll(() => vi.unstubAllGlobals());

describe("save drawer App actions", () => {
  it.each(["empty", "corrupted", "incompatible", "storage rejection"])("keeps the autosave target after a %s load fails", async (failure) => {
    if (failure === "corrupted") await storage.set("basketball-manager:career:2", "broken-json");
    if (failure === "incompatible") {
      const old = structuredClone(initial);
      old.meta.dataVersion = "legacy-fictional";
      await saves.save(2, old);
    }
    if (failure === "storage rejection") vi.spyOn(storage, "get").mockRejectedValueOnce(new Error("READ_FAILED"));
    await expect(render().onLoad!(2)).rejects.toThrow();
    expect(render().activeSlot).toBe(1);
    expect(await render().onSave!()).toBe("LOCAL");
    expect((await saves.load(1))?.calendar.currentDateIndex).toBe(initial.calendar.currentDateIndex);
    if (failure === "empty" || failure === "storage rejection") expect(await saves.load(2)).toBeNull();
    if (failure === "corrupted") expect(await storage.get("basketball-manager:career:2")).toBe("broken-json");
    if (failure === "incompatible") expect((await saves.load(2))?.meta.dataVersion).toBe("legacy-fictional");
  });

  it("changes slots only when a manual save succeeds, and allows a failed write to retry", async () => {
    const write = vi.spyOn(storage, "set").mockRejectedValueOnce(new Error("WRITE_FAILED"));
    await expect(render().onSave!(2)).rejects.toThrow("保存失败");
    expect(render().activeSlot).toBe(1);
    write.mockRestore();
    expect(await render().onSave!(2)).toBe("LOCAL");
    expect(render().activeSlot).toBe(2);
    expect(await saves.load(2)).not.toBeNull();
  });

  it("prevents leaderboard snapshots and slot loads from overlapping an active save", async () => {
    const tree = renderTree("career");
    const chrome = findChrome(tree)!.props;
    const career = findCareer(tree)!.props;
    const save = chrome.onSave!();
    await expect(career.onPrepareLeaderboard()).rejects.toThrow("当前操作正在保存");
    expect(await chrome.onLoad!(2)).toBe(false);
    await save;
    await findCareer(renderTree("career"))!.props.onPrepareLeaderboard();
    expect(render().activeSlot).toBe(1);
    expect((await saves.listSlotSummaries()).find((slot) => slot.slotId === 1)?.revision).toBe(3);
  });

  it("commits the loaded state and its slot together", async () => {
    const next = structuredClone(initial);
    next.calendar.currentDateIndex += 1;
    await saves.save(2, next);
    expect(await render().onLoad!(2)).toBe(true);
    expect(render().activeSlot).toBe(2);
    await render().onSave!();
    expect((await saves.load(2))?.calendar.currentDateIndex).toBe(next.calendar.currentDateIndex);
  });
});
