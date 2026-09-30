import { afterEach, describe, expect, it, vi } from "vitest";
import { PORTRAIT_ATLAS_PLAYER_IDS } from "../data/portraitAtlasIds";
import { BUNDLED_RETIRED_PORTRAIT_IDS } from "../data/retiredLegendPortraitIds";
import { calculatePlayerOverall } from "../game/player/PlayerRatingService";
import { LINEUP_POSITIONS, buildDefaultRotationPlan } from "../game/roster/RotationPlanService";
import { createCareer } from "../game/season/career";
import { playerNameZh } from "./playerNameZh";
import { portraitSpriteMeta } from "./portraitSprite";
import { renderRosterPoster, rosterPosterRows, type RosterPosterData } from "./rosterPoster";

function fixture(): RosterPosterData {
  const state = createCareer("roster-poster");
  const team = state.teams[state.userTeamId];
  const players = team.playerIds.map((id) => state.players[id]);
  players.forEach((player) => { player.portraitPath = null; });
  return { team, players, seasonId: state.league.seasonId, plan: buildDefaultRotationPlan(players) };
}

function starter(data: RosterPosterData, position = LINEUP_POSITIONS[0]) {
  return data.players.find((player) => player.id === data.plan.starters[position])!;
}

function atlasStarter(data: RosterPosterData, position: typeof LINEUP_POSITIONS[number], index: number) {
  const player = starter(data, position);
  player.id = `nba:${PORTRAIT_ATLAS_PLAYER_IDS[index]}`;
  player.portraitPath = `./player-portraits/nba-${PORTRAIT_ATLAS_PLAYER_IDS[index]}.png`;
  data.plan.starters[position] = player.id;
  return player;
}

