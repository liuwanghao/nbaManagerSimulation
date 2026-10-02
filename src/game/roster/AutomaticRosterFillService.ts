import { BALANCE_CONFIG } from "../../config/balanceConfig";
import { LEAGUE_FINANCE_CONFIG } from "../../config/leagueFinance";
import { createFictionalPlayerProfile } from "../../data/playerProfiles";
import { addTeamNotification } from "../notifications/TeamNotificationService";
import { calculatePlayerOverall } from "../player/PlayerRatingService";
import { stableHash } from "../random/hash";
import { createRng } from "../random/xoshiro";
import { emptyPlayerSeasonStats, type GameState, type Player, type PlayerAttributes, type Position } from "../state/types";

const POSITIONS: Position[] = ["PG", "SG", "SF", "PF", "C"];

function replacementAttributes(seed: string): PlayerAttributes {
  const rng = createRng(seed);
  const config = BALANCE_CONFIG.replacementPlayers;
  const rating = (modifier = 0) => Math.max(config.attributeMinimum, Math.min(config.attributeMaximum, config.autoFillMaximumOverall,
    config.attributeBase + modifier + rng.int(-config.attributeNoise, config.attributeNoise)));
  return {
    shooting: rating(), finishing: rating(1), playmaking: rating(-1), perimeterDefense: rating(),
    interiorDefense: rating(), rebounding: rating(), athleticism: rating(1), basketballIq: rating(2),
  };
}

function createReplacementPlayer(state: GameState): Player {
  const prefix = `EMG-${state.league.seasonId}-POOL-`;
  const ordinal = Object.keys(state.players).filter((id) => id.startsWith(prefix)).length;
  const id = `${prefix}${String(ordinal + 1).padStart(2, "0")}`;
  const seed = stableHash(state.seeds.seasonSeed, "emergency-player", id);
  const rng = createRng(seed);
  const config = BALANCE_CONFIG.replacementPlayers;
  const position = POSITIONS[rng.int(0, POSITIONS.length - 1)];
  const age = rng.int(config.ageMinimum, config.ageMaximum);
  const profile = createFictionalPlayerProfile(state.seeds.careerSeed, Object.keys(state.players).length + ordinal, id, position, age);
  return {
    id, teamId: "FREE_AGENT", ...profile, age, position,
    attributes: replacementAttributes(seed),
    threeRate: config.threeRateMinimum + rng.nextFloat() * config.threeRateRange,
    assistRate: config.assistRateMinimum + rng.nextFloat() * config.assistRateRange,
    rimRate: config.rimRateMinimum + rng.nextFloat() * config.rimRateRange,
    usageTendency: rng.int(config.usageMinimum, config.usageMaximum),
    health: 100, morale: config.initialMorale, fatigue: 0, form: 0,
    rotationRole: "OUT", teamRole: "BENCH", available: true,
    serviceRosterDays: 0, birdTeamId: null, birdYears: 0,
    contract: { salary: 0, yearsRemaining: 0, guaranteedAmount: 0, status: "UFA", optionType: "NONE", optionDecision: "NOT_APPLICABLE" },
    seasonStats: emptyPlayerSeasonStats(), postseasonStats: emptyPlayerSeasonStats(),
  };
}

export function getAutomaticRosterReplacement(state: GameState): Player {
  const candidate = Object.values(state.players)
    .filter((player) => player.teamId === "FREE_AGENT" && player.contract.status === "UFA" && player.available && !player.injury
      && calculatePlayerOverall(player) <= BALANCE_CONFIG.replacementPlayers.autoFillMaximumOverall)
    .sort((left, right) => calculatePlayerOverall(right) - calculatePlayerOverall(left) || left.id.localeCompare(right.id))[0];
  if (candidate) return candidate;
  const replacement = createReplacementPlayer(state);
  state.players[replacement.id] = replacement;
  return replacement;
}

export function notifyAutomaticRosterFill(state: GameState, players: Player[], kind: "OPENING" | "EMERGENCY"): void {
  if (!players.length) return;
  const opening = kind === "OPENING";
  const target = opening ? LEAGUE_FINANCE_CONFIG.rosterLimits.regularSeasonMinimum : LEAGUE_FINANCE_CONFIG.rosterLimits.emergencyTarget;
  const names = players.map((player) => `${player.name}（能力 ${Math.round(calculatePlayerOverall(player))}）`).join("、");
  const baseId = `auto-fill-${stableHash(state.league.seasonId, kind, state.calendar.currentDateIndex, players.map((player) => player.id))}`;
  let id = baseId;
  let occurrence = 1;
  while (state.teamNotifications?.some((notice) => notice.id === id)) id = `${baseId}-${occurrence++}`;
  addTeamNotification(state, {
    id,
    category: "TEAM", seasonId: state.league.seasonId,
    title: opening ? "开幕名单已自动补齐" : "紧急名单已自动补齐",
    message: `${opening ? "球队名单" : "可用球员"}不足 ${target} 人，已自动补入 ${players.length} 名低能力替补，补齐至 ${target} 人：${names}。合同：${opening ? "一年底薪" : "紧急合同（临时底薪）"}。`,
  });
}
