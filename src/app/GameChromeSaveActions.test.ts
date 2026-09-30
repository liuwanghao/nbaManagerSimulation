import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GameChrome, type SaveActionResult } from "./GameChrome";

const hooks = vi.hoisted(() => ({ cursor: 0, values: [] as unknown[] }));
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = initial;
    return [hooks.values[index], (next: unknown) => { hooks.values[index] = next; }];
  },
  useRef: (initial: unknown) => {
    const index = hooks.cursor++;
    return hooks.values[index] ??= { current: initial };
  },
  useEffect: () => undefined,
}));

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Record<string, unknown>>;
  return [element, ...elements(element.props.children as ReactNode)];
}
function render(props: Partial<Parameters<typeof GameChrome>[0]> = {}) {
  hooks.cursor = 0;
  return elements(GameChrome({ phase: "PRESEASON", initialDrawerTab: "save", ...props }));
}
function button(tree: ReturnType<typeof render>, label: string) {
  return tree.find((node) => node.type === "button" && node.props.children === label)!;
}
function dialog(tree: ReturnType<typeof render>) { return tree.some((node) => node.props.role === "dialog"); }
async function flush() { for (let index = 0; index < 8; index++) await Promise.resolve(); }
beforeEach(() => { hooks.values = []; });

describe("save drawer outcomes", () => {
  it.each(["LOCAL", "SYNCED"] as const)("closes only after %s success", async (result) => {
    const onSave = vi.fn().mockResolvedValue(result);
    (button(render({ onSave }), "覆盖保存").props.onClick as () => void)();
    await flush();
    expect(onSave).toHaveBeenCalledWith(1, { rebuildCorrupted: false });
    expect(dialog(render({ onSave }))).toBe(false);
  });

  it.each(["CONFLICT", "LOCAL_SYNC_FAILED", false, undefined])("keeps the drawer for outcome %s", async (result) => {
    const onSave = vi.fn().mockResolvedValue(result as SaveActionResult | void);
    (button(render({ onSave }), "覆盖保存").props.onClick as () => void)();
    await flush();
    const tree = render({ onSave });
    expect(dialog(tree)).toBe(true);
    expect(tree.some((node) => node.props.role === "alert")).toBe(true);
  });

  it("keeps a failed save visible and retries successfully", async () => {
    const onSave = vi.fn().mockRejectedValueOnce(new Error("本机存储空间不足")).mockResolvedValue("LOCAL");
    (button(render({ onSave }), "覆盖保存").props.onClick as () => void)();
    await flush();
    expect(render({ onSave }).some((node) => node.props.children === "本机存储空间不足")).toBe(true);
    (button(render({ onSave }), "覆盖保存").props.onClick as () => void)();
    await flush();
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(dialog(render({ onSave }))).toBe(false);
  });

  it("does not change the active slot before a read completes or fails", async () => {
    const onSlotChange = vi.fn();
    const onLoad = vi.fn().mockRejectedValue(new Error("槽位为空"));
    const props = { onLoad, onSlotChange, initialDrawerTab: "load" as const };
    const reads = render(props).filter((node) => node.type === "button" && node.props.children === "读取此存档");
    (reads[1].props.onClick as () => void)();
    await flush();
    expect(onLoad).toHaveBeenCalledWith(2);
    expect(onSlotChange).not.toHaveBeenCalled();
    expect(dialog(render(props))).toBe(true);
  });

  it("requires explicit confirmation to rebuild a corrupted slot", async () => {
    const onSave = vi.fn().mockResolvedValue("LOCAL");
    const props = { onSave, saveSlots: [{ slotId: 2 as const, status: "CORRUPTED" as const, teamName: "", seasonId: "", currentDate: "", phase: "", wins: 0, losses: 0, revision: 0, updatedAt: "" }] };
    (button(render(props), "重建并保存").props.onClick as () => void)();
    expect(onSave).not.toHaveBeenCalled();
    (button(render(props), "确认重建并保存").props.onClick as () => void)();
    await flush();
    expect(onSave).toHaveBeenCalledWith(2, { rebuildCorrupted: true });
  });
});
