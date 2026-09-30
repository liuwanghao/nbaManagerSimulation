import { afterEach, describe, expect, it, vi } from "vitest";
import { getCareerOverview } from "../game/career/CareerRecords";
import { createCareer } from "../game/season/career";
import { renderCareerPoster } from "./careerPoster";

function mockCanvas() {
  const texts: Array<{ value: string; font: string; x: number; y: number }> = [];
  const context = {
    font: "", textAlign: "center", fillStyle: "", strokeStyle: "", lineWidth: 0,
    createLinearGradient: () => ({ addColorStop: vi.fn() }),
    fillRect: vi.fn(), strokeRect: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(),
    moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), drawImage: vi.fn(),
    measureText: (value: string) => ({ width: Array.from(value).length * Number(context.font.match(/(\d+)px/)?.[1] ?? 10) * 0.6 }),
    fillText: (value: string, x: number, y: number) => { texts.push({ value, font: context.font, x, y }); },
  };
  const blob = new Blob(["poster"], { type: "image/png" });
  const canvas = { width: 0, height: 0, getContext: () => context, toBlob: (callback: BlobCallback) => callback(blob) };
  vi.stubGlobal("document", { createElement: () => canvas });
  vi.stubGlobal("Image", class {
    onload: (() => void) | null = null;
    set src(_value: string) { queueMicrotask(() => this.onload?.()); }
  });
  return { texts, context, canvas, blob };
}

afterEach(() => vi.unstubAllGlobals());

describe("career poster", () => {
  it("keeps the application logo, career score, honors and milestone in the generated PNG", async () => {
    const mock = mockCanvas();
    const state = createCareer("career-poster");
    const overview = getCareerOverview(state);
    expect(await renderCareerPoster(state, overview, "队史首胜")).toBe(mock.blob);
    expect(mock.context.drawImage).toHaveBeenCalledOnce();
    const values = mock.texts.map((entry) => entry.value);
    expect(values).toEqual(expect.arrayContaining([
      "生 涯 战 报", state.teams[state.userTeamId].fullName,
      overview.dynastyScore.toLocaleString("zh-CN"), "常规赛", "总冠军", "完整赛季", "最新里程碑 · 队史首胜",
    ]));
    expect(mock.canvas.width).toBe(1080);
    expect(mock.canvas.height).toBe(1350);
  });

  it("shows the manager title on its own larger line, separate from the season", async () => {
    const mock = mockCanvas();
    const state = createCareer("career-title");
    const overview = getCareerOverview(state);
    await renderCareerPoster(state, overview);
    const title = mock.texts.find((entry) => entry.value === overview.level)!;
    const season = mock.texts.find((entry) => entry.value === `${state.league.seasonId} 赛季`)!;
    expect(title.font).toBe("900 54px sans-serif");
    expect(title.y).toBeGreaterThan(season.y);
    expect(title.y).toBeLessThan(790);
  });

  it.each([
    [23, "第 23 名"],
    [12345, "第 12,345 名"],
    [1234567, "第 1,234,567 名"],
    [null, "暂未上榜"],
    [undefined, "排名暂不可用"],
    [0, "排名暂不可用"],
  ])("renders the actual global rank or an honest unavailable status (%s)", async (rank, expected) => {
    const mock = mockCanvas();
    const state = createCareer("career-rank");
    await renderCareerPoster(state, getCareerOverview(state), undefined, rank);
    const values = mock.texts.map((entry) => entry.value);
    expect(values).toContain("全 服 排 名");
    expect(values).toContain(expected);
    expect(values).toContain("按账号最高积分排名");
    mock.texts.forEach((entry) => {
      const width = Array.from(entry.value).length * Number(entry.font.match(/(\d+)px/)?.[1] ?? 10) * 0.6;
      expect(entry.x - width / 2).toBeGreaterThanOrEqual(45);
      expect(entry.x + width / 2).toBeLessThanOrEqual(1035);
      expect(entry.y).toBeLessThan(1350);
    });
  });
});
