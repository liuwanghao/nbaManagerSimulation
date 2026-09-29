import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import Bootstrap from "./Bootstrap";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function renderAtFixture(fixture: string, dev: boolean): string {
  vi.stubEnv("DEV", dev);
  vi.stubGlobal("window", { location: { search: `?fixture=${fixture}` } });
  return renderToStaticMarkup(createElement(Bootstrap));
}

describe("Bootstrap fixture routing", () => {
  it.each(["free-agency", "save-slots", "loading", "intro"])(
    "keeps the production launcher for ?fixture=%s",
    (fixture) => {
      const markup = renderAtFixture(fixture, false);
      expect(markup).toContain('class="launcher-shell home-screen"');
      expect(markup).toContain('src="./branding/home-logo-cutout.png"');
      expect(markup).toContain('data-testid="start-new-game"');
    },
  );

  it("keeps development fixture previews available", () => {
    const markup = renderAtFixture("save-slots", true);
    expect(markup).not.toContain('class="launcher-shell home-screen"');
  });

  it("starts returning from the leaderboard with a save restoration screen", () => {
    vi.stubEnv("DEV", false);
    vi.stubGlobal("window", { location: { search: "?careerSlot=2" } });
    const markup = renderToStaticMarkup(createElement(Bootstrap));
    expect(markup).toContain("正在返回生涯总览");
    expect(markup).not.toContain('data-testid="start-new-game"');
  });
});
