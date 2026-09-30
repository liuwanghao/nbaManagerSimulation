import { afterEach, describe, expect, it, vi } from "vitest";
import { BUNDLED_RETIRED_PORTRAIT_IDS } from "../data/retiredLegendPortraitIds";

const id = BUNDLED_RETIRED_PORTRAIT_IDS[0];
const path = `./retired-portraits/nba-${id}.webp`;
const payload = "data:image/webp;base64,AAAA";

function scriptMock() {
  const scripts: Array<{ src: string; async: boolean; onload: (() => void) | null; onerror: (() => void) | null; remove: ReturnType<typeof vi.fn> }> = [];
  vi.stubGlobal("window", {});
  vi.stubGlobal("document", {
    createElement: vi.fn((tag: string) => {
      expect(tag).toBe("script");
      return { src: "", async: false, onload: null, onerror: null, remove: vi.fn() };
    }),
    head: { appendChild: vi.fn((script) => { scripts.push(script); }) },
  });
  return scripts;
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.resetModules(); });

describe("retired portrait lazy loading", () => {
  it("does not load data until an approved retired portrait is requested", async () => {
    const scripts = scriptMock();
    const { loadRetiredPortrait } = await import("./retiredPortraitLoader");
    expect(scripts).toHaveLength(0);
    for (const source of [null, "./player-portraits/nba-1.png", "./retired-portraits/nba-999999999.webp", "https://example.com/portrait.webp"]) {
      expect(await loadRetiredPortrait(source)).toBeNull();
    }
    expect(scripts).toHaveLength(0);
  });

  it("shares one classic script request and returns validated inline images", async () => {
    const scripts = scriptMock();
    const { loadRetiredPortrait } = await import("./retiredPortraitLoader");
    const first = loadRetiredPortrait(path);
    const second = loadRetiredPortrait(path);
    expect(scripts).toHaveLength(1);
    expect(scripts[0].src).toBe(`${import.meta.env.BASE_URL}retired-portraits/data.js`);
    expect(scripts[0].async).toBe(true);
    Object.assign(window, { RETIRED_PORTRAIT_DATA: { [id]: payload } });
    scripts[0].onload?.();
    expect(await Promise.all([first, second])).toEqual([payload, payload]);
    expect(await loadRetiredPortrait(path)).toBe(payload);
    expect(scripts).toHaveLength(1);
  });

  it.each(["error", "timeout", "missing-data"])("allows retry after %s without requesting removed WebP files", async (mode) => {
    vi.useFakeTimers();
    const scripts = scriptMock();
    const { loadRetiredPortrait } = await import("./retiredPortraitLoader");
    const first = loadRetiredPortrait(path);
    if (mode === "error") scripts[0].onerror?.();
    else if (mode === "missing-data") scripts[0].onload?.();
    else await vi.advanceTimersByTimeAsync(10000);
    expect(await first).toBeNull();
    expect(scripts[0].remove).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    const second = loadRetiredPortrait(path);
    expect(scripts).toHaveLength(2);
    Object.assign(window, { RETIRED_PORTRAIT_DATA: { [id]: payload } });
    scripts[1].onload?.();
    expect(await second).toBe(payload);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses preloaded data and rejects unsafe inline values", async () => {
    const scripts = scriptMock();
    Object.assign(window, { RETIRED_PORTRAIT_DATA: { [id]: payload } });
    const { loadRetiredPortrait } = await import("./retiredPortraitLoader");
    expect(await loadRetiredPortrait(path)).toBe(payload);
    Object.assign(window, { RETIRED_PORTRAIT_DATA: { [id]: "https://example.com/portrait.webp" } });
    expect(await loadRetiredPortrait(path)).toBeNull();
    expect(scripts).toHaveLength(0);
  });
});
