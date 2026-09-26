import { TEAM_DEFINITIONS } from "./league";
import { CURRENT_NBA_ROSTER, CURRENT_NBA_ROSTER_BY_ID } from "./currentNbaRoster";
import { createFictionalPlayerProfile } from "./playerProfiles";
import { openingNbaServiceYears } from "./nbaServiceYears";
import { findNbaProjectionForHupu, NBA_PLAYER_DATASET, type NbaPlayerProjection } from "./nbaPlayerDataset";
import { salaryContractFor } from "./nbaSalaryContracts";
import { NBA_SUPPLEMENTAL_PLAYER_PROJECTIONS } from "./nbaSupplementalPlayers";
import { NBA_FREE_AGENT_PROJECTIONS } from "./nbaFreeAgentProjections";
import { NBA_2026_FREE_AGENTS, NBA_TEAM_ID_TO_GAME_TEAM_ID } from "./nbaFreeAgents";
import { REAL_2026_CLASS_ROSTER_EXCLUSIONS, REAL_2026_DRAFT } from "./real2026Draft";
import { stableHash } from "../game/random/hash";
import { createExpansionCareer } from "../game/season/career";
import { calculatePlayerOverall } from "../game/player/PlayerRatingService";
import { emptyPlayerSeasonStats, type GameState, type Player, type PlayerAttributes, type Position, type RotationRole, type TeamRole } from "../game/state/types";
import { LEAGUE_FINANCE_CONFIG } from "../config/leagueFinance";

export interface HupuRosterPlayer {
  playerId?: string;
  player_name?: string;
  player_name_en?: string;
  en_name?: string;
  number?: string;
  position?: string;
  salary?: string;
  salary_str?: string;
  is_injured?: number;
  min?: string;
  pts?: string;
  reb?: string;
  asts?: string;
  fgp?: string;
  tpp?: string;
  stl?: string;
  to?: string;
  blk?: string;
}

export interface HupuSalaryPlayer {
  playerName?: string;
  playerId?: string;
  age?: string;
  seasonSalaryInfos?: Array<{
    restrictedType?: string | null;
    salaryOption?: string | null;
    seasonSalary?: string;
  }>;
}

export interface HupuTeamSnapshot {
  internalTeamId: string;
  sourceTeamId: string;
  teamName: string;
  players: HupuRosterPlayer[];
  salaries: HupuSalaryPlayer[];
  updatedAt?: string;
}

const clampRating = (value: number): number => Math.max(25, Math.min(99, Math.round(value)));

