import { describe, expect, it } from "vitest";
import { NBA_PLAYER_DATASET } from "../data/nbaPlayerDataset";
import { CURRENT_NBA_ROSTER_BY_ID } from "../data/currentNbaRoster";
import { REAL_2026_DRAFT } from "../data/real2026Draft";
import { fictionalNameAt } from "../data/playerProfiles";
import { createCareer } from "../game/season/career";
import { localizePlayerNamesInText, playerNameZh, playerSurnameZh } from "./playerNameZh";

describe("playerNameZh", () => {
  it("shows only the surname in compact draft picks", () => {
    expect(playerSurnameZh("Darryn Peterson")).toBe("彼得森");
    expect(playerSurnameZh("杨瀚森")).toBe("杨");
    expect(playerSurnameZh("Nene")).toBe("内内");
    expect(playerSurnameZh("Example Unknownname")).toBe("Unknownname");
  });
  it("keeps verified Chinese names and never invents a pseudo-Chinese fallback", () => {
    expect(playerNameZh("张伟")).toBe("张伟");
    expect(playerNameZh("LeBron James")).toBe("勒布朗·詹姆斯");
    expect(playerNameZh("CJ McCollum")).toBe("CJ·麦科勒姆");
    expect(playerNameZh("Klay Thompson", "nba:202691")).toBe("克莱·汤普森");
    expect(playerNameZh("Example Unknownname")).toBe("Example Unknownname");
  });

  it("keeps a readable name for every current player without fabricating unverified translations", () => {
    const currentRatedPlayers = NBA_PLAYER_DATASET.players.filter((player) => CURRENT_NBA_ROSTER_BY_ID.has(player.nbaPlayerId));
    expect(currentRatedPlayers.length).toBeGreaterThanOrEqual(560);
    let localizedCount = 0;
    for (const player of currentRatedPlayers) {
      const localized = playerNameZh(player.fullName, player.canonicalPlayerId);
      expect(localized.trim(), `${player.nbaPlayerId}:${player.fullName}`).not.toBe("");
      expect(localized, `${player.nbaPlayerId}:${player.fullName}`).not.toContain("\uFFFD");
      if (/\p{Script=Han}/u.test(localized)) localizedCount += 1;
      else expect(localized, `${player.nbaPlayerId}:${player.fullName}`).toBe(player.fullName);
    }
    expect(localizedCount).toBeGreaterThan(500);
  });

  it("shows Chinese names for every bundled player and generated name combination", () => {
    const names = [
      ...NBA_PLAYER_DATASET.players.map((player) => [player.fullName, player.canonicalPlayerId] as const),
      ...NBA_PLAYER_DATASET.historicalTemplates.map((player) => [player.sourceName, undefined] as const),
      ...REAL_2026_DRAFT.map((player) => [player.fullName, player.playerId] as const),
      ...Array.from({ length: 48 * 48 }, (_, ordinal) => [fictionalNameAt("localization-audit", ordinal), undefined] as const),
    ];
    for (const [name, id] of names) {
      expect(playerNameZh(name, id), name).toMatch(/\p{Script=Han}/u);
    }
  });

  it("localizes player names embedded in event and transaction text", () => {
    const state = createCareer("localized-event-copy");
    const players = Object.values(state.players);
    const player = players.find((candidate) => /[A-Za-z]/u.test(candidate.name));
    if (!player) throw new Error("Expected an English source player name");
    const source = `${player.name}受伤；${player.name}的轮换已调整。`;
    const localized = `${playerNameZh(player.name, player.id)}受伤；${playerNameZh(player.name, player.id)}的轮换已调整。`;
    expect(localizePlayerNamesInText(source, players)).toBe(localized);
    expect(player.name).not.toBe(playerNameZh(player.name, player.id));
  });
});
