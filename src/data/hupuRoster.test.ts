import { describe, expect, it } from "vitest";
import { TEAM_DEFINITIONS } from "./league";
import { createExpansionCareerFromBundledDataset, createExpansionCareerFromHupu, salaryFromHupu, type HupuTeamSnapshot } from "./hupuRoster";
import { NBA_PLAYER_DATASET } from "./nbaPlayerDataset";
import { NBA_2026_27_SALARY_CONTRACTS, NBA_2026_27_SALARY_SUPPLEMENT, salaryContractFor } from "./nbaSalaryContracts";
import { NBA_SUPPLEMENTAL_PLAYER_PROJECTIONS } from "./nbaSupplementalPlayers";
import { NBA_2026_FREE_AGENTS } from "./nbaFreeAgents";
import { NBA_FREE_AGENT_PROJECTIONS } from "./nbaFreeAgentProjections";
import { CURRENT_NBA_ROSTER, CURRENT_NBA_ROSTER_BY_ID } from "./currentNbaRoster";
import { REAL_2026_CLASS_ROSTER_EXCLUSIONS } from "./real2026Draft";
import { calculatePlayerOverall } from "../game/player/PlayerRatingService";
import { EXPANSION_BRAND_PRESETS } from "./expansionBrands";
import { chooseRightsPackage, createExpansionTeam, resolveOptionPhase } from "../game/expansion/ExpansionService";
import { LEAGUE_FINANCE_CONFIG } from "../config/leagueFinance";

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
  it("uses verified NBA experience for every real opening player", () => {
    const state = createExpansionCareerFromBundledDataset("service-years-audit");
    const players = Object.values(state.players).filter((player) => player.id.startsWith("nba:"));
    expect(players).toHaveLength(569);
    expect(players.every((player) => player.serviceYearsSource === "NBA_OFFICIAL_PROFILE"
      || player.serviceYearsSource === "DOCUMENTED_DEBUT")).toBe(true);
    expect(state.players["nba:1630166"]).toMatchObject({ serviceYears: 6, serviceYearsSource: "NBA_OFFICIAL_PROFILE" });
    expect(state.players["nba:1642258"]).toMatchObject({ serviceYears: 2, serviceYearsSource: "NBA_OFFICIAL_PROFILE" });
    expect(state.players["nba:1631131"]).toMatchObject({ serviceYears: 3, serviceYearsSource: "NBA_OFFICIAL_PROFILE" });
    expect(state.players["nba:201145"]).toMatchObject({ serviceYears: 19, serviceYearsSource: "NBA_OFFICIAL_PROFILE" });
  });

  it("creates the same complete roster from the dataset embedded in the static bundle", () => {
    const first = createExpansionCareerFromBundledDataset("static-bundle-test");
    const replay = createExpansionCareerFromBundledDataset("static-bundle-test");
    const existingTeams = TEAM_DEFINITIONS.filter((team) => team.sourceTeamId);
    const bundledPlayers = Object.values(first.players);

    expect(existingTeams.every((team) => first.teams[team.id].playerIds.length >= 9
      && first.teams[team.id].playerIds.length <= LEAGUE_FINANCE_CONFIG.rosterLimits.offseasonMaximum)).toBe(true);
    expect(Math.max(...existingTeams.map((team) => first.teams[team.id].playerIds.length)))
      .toBe(LEAGUE_FINANCE_CONFIG.rosterLimits.offseasonMaximum);
    expect(bundledPlayers.length).toBeGreaterThanOrEqual(430);
    expect(bundledPlayers.every((player) => player.profileSource === "CURATED_DATASET")).toBe(true);
    expect(first.meta.dataVersion).toBe(`bundled.${NBA_PLAYER_DATASET.datasetVersion}+${CURRENT_NBA_ROSTER.rosterVersion}+fa.${NBA_2026_FREE_AGENTS.retrievedAt.slice(0, 10)}+salary.2026-27.0926.v3+retired.2026-09-24+service.2026.v2`);
    expect(first.teams.LAL.playerIds).toEqual(replay.teams.LAL.playerIds);
    expect(first.players[first.teams.LAL.playerIds[0]].name).toBe(replay.players[replay.teams.LAL.playerIds[0]].name);
    expect([...REAL_2026_CLASS_ROSTER_EXCLUSIONS].every((playerId) => !first.players[playerId])).toBe(true);
  });

  it("keeps the official roster and current free-agent pool separate", () => {
    const state = createExpansionCareerFromBundledDataset("offline-free-agent-test");
    const players = Object.values(state.players).filter((player) => player.teamId === "FREE_AGENT");
    expect(NBA_2026_FREE_AGENTS.players).toHaveLength(54);
    expect(players).toHaveLength(54);
    expect(state.players["nba:201566"]).toBeUndefined();
    expect(state.players["nba:201587"]).toBeUndefined();
    expect(players.every((player) => ["UFA", "RFA"].includes(player.contract.status))).toBe(true);
    expect(players.filter((player) => player.contract.status === "RFA")
      .every((player) => player.birdTeamId && state.teams[player.birdTeamId]
        && player.contract.qualifyingOfferDecision === "PENDING")).toBe(true);
    expect(state.players["nba:1631105"]).toMatchObject({
      name: "Jalen Duren", teamId: "FREE_AGENT", birdTeamId: "DET",
      contract: { status: "RFA", qualifyingOfferDecision: "PENDING" },
    });
    expect(players.every((player) => !CURRENT_NBA_ROSTER_BY_ID.has(player.id.replace(/^nba:/u, "")))).toBe(true);
    expect(NBA_FREE_AGENT_PROJECTIONS.every((player) => player.projection.qualityFlags.includes("BIRTHDATE_VERIFIED"))).toBe(true);
    expect(state.players["nba:1642926"]).toMatchObject({ name: "Tamar Bates", teamId: "UTA" });
  });

  it("uses official 2026-27 team assignments for returning rated players", () => {
    const state = createExpansionCareerFromBundledDataset("current-roster-test");
    const klay = Object.values(state.players).find((player) => player.name === "Klay Thompson");
    const cj = Object.values(state.players).find((player) => player.name === "CJ McCollum");
    expect(CURRENT_NBA_ROSTER_BY_ID.get("202691")?.teamAbbreviation).toBe("MIA");
    expect(CURRENT_NBA_ROSTER_BY_ID.get("203468")?.teamAbbreviation).toBe("ATL");
    expect(klay?.teamId).toBe("MIA");
    expect(cj?.teamId).toBe("ATL");
    expect(CURRENT_NBA_ROSTER.players).toHaveLength(577);
    expect(state.players["nba:1629723"]?.teamId).toBe("NYK");
    expect(state.players["nba:1631207"]?.teamId).toBe("GSW");
    expect(state.players["nba:1641763"]?.teamId).toBe("HOU");
    expect(state.players["nba:1629723"]?.contract.salaryByYear).toEqual([6_170_000]);
    expect(state.players["nba:1631207"]?.contract.salaryByYear).toEqual([2_630_000]);
    expect(state.players["nba:1641763"]?.contract.salaryByYear).toEqual([2_410_000]);
  });

  it("excludes retired rows while promoting official current-roster assignments", () => {
    const state = createExpansionCareerFromBundledDataset("historical-row-eligibility-test");
    expect(Object.values(state.players).some((player) => player.name === "Chris Paul")).toBe(false);
    expect(CURRENT_NBA_ROSTER_BY_ID.get("1641715")?.teamAbbreviation).toBe("DEN");
    expect(state.players["nba:1641715"]).toMatchObject({
      teamId: "DEN",
      name: "Cam Whitmore",
      position: "SF",
      secondaryPosition: "PF",
    });
  });

  it("uses the NBA 2K single position for Myles Turner", () => {
    const state = createExpansionCareerFromBundledDataset("myles-turner-position-test");
    expect(state.players["nba:1626167"]).toMatchObject({
      teamId: "MIL",
      name: "Myles Turner",
      position: "C",
      secondaryPosition: "C",
    });
  });

  it("uses the imported local salary snapshot without inventing contract options", () => {
    const preset = EXPANSION_BRAND_PRESETS.SEA[0];
    let state = createExpansionCareerFromBundledDataset("signed-roster-contract-test");
    const reaves = state.players["nba:1630559"];
    expect(reaves?.name).toBe("Austin Reaves");
    expect(reaves?.teamId).toBe("LAL");
    expect(reaves?.contract.optionType).toBe("NONE");
    expect(reaves?.contract.salaryByYear).toEqual([41_240_000, 42_950_000, 46_250_000, 49_550_000]);
    expect(reaves?.contract.optionByYear).toEqual(["NONE", "NONE", "NONE", "NONE"]);
    expect(reaves?.contract.guaranteedAmount).toBe(179_990_000);
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

  it("loads a validated, versioned local 2026-27 contract snapshot", () => {
    expect(NBA_2026_27_SALARY_CONTRACTS.contracts).toHaveLength(485);
    expect(salaryContractFor("nba:1642461")?.salaryByYear).toEqual([6_000_000, 5_750_000]);
    expect(salaryContractFor("nba:1641705")?.salaryByYear).toEqual([
      16_870_000, 43_500_000, 46_980_000, 50_460_000, 53_940_000, 57_420_000,
    ]);
    expect(salaryContractFor("nba:1641705")?.optionByYear.at(-1)).toBe("PLAYER_OPTION");
    expect(NBA_2026_27_SALARY_CONTRACTS.unmatchedSourcePlayers).toEqual([
      expect.objectContaining({ sourcePlayerName: "琼斯", reason: "duplicate_target" }),
    ]);
  });

  it("uses verified supplemental salary figures while retaining their source and option years", () => {
    expect(NBA_2026_27_SALARY_SUPPLEMENT.contracts).toHaveLength(59);
    expect(salaryContractFor("nba:1642352")).toMatchObject({
      sourceContractKind: "TWO_WAY",
      salaryByYear: [678_882],
      guaranteedByYear: [0],
      sourcePath: expect.stringContaining("miami-heat"),
    });
    expect(salaryContractFor("nba:1631128")?.salaryByYear).toEqual([
      21_551_726, 23_275_863, 25_000_000, 26_724_137,
    ]);
    expect(salaryContractFor("nba:1628436")?.optionByYear).toEqual(["NONE", "NONE", "TEAM_OPTION"]);
    expect(salaryContractFor("nba:201949")).toBeUndefined();
    expect(salaryContractFor("nba:1630264")).toMatchObject({
      sourceProvider: "SALARYSWISH",
      salaryByYear: [3_066_143],
      guaranteedByYear: [3_066_143],
    });
    expect(salaryContractFor("nba:1642914")).toMatchObject({
      sourceContractKind: "TWO_WAY",
      salaryByYear: [680_985],
      guaranteedByYear: [83_500],
    });

    const state = createExpansionCareerFromBundledDataset("supplemental-salary-test");
    expect(state.players["nba:1642352"].contract).toMatchObject({
      salary: 678_882,
      yearsRemaining: 1,
      contractId: "hoopshype-salary-2026-1642352",
    });
    expect(Object.values(state.players).filter((player) => player.contract.contractId?.startsWith("hoopshype-salary-2026-"))).toHaveLength(55);
    expect(Object.values(state.players).filter((player) => player.contract.contractId?.startsWith("salaryswish-salary-2026-"))).toHaveLength(4);
    const unmatchedRosterPlayers = Object.values(state.players).filter((player) => player.teamId !== "FREE_AGENT"
      && player.profileSource === "CURATED_DATASET" && !salaryContractFor(player.id));
    expect(unmatchedRosterPlayers).toHaveLength(26);
    expect(unmatchedRosterPlayers.every((player) => player.contract.salary === 1_000_000)).toBe(true);
  });

  it("keeps the user-corrected Morez Johnson identity in Dallas with his imported contract", () => {
    const state = createExpansionCareerFromBundledDataset("morez-johnson-contract-test");
    const morez = state.players["nba:1643516"];
    expect(morez).toBeUndefined();
  });

  it("keeps 2026 draft prospects out of the opening roster", () => {
    const state = createExpansionCareerFromBundledDataset("corrected-young-players-contract-test");
    expect(state.players["nba:1643576"]).toBeUndefined();
    expect(state.players["nba:1643509"]).toBeUndefined();
  });

  it("does not retain supplemental players absent from the authoritative roster", () => {
    const state = createExpansionCareerFromBundledDataset("supplemental-2k-contract-test");
    expect(state.players["nba:1643590"]).toBeUndefined();
    expect(state.players["nba:1642926"]).toMatchObject({ teamId: "UTA", name: "Tamar Bates" });
    expect(state.players["nba:1643555"]).toBeUndefined();
    expect(state.players["nba:1642889"]).toBeUndefined();
    expect(state.players["nba:1642910"]).toMatchObject({ teamId: "POR", name: "John Tonje" });
    expect(state.players["nba:1642857"]).toMatchObject({ teamId: "MIL", name: "Kasparas Jakučionis" });
    expect(NBA_SUPPLEMENTAL_PLAYER_PROJECTIONS).toHaveLength(0);
    expect(NBA_PLAYER_DATASET.players.some((player) => player.nbaPlayerId === "201959")).toBe(false);
    expect(salaryContractFor("nba:201959")).toBeUndefined();
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
