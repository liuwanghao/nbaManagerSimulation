import { describe, expect, it } from "vitest";
import { TEAM_DEFINITIONS } from "./league";
import { createExpansionCareerFromBundledDataset, createExpansionCareerFromHupu, salaryFromHupu, type HupuTeamSnapshot } from "./hupuRoster";
import { NBA_PLAYER_DATASET } from "./nbaPlayerDataset";
import { CURRENT_NBA_ROSTER, CURRENT_NBA_ROSTER_BY_ID } from "./currentNbaRoster";
import { REAL_2026_CLASS_ROSTER_EXCLUSIONS } from "./real2026Draft";
import { calculatePlayerOverall } from "../game/player/PlayerRatingService";
import { EXPANSION_BRAND_PRESETS } from "./expansionBrands";
import { chooseRightsPackage, createExpansionTeam, resolveOptionPhase } from "../game/expansion/ExpansionService";

function mockSnapshots(): HupuTeamSnapshot[] {
  return TEAM_DEFINITIONS.filter((team) => team.sourceTeamId).map((team, teamIndex) => ({
    internalTeamId: team.id,
    sourceTeamId: team.sourceTeamId as string,
    teamName: team.fullName,
    updatedAt: "2026-09-16",
    players: Array.from({ length: 10 }, (_, playerIndex) => ({
      playerId: `hupu-${team.id}-${playerIndex}`,
      player_name: `真实球员${teamIndex + 1}-${playerIndex + 1}`,
      position: ["控球后卫", "得分后卫", "小前锋", "大前锋", "中锋"][playerIndex % 5],
      min: String(34 - playerIndex),
      pts: String(22 - playerIndex),
      reb: String(3 + playerIndex * 0.5),
      asts: String(7 - playerIndex * 0.4),
      fgp: "48%",
      tpp: "37%",
      stl: "1.2",
      blk: "0.7",
      to: "2.1",
    })),
    salaries: Array.from({ length: 10 }, (_, playerIndex) => ({
      playerId: `hupu-${team.id}-${playerIndex}`,
      playerName: `真实球员${teamIndex + 1}-${playerIndex + 1}`,
      age: `${23 + playerIndex}岁`,
      seasonSalaryInfos: [{ seasonSalary: `${800 + playerIndex * 100}万` }],
    })),
  }));
}

