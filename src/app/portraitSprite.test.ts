import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { PORTRAIT_ATLAS_PLAYER_IDS, PORTRAIT_ATLAS_STRIP_PATHS } from "../data/portraitAtlasIds";
import { portraitSpriteMeta, portraitSpriteStyle } from "./portraitSprite";

describe("portrait sprite atlas", () => {
  it("covers every available active and free-agent photograph in the offline atlas", () => {
    const active = JSON.parse(readFileSync(new URL("../data/nba-current-roster.json", import.meta.url), "utf8")).players as Array<{ nbaPlayerId: string }>;
    const freeAgents = JSON.parse(readFileSync(new URL("../data/nba-2026-free-agents.json", import.meta.url), "utf8")).players as Array<{ nbaPlayerId: string }>;
    for (const { nbaPlayerId } of [...active, ...freeAgents]) {
      const sourceExists = existsSync(new URL(`../../tools/data/portrait-source/nba-${nbaPlayerId}.png`, import.meta.url));
      const spriteExists = portraitSpriteMeta(`nba:${nbaPlayerId}`, `./player-portraits/nba-${nbaPlayerId}.png`) !== null;
      expect(spriteExists, `NBA player ${nbaPlayerId}`).toBe(sourceExists);
    }
  });

  it("maps every local NBA portrait into a 25-cell atlas strip", () => {
    expect(PORTRAIT_ATLAS_PLAYER_IDS.length).toBeGreaterThan(600);
    expect(new Set(PORTRAIT_ATLAS_PLAYER_IDS).size).toBe(PORTRAIT_ATLAS_PLAYER_IDS.length);
    expect(PORTRAIT_ATLAS_STRIP_PATHS).toHaveLength(Math.ceil(PORTRAIT_ATLAS_PLAYER_IDS.length / 25));
    for (const id of PORTRAIT_ATLAS_PLAYER_IDS) {
      expect(existsSync(new URL(`../../tools/data/portrait-source/nba-${id}.png`, import.meta.url))).toBe(true);
    }
    for (const path of PORTRAIT_ATLAS_STRIP_PATHS) {
      expect(existsSync(new URL(`../../public/${path.slice(2)}`, import.meta.url))).toBe(true);
    }
    const firstId = PORTRAIT_ATLAS_PLAYER_IDS[0];
    const style = portraitSpriteStyle(`nba:${firstId}`, `./player-portraits/nba-${firstId}.png`);
    expect(style).toMatchObject({
      backgroundImage: 'url("./player-portraits/nba-atlas-000.webp")',
      backgroundPosition: "0% 0%",
      backgroundSize: "2500% 100%",
    });
  });

  it("resolves the final atlas row to an explicitly bundled image", () => {
    const lastId = PORTRAIT_ATLAS_PLAYER_IDS.at(-1);
    expect(portraitSpriteMeta(`nba:${lastId}`, `./player-portraits/nba-${lastId}.png`)?.source)
      .toBe(PORTRAIT_ATLAS_STRIP_PATHS.at(-1));
  });

  it("keeps procedural or unavailable portraits on the no-image fallback", () => {
    expect(portraitSpriteStyle("rookie:1", null)).toBeNull();
    expect(portraitSpriteStyle("nba:999999", "./player-portraits/nba-999999.png")).toBeNull();
  });

  it("maps Max Christie to his bundled portrait atlas tile", () => {
    expect(portraitSpriteMeta("nba:1631108", "./player-portraits/nba-1631108.png")).toMatchObject({
      index: 324,
      source: "./player-portraits/nba-atlas-012.webp",
    });
  });

  it("includes Yang Hansen's local photograph", () => {
    expect(portraitSpriteMeta("nba:1642905", "./player-portraits/nba-1642905.png")?.source)
      .toMatch(/nba-atlas-\d{3}\.webp$/u);
  });
});
