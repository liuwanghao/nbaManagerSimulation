import { describe, expect, it } from "vitest";
import { PORTRAIT_ATLAS_PLAYER_IDS } from "../data/portraitAtlasIds";
import { portraitSpriteStyle } from "./portraitSprite";

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

  it("keeps procedural or unavailable portraits on the no-image fallback", () => {
    expect(portraitSpriteStyle("rookie:1", null)).toBeNull();
    expect(portraitSpriteStyle("nba:999999", "./player-portraits/nba-999999.png")).toBeNull();
  });
});