describe("Hupu live roster mapping", () => {
  it("creates the same complete roster from the dataset embedded in the static bundle", () => {
    const first = createExpansionCareerFromBundledDataset("static-bundle-test");
    const replay = createExpansionCareerFromBundledDataset("static-bundle-test");
    const existingTeams = TEAM_DEFINITIONS.filter((team) => team.sourceTeamId);
    const bundledPlayers = Object.values(first.players);

    expect(existingTeams.every((team) => first.teams[team.id].playerIds.length >= 9 && first.teams[team.id].playerIds.length <= 18)).toBe(true);
    expect(bundledPlayers.length).toBeGreaterThanOrEqual(430);
    expect(bundledPlayers.every((player) => player.profileSource === "CURATED_DATASET")).toBe(true);
    expect(first.meta.dataVersion).toBe(`bundled.${NBA_PLAYER_DATASET.datasetVersion}+${CURRENT_NBA_ROSTER.rosterVersion}`);
    expect(first.teams.LAL.playerIds).toEqual(replay.teams.LAL.playerIds);
    expect(first.players[first.teams.LAL.playerIds[0]].name).toBe(replay.players[replay.teams.LAL.playerIds[0]].name);
    expect([...REAL_2026_CLASS_ROSTER_EXCLUSIONS].every((playerId) => !first.players[playerId])).toBe(true);
  });

  it("uses official 2026-27 team assignments for returning rated players", () => {
    const state = createExpansionCareerFromBundledDataset("current-roster-test");
    const klay = Object.values(state.players).find((player) => player.name === "Klay Thompson");
    const cj = Object.values(state.players).find((player) => player.name === "CJ McCollum");
    expect(CURRENT_NBA_ROSTER_BY_ID.get("202691")?.teamAbbreviation).toBe("MIA");
    expect(CURRENT_NBA_ROSTER_BY_ID.get("203468")?.teamAbbreviation).toBe("ATL");
    expect(klay?.teamId).toBe("MIA");
    expect(cj?.teamId).toBe("ATL");
    expect(CURRENT_NBA_ROSTER.players).toHaveLength(597);
  });

  it("does not invent contract options that release signed snapshot players", () => {
    const preset = EXPANSION_BRAND_PRESETS.SEA[0];
    let state = createExpansionCareerFromBundledDataset("signed-roster-contract-test");
    const reaves = state.players["nba:1630559"];
    expect(reaves?.name).toBe("Austin Reaves");
    expect(reaves?.teamId).toBe("LAL");
    expect(reaves?.contract.optionType).toBe("NONE");
    expect(reaves?.contract.yearsRemaining).toBe(4);
    expect(reaves?.contract.guaranteedAmount).toBe(185_000_000);
    state = createExpansionTeam(state, {
      cityId: "SEA",
      presetId: preset.presetId,
      teamName: preset.teamName,
      primaryColor: preset.primaryColor,
      secondaryColor: preset.secondaryColor,
    });
    state = chooseRightsPackage(state, "A");
    state = resolveOptionPhase(state);
    expect(state.players[reaves.id].contract.status).toBe("STANDARD");
    expect(state.players[reaves.id].teamId).toBe("LAL");
    expect(state.teams.LAL.playerIds).toContain(reaves.id);
  });

  it("carries the production-calibrated OVR into the playable roster", () => {
    const state = createExpansionCareerFromBundledDataset("current-rating-test");
    const brunson = Object.values(state.players).find((player) => player.name === "Jalen Brunson");
    expect(brunson?.teamId).toBe("NYK");
    expect(brunson && calculatePlayerOverall(brunson)).toBe(96);
  });

  it("parses localized salary values into dollars", () => {
    expect(salaryFromHupu("4639万")).toBe(46_390_000);
    expect(salaryFromHupu("1.2亿")).toBe(120_000_000);
    expect(salaryFromHupu("2000000")).toBe(2_000_000);
  });

  it("replaces fixture rosters with real Hupu identities while retaining a playable engine model", () => {
    const state = createExpansionCareerFromHupu("hupu-roster-test", mockSnapshots());
    const players = Object.values(state.players);
    expect(players).toHaveLength(300);
    expect(players.every((player) => player.profileSource === "HUPU_LIVE_ROSTER")).toBe(true);
    expect(players.every((player) => player.name.startsWith("真实球员"))).toBe(true);
    expect(state.teams.SEA.playerIds).toHaveLength(0);
    expect(state.teams.LVG.playerIds).toHaveLength(0);
    expect(state.teams.ATL.playerIds).toHaveLength(10);
    expect(state.meta.dataVersion).toContain("hupu.nba.live-roster");
  });

  it("uses the nba_api model only when an explicit English identity matches", () => {
    const snapshots = mockSnapshots();
    const projection = NBA_PLAYER_DATASET.players[0];
    snapshots[0].players[0].player_name_en = projection.fullName;
    const state = createExpansionCareerFromHupu("hupu-nba-projection", snapshots);
    const player = state.players[snapshots[0].players[0].playerId as string];
    expect(player.projectionSource).toBe("NBA_API_MODEL_V1");
    expect(player.attributes).toEqual(projection.projection.attributes);
    expect(player.projectionDataVersion).toBe(NBA_PLAYER_DATASET.datasetVersion);
  });

  it("matches a current player by team and unique jersey number without guessing the Chinese name", () => {
    const snapshots = mockSnapshots();
    const projection = NBA_PLAYER_DATASET.players.find((candidate) => candidate.jerseyNumber
      && TEAM_DEFINITIONS.some((team) => team.abbreviation === candidate.teamAbbreviation));
    expect(projection).toBeDefined();
    if (!projection) throw new Error("No jersey-mapped NBA projection");
    const team = TEAM_DEFINITIONS.find((candidate) => candidate.abbreviation === projection.teamAbbreviation);
    const snapshot = snapshots.find((candidate) => candidate.internalTeamId === team?.id);
    if (!snapshot) throw new Error("No matching Hupu team fixture");
    snapshot.players[0].number = projection.jerseyNumber as string;
    const state = createExpansionCareerFromHupu("hupu-nba-jersey", snapshots);
    const player = state.players[snapshot.players[0].playerId as string];
    expect(player.projectionSource).toBe("NBA_API_MODEL_V1");
    expect(player.attributes).toEqual(projection.projection.attributes);
  });
});
