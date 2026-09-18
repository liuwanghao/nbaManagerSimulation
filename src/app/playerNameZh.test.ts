import { describe, expect, it } from "vitest";
import { NBA_PLAYER_DATASET } from "../data/nbaPlayerDataset";
import { CURRENT_NBA_ROSTER_BY_ID } from "../data/currentNbaRoster";
import { playerNameZh } from "./playerNameZh";

describe("playerNameZh", () => {
  it("keeps verified Chinese names and never invents a pseudo-Chinese fallback", () => {
    expect(playerNameZh("张伟")).toBe("张伟");
    expect(playerNameZh("LeBron James")).toBe("勒布朗·詹姆斯");
    expect(playerNameZh("CJ McCollum")).toBe("CJ·麦科勒姆");
    expect(playerNameZh("Klay Thompson", "nba:202691")).toBe("克莱·汤普森");
    expect(playerNameZh("Example Unknownname")).toBe("Example Unknownname");
  });

  it("covers every rated player on the NBA 2026-27 current roster with a Chinese display name", () => {
    const currentRatedPlayers = NBA_PLAYER_DATASET.players.filter((player) => CURRENT_NBA_ROSTER_BY_ID.has(player.nbaPlayerId));
    expect(currentRatedPlayers.length).toBeGreaterThanOrEqual(560);
    for (const player of currentRatedPlayers) {
      const localized = playerNameZh(player.fullName, player.canonicalPlayerId);
      expect(localized, `${player.nbaPlayerId}:${player.fullName}`).toMatch(/\p{Script=Han}/u);
      expect(localized, `${player.nbaPlayerId}:${player.fullName}`).not.toMatch(/[A-Za-z]{3,}/u);
    }
  });
});
