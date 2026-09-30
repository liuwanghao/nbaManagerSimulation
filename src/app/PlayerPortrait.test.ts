import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PORTRAIT_ATLAS_PLAYER_IDS } from "../data/portraitAtlasIds";
import { usePlayerPortrait } from "./PlayerPortrait";

const hooks = vi.hoisted(() => ({
  value: null as { key: string; source: string } | null,
  effects: [] as Array<() => (() => void) | undefined>,
  update: vi.fn(),
  load: vi.fn(),
}));
vi.mock("react", () => ({
  useState: () => [hooks.value, (value: typeof hooks.value) => { hooks.value = value; hooks.update(value); }],
  useEffect: (effect: typeof hooks.effects[number]) => { hooks.effects.push(effect); },
}));
vi.mock("./retiredPortraitLoader", () => ({ loadRetiredPortrait: hooks.load }));

const path = "./retired-portraits/nba-76003.webp";
const inline = "data:image/webp;base64,AAAA";
const images: Array<{ onload: (() => void) | null; onerror: (() => void) | null; src: string }> = [];

beforeEach(() => {
  hooks.value = null;
  hooks.effects = [];
  hooks.update.mockClear();
  hooks.load.mockReset();
  images.length = 0;
  vi.stubGlobal("Image", class {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    src = "";
    constructor() { images.push(this); }
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

async function flush() { await Promise.resolve(); await Promise.resolve(); }

describe("player portrait lifecycle", () => {
  it("waits for lazy data and image decoding before showing a retired portrait", async () => {
    let resolve!: (source: string) => void;
    hooks.load.mockReturnValue(new Promise<string>((done) => { resolve = done; }));
    expect(usePlayerPortrait("draft:1", path).showPortrait).toBe(false);
    hooks.effects[0]();
    expect(images).toHaveLength(0);
    resolve(inline);
    await flush();
    expect(images[0].src).toBe(inline);
    expect(hooks.update).not.toHaveBeenCalled();
    images[0].onload?.();
    const display = usePlayerPortrait("draft:1", path);
    expect(display.showPortrait).toBe(true);
    expect(display.style?.backgroundImage).toBe(`url("${inline}")`);
    expect(usePlayerPortrait("draft:2", "./retired-portraits/nba-1.webp").showPortrait).toBe(false);
  });

  it("does not create an image or update state after unmount during data loading", async () => {
    let resolve!: (source: string) => void;
    hooks.load.mockReturnValue(new Promise<string>((done) => { resolve = done; }));
    usePlayerPortrait("draft:1", path);
    const cleanup = hooks.effects[0]();
    cleanup?.();
    resolve(inline);
    await flush();
    expect(images).toHaveLength(0);
    expect(hooks.update).not.toHaveBeenCalled();
  });

  it("clears image handlers and prevents a late image event after unmount", async () => {
    hooks.load.mockResolvedValue(inline);
    usePlayerPortrait("draft:1", path);
    const cleanup = hooks.effects[0]();
    await flush();
    const lateOnload = images[0].onload;
    cleanup?.();
    expect(images[0].onload).toBeNull();
    expect(images[0].onerror).toBeNull();
    lateOnload?.();
    expect(hooks.update).not.toHaveBeenCalled();
  });

  it("keeps a default portrait after failed data loading", async () => {
    hooks.load.mockResolvedValue(null);
    usePlayerPortrait("draft:1", path);
    hooks.effects[0]();
    await flush();
    expect(images).toHaveLength(0);
    expect(hooks.value).toBeNull();
  });

  it("keeps the existing atlas crop without loading historical data", () => {
    const id = PORTRAIT_ATLAS_PLAYER_IDS[1];
    const display = usePlayerPortrait(`nba:${id}`, `./player-portraits/nba-${id}.png`);
    hooks.effects[0]();
    expect(hooks.load).not.toHaveBeenCalled();
    expect(images[0].src).toMatch(/nba-atlas-000.webp$/u);
    expect(display.style?.backgroundSize).toBe("2500% 100%");
  });
});
