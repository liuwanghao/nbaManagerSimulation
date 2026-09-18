import { TEAM_DEFINITIONS } from "./league";
import { CURRENT_NBA_ROSTER, CURRENT_NBA_ROSTER_BY_ID } from "./currentNbaRoster";
import { createFictionalPlayerProfile } from "./playerProfiles";
import { findNbaProjectionForHupu, NBA_PLAYER_DATASET, type NbaPlayerProjection } from "./nbaPlayerDataset";
import { REAL_2026_CLASS_ROSTER_EXCLUSIONS } from "./real2026Draft";
import { stableHash } from "../game/random/hash";
import { createExpansionCareer } from "../game/season/career";
import { calculatePlayerOverall } from "../game/player/PlayerRatingService";
import { emptyPlayerSeasonStats, type GameState, type Player, type PlayerAttributes, type Position, type RotationRole, type TeamRole } from "../game/state/types";
import {
  requestTeamPlayers,
  requestTeamSalaryInfo,
  type HupuRosterPlayer,
  type HupuSalaryPlayer,
} from "../platform/hupuBasketball";

const LOAD_BATCH_SIZE = 15;
const REQUEST_WINDOW_PAUSE_MS = 5_200;

export interface HupuTeamSnapshot {
  internalTeamId: string;
  sourceTeamId: string;
  teamName: string;
  players: HupuRosterPlayer[];
  salaries: HupuSalaryPlayer[];
  updatedAt?: string;
}

