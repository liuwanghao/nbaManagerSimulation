import { describe, expect, it } from "vitest";
import { PORTRAIT_ATLAS_PLAYER_IDS } from "../data/portraitAtlasIds";
import { portraitSpriteMeta, portraitSpriteStyle } from "./portraitSprite";

describe("portrait sprite atlas", () => {
  it("maps every local NBA portrait into a 25-cell atlas strip", () => {
    expect(PORTRAIT_ATLAS_PLAYER_IDS).toHaveLength(650);
    expect(new Set(PORTRAIT_ATLAS_PLAYER_IDS).size).toBe(PORTRAIT_ATLAS_PLAYER_IDS.length);
    const firstId = PORTRAIT_ATLAS_PLAYER_IDS[0];
    const style = portraitSpriteStyle(`nba:${firstId}`, `./player-portraits/nba-${firstId}.png`);
    expect(style).toMatchObject({
      backgroundImage: 'url("./player-portraits/nba-atlas-000.jpg")',
      backgroundPosition: "0% 0%",
      backgroundSize: "2500% 100%",
    });
  });

  it("resolves the final atlas row to an explicitly bundled image", () => {
    const lastId = PORTRAIT_ATLAS_PLAYER_IDS.at(-1);
    expect(portraitSpriteMeta(`nba:${lastId}`, `./player-portraits/nba-${lastId}.png`)?.source)
      .toBe("./player-portraits/nba-atlas-025.jpg");
  });

  it("keeps procedural or unavailable portraits on the no-image fallback", () => {
    expect(portraitSpriteStyle("rookie:1", null)).toBeNull();
    expect(portraitSpriteStyle("nba:999999", "./player-portraits/nba-999999.png")).toBeNull();
  });

  it("maps Max Christie to his bundled portrait atlas tile", () => {
    expect(portraitSpriteMeta("nba:1631108", "./player-portraits/nba-1631108.png")).toMatchObject({
      index: 322,
      source: "./player-portraits/nba-atlas-012.jpg",
    });
  });
});