function numberFrom(value?: string | null): number {
  if (!value) return 0;
  const parsed = Number(value.replace(/[^0-9.\-]/gu, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function salaryFromHupu(value?: string | null): number {
  if (!value || value === "-" || value === "—") return 0;
  const amount = numberFrom(value);
  if (value.includes("亿")) return Math.round(amount * 100_000_000);
  if (value.includes("万")) return Math.round(amount > 100_000 ? amount : amount * 10_000);
  return Math.round(amount > 100_000 ? amount : amount * 10_000);
}

function primaryPosition(raw: HupuRosterPlayer): Position {
  const text = (raw.position ?? "").toLowerCase();
  if (text.includes("控球") || text.includes("组织") || /(^|[^a-z])pg([^a-z]|$)/u.test(text)) return "PG";
  if (text.includes("得分后卫") || /(^|[^a-z])sg([^a-z]|$)/u.test(text)) return "SG";
  if (text.includes("小前锋") || /(^|[^a-z])sf([^a-z]|$)/u.test(text)) return "SF";
  if (text.includes("大前锋") || /(^|[^a-z])pf([^a-z]|$)/u.test(text)) return "PF";
  if (text.includes("中锋") || /(^|[^a-z])c([^a-z]|$)/u.test(text)) return "C";
  if (text.includes("后卫")) return numberFrom(raw.asts) >= 4 ? "PG" : "SG";
  if (text.includes("前锋")) return numberFrom(raw.reb) >= 6 ? "PF" : "SF";
  return numberFrom(raw.blk) >= 1 || numberFrom(raw.reb) >= 7 ? "C" : "SF";
}

function attributesFromStats(raw: HupuRosterPlayer, position: Position): PlayerAttributes {
  const minutes = numberFrom(raw.min);
  const points = numberFrom(raw.pts);
  const rebounds = numberFrom(raw.reb);
  const assists = numberFrom(raw.asts);
  const steals = numberFrom(raw.stl);
  const blocks = numberFrom(raw.blk);
  const turnovers = numberFrom(raw.to);
  const fieldGoal = numberFrom(raw.fgp);
  const threePoint = numberFrom(raw.tpp);
  const guard = position === "PG" || position === "SG";
  const big = position === "PF" || position === "C";
  return {
    shooting: clampRating(43 + threePoint * 0.65 + points * 0.7),
    finishing: clampRating(42 + fieldGoal * 0.72 + points * 0.65 + (big ? 5 : 0)),
    playmaking: clampRating(44 + assists * 5.4 - turnovers * 1.4 + (position === "PG" ? 6 : 0)),
    perimeterDefense: clampRating(45 + steals * 13 + minutes * 0.35 + (guard ? 4 : 0)),
    interiorDefense: clampRating(42 + blocks * 15 + rebounds * 1.7 + (big ? 6 : -3)),
    rebounding: clampRating(42 + rebounds * 4.6 + (big ? 5 : 0)),
    athleticism: clampRating(50 + minutes * 0.65 + steals * 5 + blocks * 3),
    basketballIq: clampRating(52 + minutes * 0.55 + assists * 1.8 - turnovers * 1.5),
  };
}

function parseAge(value?: string): number | null {
  const age = numberFrom(value);
  return age >= 18 && age <= 50 ? Math.round(age) : null;
}

function contractFrom(raw: HupuRosterPlayer, salary?: HupuSalaryPlayer): Player["contract"] {
  const infos = salary?.seasonSalaryInfos?.filter((entry) => salaryFromHupu(entry.seasonSalary) > 0) ?? [];
  const currentSalary = salaryFromHupu(infos[0]?.seasonSalary) || salaryFromHupu(raw.salary_str) || salaryFromHupu(raw.salary) || 2_000_000;
  const optionLabel = infos.find((entry) => entry.salaryOption)?.salaryOption ?? "";
  const optionType = optionLabel.includes("球队") ? "TEAM" : optionLabel.includes("球员") ? "PLAYER" : "NONE";
  return {
    salary: currentSalary,
    yearsRemaining: Math.max(1, infos.length),
    guaranteedAmount: infos.reduce((total, entry) => total + salaryFromHupu(entry.seasonSalary), 0) || currentSalary,
    status: "STANDARD",
    optionType,
    optionDecision: optionType === "NONE" ? "NOT_APPLICABLE" : "PENDING",
  };
}

const ROTATION_ROLES: RotationRole[] = [
  "STARTER", "STARTER", "STARTER", "STARTER", "STARTER",
  "SIXTH_MAN", "ROTATION", "ROTATION", "ROTATION", "BENCH",
];
const TEAM_ROLES: TeamRole[] = [
  "FRANCHISE_CORE", "KEY_PLAYER", "KEY_PLAYER", "ROTATION", "ROTATION",
  "ROTATION", "ROTATION", "DEVELOPMENT", "DEVELOPMENT", "BENCH",
];

function createPlayer(careerSeed: string, teamId: string, raw: HupuRosterPlayer, salary: HupuSalaryPlayer | undefined, ordinal: number): Player {
  const id = raw.playerId as string;
  const age = parseAge(salary?.age) ?? 19 + Number.parseInt(stableHash(id, "age").slice(-2), 16) % 16;
  const teamAbbreviation = TEAM_DEFINITIONS.find((team) => team.id === teamId)?.abbreviation;
  const nbaProjection = findNbaProjectionForHupu(id, raw.player_name_en ?? raw.en_name, teamAbbreviation, raw.number);
  const position = nbaProjection?.position ?? primaryPosition(raw);
  const profile = createFictionalPlayerProfile(careerSeed, ordinal, id, position, age);
  const service = openingNbaServiceYears(id, age);
  const threePoint = numberFrom(raw.tpp);
  const points = numberFrom(raw.pts);
  const minutes = numberFrom(raw.min);
  const attributes = nbaProjection?.projection.attributes ?? attributesFromStats(raw, position);
  return {
    id,
    teamId,
    ...profile,
    serviceYears: service.years,
    serviceYearsSource: service.source,
    name: raw.player_name as string,
    age,
    ageAtSnapshot: age,
    ageSource: "SNAPSHOT_FALLBACK",
    position,
    secondaryPosition: nbaProjection?.secondaryPosition ?? (nbaProjection ? position : profile.secondaryPosition),
    profileSource: "HUPU_LIVE_ROSTER",
    heightCm: nbaProjection?.heightCm ?? profile.heightCm,
    weightKg: nbaProjection?.weightKg ?? profile.weightKg,
    portraitPath: nbaProjection?.portraitPath ?? null,
    attributes,
    overallAdjustment: nbaProjection
      ? nbaProjection.projection.overall - calculatePlayerOverall({ attributes, position })
      : undefined,
    projectionSource: nbaProjection ? "NBA_API_MODEL_V1" : "HUPU_BASIC_V1",
    projectionDataVersion: nbaProjection ? NBA_PLAYER_DATASET.datasetVersion : undefined,
    threeRate: Math.max(0.18, Math.min(0.62, threePoint > 1 ? threePoint / 100 : threePoint || 0.33)),
    usageTendency: Math.max(35, Math.min(95, Math.round(45 + points * 1.7 + minutes * 0.15))),
    health: raw.is_injured ? 75 : 100,
    morale: 50,
    fatigue: 0,
    form: 0,
    rotationRole: "BENCH",
    teamRole: "BENCH",
    available: true,
    injuryRating: raw.is_injured ? 25 : nbaProjection?.projection.durability ?? profile.injuryRating,
    contract: contractFrom(raw, salary),
    seasonStats: {
      games: 0, seconds: 0, pts: 0, fgm: 0, fga: 0, threePm: 0, threePa: 0,
      ftm: 0, fta: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0,
    },
    postseasonStats: emptyPlayerSeasonStats(),
  };
}

function projectionStat(player: NbaPlayerProjection, group: string, key: string): number {
  const value = player.stats[group]?.[key];
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function inferredThreeRate(player: NbaPlayerProjection): number {
  const shooting = player.projection.attributes.shooting;
  const finishing = player.projection.attributes.finishing;
  return Math.max(0.18, Math.min(0.62, 0.32 + (shooting - finishing) * 0.006));
}

function inferredUsage(player: NbaPlayerProjection): number {
  const { shooting, finishing, playmaking } = player.projection.attributes;
  return Math.max(35, Math.min(95, Math.round(48 + (player.projection.overall - 70) * 0.8
    + (shooting + finishing + playmaking - 195) * 0.15)));
}

function rosterIdentity(value: string): string {
  return value.normalize("NFKD").replace(/[^a-z0-9]/giu, "").toLowerCase().replace(/jr$/u, "");
}

const REAL_2026_DRAFT_NAMES = new Set(REAL_2026_DRAFT.map((entry) => rosterIdentity(entry.fullName)));

function isReal2026ClassPlayer(player: NbaPlayerProjection): boolean {
  return REAL_2026_CLASS_ROSTER_EXCLUSIONS.has(player.canonicalPlayerId)
    || REAL_2026_DRAFT_NAMES.has(rosterIdentity(player.fullName));
}

function bundledContract(player: NbaPlayerProjection, teamId: string): Player["contract"] {
  const imported = salaryContractFor(player.canonicalPlayerId);
  if (imported) {
    const salaryByYear = [...imported.salaryByYear];
    const guaranteedByYear = [...imported.guaranteedByYear];
    const optionByYear = [...imported.optionByYear];
    return {
      salary: salaryByYear[0],
      yearsRemaining: salaryByYear.length,
      guaranteedAmount: guaranteedByYear.reduce((total, value) => total + value, 0),
      status: "STANDARD",
      optionType: "NONE",
      optionDecision: "NOT_APPLICABLE",
      contractId: imported.sourceProvider
        ? `${imported.sourceProvider.toLowerCase()}-salary-2026-${imported.nbaPlayerId}`
        : `hupu-salary-2026-${imported.sourcePlayerId}`,
      contractType: "STANDARD",
      startSeason: 2026,
      endSeason: 2025 + salaryByYear.length,
      currentYearIndex: 0,
      salaryByYear,
      guaranteedByYear,
      optionByYear,
      signedTeamId: teamId,
      signedPhase: imported.sourceContractKind === "TWO_WAY" ? "DATASET_TWO_WAY_SALARY_SNAPSHOT" : "DATASET_SALARY_SNAPSHOT",
    };
  }
  const contractSeed = Number.parseInt(stableHash(player.canonicalPlayerId, "bundled_contract").slice(-4), 16);
  const salary = 1_000_000;
  const yearsRemaining = 1 + contractSeed % 4;
  return {
    salary,
    yearsRemaining,
    guaranteedAmount: salary * yearsRemaining,
    status: "STANDARD",
    // Keep unknown contract options unset until the source can be reconciled.
    optionType: "NONE",
    optionDecision: "NOT_APPLICABLE",
  };
}

function potentialGrade(value: number): NonNullable<Player["scoutedPotentialGrade"]> {
  if (value >= 94) return "S";
  if (value >= 89) return "A+";
  if (value >= 84) return "A";
  if (value >= 78) return "B+";
  if (value >= 72) return "B";
  if (value >= 64) return "C";
  return "D";
}

export function createBundledPlayer(careerSeed: string, teamId: string, projection: NbaPlayerProjection, rank: number, ordinal: number): Player {
  const age = projection.age;
  const profile = createFictionalPlayerProfile(careerSeed, ordinal, projection.canonicalPlayerId, projection.position, age);
  const service = openingNbaServiceYears(projection.canonicalPlayerId, age);
  const fieldGoalAttempts = projectionStat(projection, "base", "FGA");
  const threePointAttempts = projectionStat(projection, "base", "FG3A");
  const usage = projectionStat(projection, "advanced", "USG_PCT");
  return {
    id: projection.canonicalPlayerId,
    teamId,
    ...profile,
    serviceYears: service.years,
    serviceYearsSource: service.source,
    name: projection.fullName,
    age,
    ageAtSnapshot: age,
    ageSource: "SNAPSHOT_FALLBACK",
    heightCm: projection.heightCm ?? profile.heightCm,
    weightKg: projection.weightKg ?? profile.weightKg,
    portraitPath: projection.portraitPath ?? null,
    position: projection.position,
    secondaryPosition: projection.secondaryPosition ?? projection.position,
    profileSource: "CURATED_DATASET",
    projectionSource: "NBA_API_MODEL_V1",
    projectionDataVersion: NBA_PLAYER_DATASET.datasetVersion,
    attributes: projection.projection.attributes,
    overallAdjustment: projection.projection.overall - calculatePlayerOverall({
      attributes: projection.projection.attributes,
      position: projection.position,
    }),
    threeRate: Math.max(0.18, Math.min(0.62, fieldGoalAttempts > 0 ? threePointAttempts / fieldGoalAttempts : inferredThreeRate(projection))),
    usageTendency: usage > 0 ? Math.max(35, Math.min(95, Math.round(35 + usage * 165))) : inferredUsage(projection),
    health: 100,
    morale: 50,
    fatigue: 0,
    form: 0,
    rotationRole: ROTATION_ROLES[Math.min(rank, ROTATION_ROLES.length - 1)],
    teamRole: TEAM_ROLES[Math.min(rank, TEAM_ROLES.length - 1)],
    available: true,
    injuryRating: projection.projection.durability,
    truePotential: projection.projection.potential,
    scoutedPotentialGrade: potentialGrade(projection.projection.potential),
    scoutingConfidence: 100,
    contract: bundledContract(projection, teamId),
    seasonStats: emptyPlayerSeasonStats(),
    postseasonStats: emptyPlayerSeasonStats(),
  };
}

/**
 * Creates the default career entirely from the dataset embedded in the bundle.
 * Both file:// previews and the Hupu upload use this exact path so the visible
 * teams, players and ratings cannot drift between environments.
 */
export function createExpansionCareerFromBundledDataset(careerSeed: string): GameState {
  const state = createExpansionCareer(careerSeed);
  const existingTeams = TEAM_DEFINITIONS.filter((team) => team.sourceTeamId);
  const byAbbreviation = new Map<string, NbaPlayerProjection[]>();
  const bundledProjections = [...NBA_PLAYER_DATASET.players, ...NBA_SUPPLEMENTAL_PLAYER_PROJECTIONS];
  const bundledPlayerIds = new Set(bundledProjections.map((player) => player.canonicalPlayerId));
  const bundledNames = new Set(bundledProjections.map((player) => rosterIdentity(player.fullName)));
  for (const [playerId, player] of Object.entries(state.players)) {
    if (!bundledPlayerIds.has(playerId) && !bundledNames.has(rosterIdentity(player.name))) continue;
    delete state.players[playerId];
    for (const team of Object.values(state.teams)) team.playerIds = team.playerIds.filter((id) => id !== playerId);
  }
  for (const player of bundledProjections) {
    // The 2026 class belongs to the in-game rookie draft pool at opening. Even
    // when the salary workbook already has a real-world contract, do not place
    // the prospect on an NBA roster before the game's draft signs them.
    if (isReal2026ClassPlayer(player)) continue;
    const currentRosterPlayer = CURRENT_NBA_ROSTER_BY_ID.get(player.nbaPlayerId);
    const abbreviation = currentRosterPlayer?.teamAbbreviation;
    if (!abbreviation) continue;
    const roster = byAbbreviation.get(abbreviation) ?? [];
    roster.push(player);
    byAbbreviation.set(abbreviation, roster);
  }

  let ordinal = 0;
  for (const team of existingTeams) {
    for (const playerId of state.teams[team.id].playerIds) delete state.players[playerId];
    const projections = [...new Map((byAbbreviation.get(team.id) ?? []).map((projection) => [projection.canonicalPlayerId, projection] as const)).values()]
      .sort((left, right) => {
        const contractPriority = Number(Boolean(salaryContractFor(right.canonicalPlayerId))) - Number(Boolean(salaryContractFor(left.canonicalPlayerId)));
        return contractPriority || right.projection.overall - left.projection.overall || left.canonicalPlayerId.localeCompare(right.canonicalPlayerId);
      })
      .slice(0, LEAGUE_FINANCE_CONFIG.rosterLimits.offseasonMaximum);
    if (projections.length < 9) throw new Error(`${team.fullName}的离线阵容评分球员不足 9 人`);
    state.teams[team.id].playerIds = projections.map((projection, rank) => {
      const player = createBundledPlayer(careerSeed, team.id, projection, rank, ordinal);
      ordinal += 1;
      state.players[player.id] = player;
      return player.id;
    });
  }

  const freeAgentSnapshotById = new Map(NBA_2026_FREE_AGENTS.players.map((player) => [player.nbaPlayerId, player] as const));
  for (const projection of NBA_FREE_AGENT_PROJECTIONS) {
    const player = createBundledPlayer(careerSeed, "FREE_AGENT", projection, 21, ordinal);
    ordinal += 1;
    player.rotationRole = "OUT";
    player.teamRole = "BENCH";
    player.contract = {
      salary: 0, yearsRemaining: 0, guaranteedAmount: 0,
      status: freeAgentSnapshotById.get(projection.nbaPlayerId)?.status ?? "UFA",
      optionType: "NONE", optionDecision: "NOT_APPLICABLE",
    };
    if (player.contract.status === "RFA") {
      const previousNbaTeamId = freeAgentSnapshotById.get(projection.nbaPlayerId)?.previousNbaTeamId;
      player.birdTeamId = previousNbaTeamId ? NBA_TEAM_ID_TO_GAME_TEAM_ID[previousNbaTeamId] ?? null : null;
      player.contract.qualifyingOfferDecision = "PENDING";
    }
    if (state.players[player.id]) throw new Error(`Duplicate initial free agent ${player.id}`);
    state.players[player.id] = player;
  }

  state.meta.dataVersion = `bundled.${NBA_PLAYER_DATASET.datasetVersion}+${CURRENT_NBA_ROSTER.rosterVersion}+fa.${NBA_2026_FREE_AGENTS.retrievedAt.slice(0, 10)}+salary.2026-27.0926.v3+retired.2026-09-24+service.2026.v2`;
  state.meta.gameVersion = "0.5.0";
  return state;
}

export function createExpansionCareerFromHupu(careerSeed: string, snapshots: HupuTeamSnapshot[]): GameState {
  const state = createExpansionCareer(careerSeed);
  const byTeam = new Map(snapshots.map((snapshot) => [snapshot.internalTeamId, snapshot]));
  const existingTeams = TEAM_DEFINITIONS.filter((team) => team.sourceTeamId);
  if (byTeam.size !== existingTeams.length) throw new Error(`虎扑阵容数据不完整：仅收到 ${byTeam.size}/${existingTeams.length} 支球队`);

  for (const team of existingTeams) {
    for (const playerId of state.teams[team.id].playerIds) delete state.players[playerId];
    state.teams[team.id].playerIds = [];
  }

  const seenPlayerIds = new Set<string>();
  let ordinal = 0;
  for (const team of existingTeams) {
    const snapshot = byTeam.get(team.id) as HupuTeamSnapshot;
    const salaryById = new Map(snapshot.salaries.filter((entry) => entry.playerId).map((entry) => [entry.playerId as string, entry]));
    const roster = snapshot.players.filter((entry) => entry.playerId && entry.player_name && !seenPlayerIds.has(entry.playerId));
    const created = roster.map((raw) => {
      seenPlayerIds.add(raw.playerId as string);
      const player = createPlayer(careerSeed, team.id, raw, salaryById.get(raw.playerId as string), ordinal);
      ordinal += 1;
      return player;
    }).sort((left, right) => calculatePlayerOverall(right) - calculatePlayerOverall(left) || left.id.localeCompare(right.id));
    if (created.length < 9) throw new Error(`${state.teams[team.id].fullName}仅返回 ${created.length} 名有效球员，无法生成扩军保护名单`);
    created.forEach((player, rank) => {
      player.rotationRole = ROTATION_ROLES[Math.min(rank, ROTATION_ROLES.length - 1)];
      player.teamRole = TEAM_ROLES[Math.min(rank, TEAM_ROLES.length - 1)];
      state.players[player.id] = player;
      state.teams[team.id].playerIds.push(player.id);
    });
  }

  if (seenPlayerIds.size < 270) throw new Error(`虎扑全联盟仅返回 ${seenPlayerIds.size} 名有效球员，请稍后重试`);
  const freshestUpdate = snapshots.map((snapshot) => snapshot.updatedAt).filter(Boolean).sort().at(-1) ?? "live";
  state.meta.dataVersion = `hupu.nba.live-roster.${freshestUpdate}+${NBA_PLAYER_DATASET.datasetVersion}+service.2026.v2`;
  state.meta.gameVersion = "0.5.0";
  return state;
}