function canvasMock(options: {
  contextNull?: boolean; blobNull?: boolean; blobThrows?: boolean;
  logo?: "error" | "timeout"; portrait?: "error" | "timeout" | "invalid";
} = {}) {
  const texts: Array<{ value: string; x: number; y: number; width: number; align: CanvasTextAlign }> = [];
  const context = {
    font: "10px sans-serif", textAlign: "left" as CanvasTextAlign,
    fillStyle: "", strokeStyle: "", lineWidth: 0,
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    fillRect: vi.fn(), strokeRect: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(),
    drawImage: vi.fn(),
    measureText: vi.fn((value: string) => ({ width: Array.from(value).length * Number(context.font.match(/(\d+)px/)?.[1] ?? 10) })),
    fillText: vi.fn((value: string, x: number, y: number) => {
      texts.push({ value, x, y, width: context.measureText(value).width, align: context.textAlign });
    }),
  };
  const blob = new Blob(["roster"], { type: "image/png" });
  const canvas = {
    width: 0, height: 0,
    getContext: vi.fn(() => options.contextNull ? null : context),
    toBlob: vi.fn((callback: BlobCallback, type: string) => {
      expect(type).toBe("image/png");
      if (options.blobThrows) throw new Error("canvas encoding failed");
      callback(options.blobNull ? null : blob);
    }),
  };
  const sources: string[] = [];
  vi.stubGlobal("document", { createElement: vi.fn((tag: string) => { expect(tag).toBe("canvas"); return canvas; }) });
  vi.stubGlobal("Image", class {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 2500;
    naturalHeight = 100;
    source = "";
    set src(value: string) {
      sources.push(value);
      this.source = value;
      const mode = value.includes("branding/") ? options.logo : options.portrait;
      if (mode === "timeout") return;
      if (mode === "invalid") this.naturalWidth = 0;
      queueMicrotask(() => mode === "error" ? this.onerror?.() : this.onload?.());
    }
  });
  return { context, canvas, blob, texts, sources };
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("roster poster rows", () => {
  it("uses exactly the five displayed draft slots without normalization or bench players", () => {
    const data = fixture();
    [data.plan.starters.PG, data.plan.starters.C] = [data.plan.starters.C, data.plan.starters.PG];
    const before = structuredClone(data.plan);
    const rows = rosterPosterRows(data);
    expect(rows).toHaveLength(5);
    expect(rows.map((row) => row.position)).toEqual(LINEUP_POSITIONS);
    expect(rows.map((row) => row.playerId)).toEqual(LINEUP_POSITIONS.map((slot) => data.plan.starters[slot]));
    expect(data.plan).toEqual(before);
    rows.forEach((row) => {
      const player = data.players.find((candidate) => candidate.id === row.playerId)!;
      expect(row).toEqual({ playerId: player.id, name: playerNameZh(player.name, player.id), position: row.position, overall: calculatePlayerOverall(player), portraitPath: player.portraitPath });
    });
    expect(rows.some((row) => !Object.values(data.plan.starters).includes(row.playerId))).toBe(false);
  });

  it("does not change the saved team plan when sharing a separate unsaved draft", () => {
    const data = fixture();
    const savedPlan = structuredClone(data.plan);
    Object.assign(data.team, { rotationPlan: savedPlan });
    const reserve = data.players.find((player) => !Object.values(data.plan.starters).includes(player.id) && player.available && !player.injury)!;
    data.plan.starters.PG = reserve.id;
    expect(rosterPosterRows(data)[0].playerId).toBe(reserve.id);
    expect(savedPlan.starters.PG).not.toBe(reserve.id);
  });

  it.each(["missing", "duplicate", "unavailable", "injury"])("rejects invalid %s starters rather than replacing them", (mode) => {
    const data = fixture();
    const player = starter(data);
    if (mode === "missing") data.plan.starters.PG = "missing";
    if (mode === "duplicate") data.plan.starters.SG = player.id;
    if (mode === "unavailable") player.available = false;
    if (mode === "injury") player.injury = {
      injuryId: "poster-injury", severity: "MINOR", gamesRemaining: 3,
      occurredSeasonId: data.seasonId, occurredGameId: "poster-game", previousRotationRole: player.rotationRole,
    };
    expect(() => rosterPosterRows(data)).toThrow(/选择首发球员|不能重复|无法出战/u);
  });
});

describe("renderRosterPoster", () => {
  it("renders the application logo and only the five slots, names, portraits and ratings", async () => {
    const mock = canvasMock();
    const data = fixture();
    expect(await renderRosterPoster(data)).toBe(mock.blob);
    expect(mock.sources).toEqual([`${import.meta.env.BASE_URL}branding/home-logo-cutout.png`]);
    expect(mock.context.drawImage).toHaveBeenCalledOnce();
    const values = mock.texts.map((text) => text.value);
    expect(values).toEqual(expect.arrayContaining([data.team.fullName, "首发五虎", ...LINEUP_POSITIONS]));
    expect(values.filter((value) => value === "能力")).toHaveLength(5);
    expect(mock.texts.filter((text) => text.x === 395)).toHaveLength(5);
    expect(values.join(" ")).not.toMatch(/替补|目标分钟|赛季战绩|分区排名|阵容适配/u);
    expect(mock.context.arc).toHaveBeenCalledTimes(10);
    expect(mock.canvas.width).toBe(1080);
    expect(mock.canvas.height).toBe(1560);
    expect(mock.canvas.toBlob).toHaveBeenCalledOnce();
  });

  it("crops the atlas using its natural dimensions and caches each atlas per export", async () => {
    const mock = canvasMock();
    const data = fixture();
    const first = atlasStarter(data, "PG", 1);
    atlasStarter(data, "SG", 3);
    atlasStarter(data, "SF", 26);
    const sprite = portraitSpriteMeta(first.id, first.portraitPath)!;
    await renderRosterPoster(data);
    const source = `${import.meta.env.BASE_URL}${sprite.source.slice(2)}`;
    expect(mock.sources.filter((value) => value === source)).toHaveLength(1);
    const crops = mock.context.drawImage.mock.calls.filter((args) => args.length === 9);
    expect(crops).toHaveLength(3);
    expect(crops.map((args) => args.slice(1, 5))).toEqual([[100, 0, 100, 100], [300, 0, 100, 100], [100, 0, 100, 100]]);
    expect(crops[0].slice(5)).toEqual([210, 375, 148, 148]);
  });

  it.each([true, false])("waits for trusted retired inline data (preloaded=%s)", async (preloaded) => {
    const mock = canvasMock();
    const data = fixture();
    const retiredId = BUNDLED_RETIRED_PORTRAIT_IDS[0];
    starter(data).portraitPath = `./retired-portraits/nba-${retiredId}.webp`;
    const payload = "data:image/webp;base64,AAAA";
    const scripts: Array<{ onload?: () => void; remove: () => void }> = [];
    vi.stubGlobal("window", preloaded ? { RETIRED_PORTRAIT_DATA: { [retiredId]: payload } } : {});
    if (!preloaded) {
      const createElement = document.createElement;
      vi.stubGlobal("document", {
        createElement: (tag: string) => tag === "script" ? { remove: vi.fn() } : createElement(tag),
        head: { appendChild: (script: typeof scripts[number]) => { scripts.push(script); } },
      });
    }
    const pending = renderRosterPoster(data);
    if (!preloaded) {
      expect(scripts).toHaveLength(1);
      expect(mock.canvas.toBlob).not.toHaveBeenCalled();
      Object.assign(window, { RETIRED_PORTRAIT_DATA: { [retiredId]: payload } });
      scripts[0].onload?.();
    }
    await pending;
    expect(mock.sources).toContain(payload);
    expect(mock.sources.some((source) => source.includes("retired-portraits/nba-"))).toBe(false);
    expect(mock.context.drawImage).toHaveBeenCalledTimes(2);
    expect(mock.context.drawImage.mock.calls.every((args) => args.length === 5)).toBe(true);
  });

  it("exports a default portrait after lazy data loading fails", async () => {
    const mock = canvasMock();
    const data = fixture();
    starter(data).portraitPath = `./retired-portraits/nba-${BUNDLED_RETIRED_PORTRAIT_IDS[0]}.webp`;
    vi.stubGlobal("window", {});
    const createElement = document.createElement;
    vi.stubGlobal("document", {
      createElement: (tag: string) => tag === "script" ? { remove: vi.fn() } : createElement(tag),
      head: { appendChild: (script: { onerror: () => void }) => { queueMicrotask(() => script.onerror()); } },
    });
    expect(await renderRosterPoster(data)).toBe(mock.blob);
    expect(mock.sources).toEqual([`${import.meta.env.BASE_URL}branding/home-logo-cutout.png`]);
    expect(mock.context.arc).toHaveBeenCalledTimes(10);
  });

  it("ignores remote, arbitrary inline and unknown retired portrait paths", async () => {
    const mock = canvasMock();
    const data = fixture();
    starter(data, "PG").portraitPath = "https://example.com/nba-2544.png";
    starter(data, "SG").portraitPath = "data:image/webp;base64,AAAA";
    starter(data, "SF").portraitPath = "./retired-portraits/nba-999999999.webp";
    const retiredId = BUNDLED_RETIRED_PORTRAIT_IDS[0];
    starter(data, "PF").portraitPath = `./retired-portraits/nba-${retiredId}.webp`;
    vi.stubGlobal("window", { RETIRED_PORTRAIT_DATA: { [retiredId]: "https://example.com/portrait.webp" } });
    await renderRosterPoster(data);
    expect(mock.sources).toEqual([`${import.meta.env.BASE_URL}branding/home-logo-cutout.png`]);
    expect(mock.sources).toHaveLength(1);
    expect(mock.sources.every((source) => !source.startsWith("https:") && !source.startsWith("data:"))).toBe(true);
  });

  it.each(["error", "invalid", "timeout"] as const)("falls back to a default portrait on image %s", async (portrait) => {
    if (portrait === "timeout") vi.useFakeTimers();
    const mock = canvasMock({ portrait });
    const data = fixture();
    atlasStarter(data, "PG", 0);
    const pending = renderRosterPoster(data);
    if (portrait === "timeout") await vi.advanceTimersByTimeAsync(10000);
    expect(await pending).toBe(mock.blob);
    expect(mock.context.drawImage).toHaveBeenCalledOnce();
    expect(mock.context.arc).toHaveBeenCalledTimes(10);
    if (portrait === "timeout") expect(vi.getTimerCount()).toBe(0);
  });

  it("uses a default portrait if local image drawing fails", async () => {
    const mock = canvasMock();
    const data = fixture();
    atlasStarter(data, "PG", 0);
    mock.context.drawImage.mockImplementation((...args: unknown[]) => { if (args.length === 9) throw new Error("damaged image"); });
    await expect(renderRosterPoster(data)).resolves.toBe(mock.blob);
    expect(mock.context.arc).toHaveBeenCalledTimes(10);
  });

  it("bounds long Unicode player names, team name and season", async () => {
    const mock = canvasMock();
    const data = fixture();
    data.team.fullName = "很长的球队名字".repeat(20);
    data.seasonId = "很长的赛季名称".repeat(20);
    data.players.forEach((player) => { player.name = "球员名字🏀".repeat(20); });
    await renderRosterPoster(data);
    const names = mock.texts.filter((text) => text.x === 395 && text.value.includes("…"));
    expect(names).toHaveLength(5);
    names.forEach((text) => expect(text.width).toBeLessThanOrEqual(410));
    mock.texts.filter((text) => text.x === 310 && text.value.includes("…")).forEach((text) => expect(text.width).toBeLessThanOrEqual(680));
    mock.texts.forEach((text) => {
      const start = text.align === "center" ? text.x - text.width / 2 : text.x;
      expect(start).toBeGreaterThanOrEqual(45);
      expect(start + text.width).toBeLessThanOrEqual(1035);
      expect(text.y).toBeLessThan(mock.canvas.height);
    });
  });

  it.each([
    [{ contextNull: true }, "当前设备无法生成首发五虎图片"],
    [{ blobNull: true }, "首发五虎图片生成失败"],
    [{ blobThrows: true }, "首发五虎图片生成失败"],
    [{ logo: "error" as const }, "应用 Logo 加载失败"],
  ])("reports export or branding failures (%j)", async (options, message) => {
    canvasMock(options);
    await expect(renderRosterPoster(fixture())).rejects.toThrow(message);
  });

  it("times out a stalled logo rather than generating an unbranded image", async () => {
    vi.useFakeTimers();
    const mock = canvasMock({ logo: "timeout" });
    const result = expect(renderRosterPoster(fixture())).rejects.toThrow("应用 Logo 加载超时");
    await vi.advanceTimersByTimeAsync(10000);
    await result;
    expect(mock.canvas.toBlob).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