export interface HupuRosterProgress {
  loadedTeams: number;
  totalTeams: number;
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
  const position = primaryPosition(raw);
  const age = parseAge(salary?.age) ?? 19 + Number.parseInt(stableHash(id, "age").slice(-2), 16) % 16;
  const profile = createFictionalPlayerProfile(careerSeed, ordinal, id, position, age);
  const teamAbbreviation = TEAM_DEFINITIONS.find((team) => team.id === teamId)?.abbreviation;
  const nbaProjection = findNbaProjectionForHupu(id, raw.player_name_en ?? raw.en_name, teamAbbreviation, raw.number);
  const threePoint = numberFrom(raw.tpp);
  const points = numberFrom(raw.pts);
  const minutes = numberFrom(raw.min);
  const attributes = nbaProjection?.projection.attributes ?? attributesFromStats(raw, position);
  return {
    id,
    teamId,
    ...profile,
    name: raw.player_name as string,
    age,
    ageAtSnapshot: age,
    ageSource: "SNAPSHOT_FALLBACK",
    position,
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

function bundledContract(player: NbaPlayerProjection, rank: number): Player["contract"] {
  const overall = player.projection.overall;
  const baseSalary = overall >= 90 ? 42_000_000
    : overall >= 85 ? 32_000_000
      : overall >= 80 ? 22_000_000
        : overall >= 75 ? 13_000_000
          : overall >= 70 ? 7_000_000
            : rank < 12 ? 3_500_000 : 2_000_000;
  const contractSeed = Number.parseInt(stableHash(player.canonicalPlayerId, "bundled_contract").slice(-4), 16);
  const yearsRemaining = 1 + contractSeed % 4;
  const optionRoll = contractSeed % 12;
  const optionType = optionRoll === 0 ? "TEAM" : optionRoll === 1 ? "PLAYER" : "NONE";
  return {
    salary: baseSalary,
    yearsRemaining,
    guaranteedAmount: baseSalary * yearsRemaining,
    status: "STANDARD",
    optionType,
    optionDecision: optionType === "NONE" ? "NOT_APPLICABLE" : "PENDING",
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
  const fieldGoalAttempts = projectionStat(projection, "base", "FGA");
  const threePointAttempts = projectionStat(projection, "base", "FG3A");
  const usage = projectionStat(projection, "advanced", "USG_PCT");
  return {
    id: projection.canonicalPlayerId,
    teamId,
    ...profile,
    name: projection.fullName,
    age,
    ageAtSnapshot: age,
    ageSource: "SNAPSHOT_FALLBACK",
    heightCm: projection.heightCm,
    weightKg: projection.weightKg,
    portraitPath: projection.portraitPath ?? null,
    position: projection.position,
    profileSource: "CURATED_DATASET",
    projectionSource: "NBA_API_MODEL_V1",
    projectionDataVersion: NBA_PLAYER_DATASET.datasetVersion,
    attributes: projection.projection.attributes,
    overallAdjustment: projection.projection.overall - calculatePlayerOverall({
      attributes: projection.projection.attributes,
      position: projection.position,
    }),
    threeRate: Math.max(0.18, Math.min(0.62, fieldGoalAttempts > 0 ? threePointAttempts / fieldGoalAttempts : 0.33)),
    usageTendency: Math.max(35, Math.min(95, Math.round(35 + usage * 165))),
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
    contract: bundledContract(projection, rank),
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
  for (const player of NBA_PLAYER_DATASET.players) {
    if (REAL_2026_CLASS_ROSTER_EXCLUSIONS.has(player.canonicalPlayerId)) continue;
    const currentRosterPlayer = CURRENT_NBA_ROSTER_BY_ID.get(player.nbaPlayerId);
    if (!currentRosterPlayer) continue;
    const abbreviation = currentRosterPlayer.teamAbbreviation;
    const roster = byAbbreviation.get(abbreviation) ?? [];
    roster.push(player);
    byAbbreviation.set(abbreviation, roster);
  }

  let ordinal = 0;
  for (const team of existingTeams) {
    for (const playerId of state.teams[team.id].playerIds) delete state.players[playerId];
    const projections = [...(byAbbreviation.get(team.id) ?? [])]
      .sort((left, right) => right.projection.overall - left.projection.overall || left.canonicalPlayerId.localeCompare(right.canonicalPlayerId))
      .slice(0, 18);
    if (projections.length < 9) throw new Error(`${team.fullName}的离线阵容评分球员不足 9 人`);
    state.teams[team.id].playerIds = projections.map((projection, rank) => {
      const player = createBundledPlayer(careerSeed, team.id, projection, rank, ordinal);
      ordinal += 1;
      state.players[player.id] = player;
      return player.id;
    });
  }

  state.meta.dataVersion = `bundled.${NBA_PLAYER_DATASET.datasetVersion}+${CURRENT_NBA_ROSTER.rosterVersion}`;
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
  state.meta.dataVersion = `hupu.nba.live-roster.${freshestUpdate}+${NBA_PLAYER_DATASET.datasetVersion}`;
  state.meta.gameVersion = "0.5.0";
  return state;
}

function waitForRequestWindow(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, REQUEST_WINDOW_PAUSE_MS));
}

async function loadTeam(team: (typeof TEAM_DEFINITIONS)[number]): Promise<HupuTeamSnapshot> {
  const sourceTeamId = team.sourceTeamId as string;
  try {
    const [roster, salary] = await Promise.all([requestTeamPlayers(sourceTeamId), requestTeamSalaryInfo(sourceTeamId)]);
    return {
      internalTeamId: team.id,
      sourceTeamId,
      teamName: roster?.info?.full_name || roster?.info?.name || team.fullName,
      players: roster?.list ?? [],
      salaries: salary?.salaryPlayerTable?.items ?? [],
      updatedAt: salary?.lastUpdateDate || salary?.lastModifyDate || salary?.version,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    throw new Error(`${team.fullName}数据加载失败：${message}`);
  }
}

let liveCareerPromise: Promise<GameState> | null = null;

export function loadHupuExpansionCareer(careerSeed: string, onProgress?: (progress: HupuRosterProgress) => void): Promise<GameState> {
  if (liveCareerPromise) return liveCareerPromise;
  liveCareerPromise = (async () => {
    const teams = TEAM_DEFINITIONS.filter((team) => team.sourceTeamId);
    const snapshots: HupuTeamSnapshot[] = [];
    onProgress?.({ loadedTeams: 0, totalTeams: teams.length });
    for (let start = 0; start < teams.length; start += LOAD_BATCH_SIZE) {
      snapshots.push(...await Promise.all(teams.slice(start, start + LOAD_BATCH_SIZE).map(loadTeam)));
      onProgress?.({ loadedTeams: snapshots.length, totalTeams: teams.length });
      if (start + LOAD_BATCH_SIZE < teams.length) await waitForRequestWindow();
    }
    return createExpansionCareerFromHupu(careerSeed, snapshots);
  })().catch((error) => {
    liveCareerPromise = null;
    throw error;
  });
  return liveCareerPromise;
}
