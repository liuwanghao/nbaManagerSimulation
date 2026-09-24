import { LEAGUE_FINANCE_CONFIG } from "../../config/leagueFinance";
import { BALANCE_CONFIG } from "../../config/balanceConfig";
import { createFictionalPlayerProfile } from "../../data/playerProfiles";
import { calculateMarketPreference } from "../player/MarketPreferenceService";
import { createBundledPlayer } from "../../data/hupuRoster";
import { eligibleHistoricalTemplates, NBA_PLAYER_DATASET, type HistoricalPlayerTemplate } from "../../data/nbaPlayerDataset";
import { REAL_2026_DRAFT, REAL_2026_DRAFT_PLAYER_IDS, REAL_2026_UNDRAFTED_PLAYER_IDS, type Real2026DraftEntry } from "../../data/real2026Draft";
import { publicPlayerValue } from "../ai/AIValueService";
import { assertPhaseAllowed } from "../policy/TransactionPolicyService";
import { stableHash } from "../random/hash";
import { createRng } from "../random/xoshiro";
import { resolveConferenceStandings } from "../standings/standings";
import { calculateAttributeOverall } from "../player/PlayerRatingService";
import { emptyPlayerSeasonStats, type ExpansionCityId, type GameState, type Player, type PlayerAttributes, type PlayerTrait, type Position, type RookieDraftPick, type RookieDraftState } from "../state/types";

export type DraftCommand =
  | { commandId: string; type: "PREPARE_ROOKIE_DRAFT"; payload: Record<string, never> }
  | { commandId: string; type: "REVEAL_DRAFT_PROSPECT"; payload: { playerId: string } }
  | { commandId: string; type: "ADVANCE_ROOKIE_DRAFT_AI_PICK"; payload: { expectedPickNumber: number } }
  | { commandId: string; type: "FAST_FORWARD_ROOKIE_DRAFT"; payload: { expectedPickNumber: number } }
  | { commandId: string; type: "DRAFT_PLAYER"; payload: { playerId: string; expectedPickNumber: number } };

export type DraftProspectView = Pick<Player,
  "id" | "name" | "age" | "position" | "secondaryPosition" | "heightCm" | "weightKg"
  | "attributes" | "scoutedPotentialGrade" | "scoutingConfidence" | "traits"
>;

const POSITIONS: Position[] = ["PG", "SG", "SF", "PF", "C"];
const TRAITS: PlayerTrait[] = ["PRIMARY_CREATOR", "SECONDARY_CREATOR", "SPACER", "SLASHER", "RIM_RUNNER", "WING_STOPPER", "RIM_PROTECTOR", "REBOUNDER", "TWO_WAY", "SIXTH_MAN"];
const FIRST_NAMES = ["Aiden", "Malik", "Jonah", "Darius", "Eli", "Kellan", "Micah", "Noah", "Andre", "Julian", "Isaiah", "Marcus", "Tyrese", "Caleb", "Devin", "Jalen"];
const LAST_NAMES = ["Carter", "Brooks", "Hayes", "Mitchell", "Reed", "Foster", "Bennett", "Coleman", "Price", "Warren", "Grant", "Pierce", "Sutton", "Morris", "Lawson", "Banks"];
const clamp = (
  value: number,
  min: number = BALANCE_CONFIG.playerLifecycle.attributeMinimum,
  max: number = BALANCE_CONFIG.playerLifecycle.attributeMaximum,
): number => Math.max(min, Math.min(max, Math.round(value)));

function gradeFor(value: number): NonNullable<Player["scoutedPotentialGrade"]> {
  return (BALANCE_CONFIG.draft.potentialGrades.find((entry) => value >= entry.minimum)
    ?? BALANCE_CONFIG.draft.potentialGrades.at(-1) as typeof BALANCE_CONFIG.draft.potentialGrades[number]).grade;
}

function weightedChoice<T extends string>(values: readonly T[], weights: Record<T, number>, roll: number): T {
  const total = values.reduce((sum, value) => sum + Math.max(0, weights[value]), 0);
  let target = roll * total;
  for (const value of values) {
    target -= Math.max(0, weights[value]);
    if (target <= 0) return value;
  }
  return values.at(-1) as T;
}

function prospectAttributes(seed: string, rank: number, position: Position): PlayerAttributes {
  const rng = createRng(seed);
  const tier = BALANCE_CONFIG.draft.readinessTiers.find((entry) => rank < entry.rankExclusive)
    ?? BALANCE_CONFIG.draft.readinessTiers.at(-1) as typeof BALANCE_CONFIG.draft.readinessTiers[number];
  const rating = (modifier = 0) => clamp(tier.base + modifier + rng.normalLike(tier.noise));
  const guard = position === "PG" || position === "SG";
  const big = position === "PF" || position === "C";
  return {
    finishing: rating(big ? 4 : 1),
    shooting: rating(big ? -2 : 3),
    playmaking: rating(position === "PG" ? 7 : guard ? 2 : -3),
    perimeterDefense: rating(guard ? 3 : 0),
    interiorDefense: rating(big ? 6 : -4),
    rebounding: rating(big ? 7 : -3),
    athleticism: rating(3),
    basketballIq: rating(),
  };
}

function generateProspect(state: GameState, rank: number, draftSeed: string): Player {
  const id = `DRAFT-${state.league.seasonYear}-${String(rank + 1).padStart(3, "0")}`;
  const seed = stableHash(draftSeed, id, "prospect");
  const rng = createRng(seed);
  const ageConfig = BALANCE_CONFIG.draft.age;
  const age = ageConfig.base + rng.int(0, rank < ageConfig.topRankExclusive ? ageConfig.topRange : ageConfig.remainingRange);
  const position = weightedChoice(POSITIONS, BALANCE_CONFIG.draft.archetypeDistribution.positions, rng.nextFloat());
  const profile = createFictionalPlayerProfile(draftSeed, rank, id, position, age);
  const attributes = prospectAttributes(seed, rank, position);
  const readiness = calculateAttributeOverall(attributes, position);
  const potential = BALANCE_CONFIG.draft.potentialDistribution;
  const truePotential = clamp(
    Math.max(readiness + potential.readinessGapMinimum, potential.base - rank * potential.rankSlope + rng.normalLike(potential.noise)),
    potential.minimum,
    potential.maximum,
  );
  const developmentTier = BALANCE_CONFIG.draft.developmentRateTiers.find((entry) => rank < entry.rankExclusive)
    ?? BALANCE_CONFIG.draft.developmentRateTiers.at(-1) as typeof BALANCE_CONFIG.draft.developmentRateTiers[number];
  const developmentRate = developmentTier.minimum + rng.nextFloat() * developmentTier.range;
  const scouting = BALANCE_CONFIG.draft.scouting;
  const scoutingConfidence = clamp(scouting.confidenceBase - rank * scouting.rankSlope + rng.normalLike(scouting.confidenceNoise), scouting.confidenceMin, scouting.confidenceMax);
  const errorRange = scouting.errorByConfidence.find((band) => scoutingConfidence >= band.minimumConfidence)?.error
    ?? scouting.errorByConfidence.at(-1)?.error
    ?? 0;
  const scoutingRng = createRng(stableHash(draftSeed, id, "scouting"));
  const scoutedValue = clamp(truePotential + scoutingRng.int(-errorRange, errorRange), BALANCE_CONFIG.draft.scoutingPotentialMinimum, BALANCE_CONFIG.playerLifecycle.attributeMaximum);
  const nameRng = createRng(stableHash(seed, "name"));
  return {
    id,
    teamId: "FREE_AGENT",
    ...profile,
    name: `${FIRST_NAMES[nameRng.int(0, FIRST_NAMES.length - 1)]} ${LAST_NAMES[nameRng.int(0, LAST_NAMES.length - 1)]}`,
    age,
    position,
    profileSource: "PROCEDURAL_DRAFT",
    projectionSource: "PROCEDURAL_V1",
    attributes,
    threeRate: BALANCE_CONFIG.draft.tendencies.threeRateMinimum + rng.nextFloat() * BALANCE_CONFIG.draft.tendencies.threeRateRange,
    assistRate: BALANCE_CONFIG.draft.tendencies.assistRateMinimum + rng.nextFloat() * BALANCE_CONFIG.draft.tendencies.assistRateRange,
    rimRate: BALANCE_CONFIG.draft.tendencies.rimRateMinimum + rng.nextFloat() * BALANCE_CONFIG.draft.tendencies.rimRateRange,
    usageTendency: BALANCE_CONFIG.draft.tendencies.usageMinimum + rng.int(0, BALANCE_CONFIG.draft.tendencies.usageRange),
    health: BALANCE_CONFIG.draft.initialHealth,
    morale: BALANCE_CONFIG.draft.initialMorale,
    fatigue: 0,
    form: 0,
    rotationRole: "OUT",
    teamRole: "DEVELOPMENT",
    available: true,
    traits: [weightedChoice(TRAITS, BALANCE_CONFIG.draft.archetypeDistribution.traits, rng.nextFloat())],
    truePotential,
    developmentRate,
    developmentVolatility: BALANCE_CONFIG.draft.developmentVolatility.minimum + rng.nextFloat() * BALANCE_CONFIG.draft.developmentVolatility.range,
    scoutedPotentialGrade: gradeFor(scoutedValue),
    scoutingConfidence,
    serviceRosterDays: 0,
    birdTeamId: null,
    birdYears: 0,
    contract: {
      salary: 0,
      yearsRemaining: 0,
      guaranteedAmount: 0,
      status: "UFA",
      optionType: "NONE",
      optionDecision: "NOT_APPLICABLE",
    },
    seasonStats: emptyPlayerSeasonStats(),
    postseasonStats: emptyPlayerSeasonStats(),
  };
}

function resetAsDraftProspect(player: Player): Player {
  return {
    ...player,
    teamId: "FREE_AGENT",
    serviceYears: 0,
    serviceRosterDays: 0,
    birdTeamId: null,
    birdYears: 0,
    health: BALANCE_CONFIG.draft.initialHealth,
    morale: BALANCE_CONFIG.draft.initialMorale,
    fatigue: 0,
    form: 0,
    rotationRole: "OUT",
    teamRole: "DEVELOPMENT",
    available: true,
    contract: {
      salary: 0,
      yearsRemaining: 0,
      guaranteedAmount: 0,
      status: "UFA",
      optionType: "NONE",
      optionDecision: "NOT_APPLICABLE",
    },
    seasonStats: emptyPlayerSeasonStats(),
    postseasonStats: emptyPlayerSeasonStats(),
  };
}

function fallbackRealProspect(state: GameState, rank: number, draftSeed: string, entry: Real2026DraftEntry): Player {
  const generated = generateProspect(state, rank, draftSeed);
  const position = entry.position ?? generated.position;
  const secondaryPosition: Position = position === "PG" ? "SG" : position === "SG" ? "PG" : position === "SF" ? "PF" : position === "PF" ? "C" : "PF";
  return resetAsDraftProspect({
    ...generated,
    id: entry.playerId,
    name: entry.fullName,
    age: entry.age ?? generated.age,
    ageAtSnapshot: entry.age ?? generated.age,
    position,
    secondaryPosition,
    heightCm: entry.heightCm ?? generated.heightCm,
    weightKg: entry.weightKg ?? generated.weightKg,
    profileSource: "CURATED_DATASET",
    projectionDataVersion: `${NBA_PLAYER_DATASET.datasetVersion}+real-2026-draft`,
  });
}

function curated2026Class(state: GameState, draftSeed: string): Player[] {
  const projections = new Map(NBA_PLAYER_DATASET.players.map((player) => [player.canonicalPlayerId, player]));
  const official = REAL_2026_DRAFT.map((entry, rank) => {
    const projection = projections.get(entry.playerId);
    if (!projection) return fallbackRealProspect(state, rank, draftSeed, entry);
    return resetAsDraftProspect(createBundledPlayer(draftSeed, "FREE_AGENT", projection, rank, rank));
  });
  const undrafted = REAL_2026_UNDRAFTED_PLAYER_IDS.map((playerId, index) => {
    const projection = projections.get(playerId);
    if (!projection) throw new Error(`Missing curated 2026 prospect ${playerId}`);
    return resetAsDraftProspect(createBundledPlayer(draftSeed, "FREE_AGENT", projection, REAL_2026_DRAFT.length + index, REAL_2026_DRAFT.length + index));
  });
  const fillerCount = BALANCE_CONFIG.draft.classSize - official.length - undrafted.length;
  const fillers = Array.from({ length: fillerCount }, (_, index) => generateProspect(state, official.length + undrafted.length + index, draftSeed));
  return [...official, ...undrafted, ...fillers];
}

function historicalProspect(
  state: GameState,
  rank: number,
  draftSeed: string,
  template: HistoricalPlayerTemplate,
): Player {
  const id = `DRAFT-${state.league.seasonYear}-${String(rank + 1).padStart(3, "0")}`;
  const seed = stableHash(draftSeed, id, template.sourcePlayerId, "historical-rebirth");
  const rng = createRng(seed);
  const ageConfig = BALANCE_CONFIG.draft.age;
  const age = ageConfig.base + rng.int(0, ageConfig.remainingRange);
  const profile = createFictionalPlayerProfile(draftSeed, rank, id, template.position, age);
  const jitter = BALANCE_CONFIG.draft.historicalRebirth.rookieAttributeJitter;
  const attributes = Object.fromEntries(Object.entries(template.rookieAttributes).map(([key, value]) => [
    key,
    clamp(value + rng.int(-jitter, jitter)),
  ])) as unknown as PlayerAttributes;
  const readiness = calculateAttributeOverall(attributes, template.position);
  const truePotential = clamp(
    Math.max(readiness + BALANCE_CONFIG.draft.potentialDistribution.readinessGapMinimum, template.peakOverall + rng.int(
      -BALANCE_CONFIG.draft.historicalRebirth.potentialJitter,
      BALANCE_CONFIG.draft.historicalRebirth.potentialJitter,
    )),
    BALANCE_CONFIG.draft.potentialDistribution.minimum,
    BALANCE_CONFIG.draft.potentialDistribution.maximum,
  );
  const scouting = BALANCE_CONFIG.draft.scouting;
  const scoutingConfidence = clamp(scouting.confidenceBase - rank * scouting.rankSlope + rng.normalLike(scouting.confidenceNoise), scouting.confidenceMin, scouting.confidenceMax);
  const errorRange = scouting.errorByConfidence.find((band) => scoutingConfidence >= band.minimumConfidence)?.error
    ?? scouting.errorByConfidence.at(-1)?.error
    ?? 0;
  const scoutedValue = clamp(
    truePotential + createRng(stableHash(draftSeed, id, "scouting")).int(-errorRange, errorRange),
    BALANCE_CONFIG.draft.scoutingPotentialMinimum,
    BALANCE_CONFIG.playerLifecycle.attributeMaximum,
  );
  return {
    id,
    teamId: "FREE_AGENT",
    ...profile,
    name: profile.name,
    age,
    ageAtSnapshot: age,
    ageSource: "GENERATED_BIRTH_DATE",
    serviceYears: 0,
    heightCm: template.heightCm || profile.heightCm,
    weightKg: template.weightKg || profile.weightKg,
    position: template.position,
    profileSource: "HISTORICAL_ARCHETYPE",
    projectionSource: "HISTORICAL_REBIRTH_V1",
    projectionDataVersion: NBA_PLAYER_DATASET.datasetVersion,
    historicalSourcePlayerId: template.sourcePlayerId,
    attributes,
    threeRate: template.tendencies.threeRate,
    assistRate: template.tendencies.assistRate,
    rimRate: template.tendencies.rimRate,
    usageTendency: template.tendencies.usageTendency,
    health: BALANCE_CONFIG.draft.initialHealth,
    morale: BALANCE_CONFIG.draft.initialMorale,
    fatigue: 0,
    form: 0,
    rotationRole: "OUT",
    teamRole: "DEVELOPMENT",
    available: true,
    traits: template.traits,
    injuryRating: clamp(template.durability + rng.int(-4, 4)),
    truePotential,
    developmentRate: Math.max(0.75, Math.min(1.3, 0.9 + (truePotential - readiness) / 80 + rng.normalLike(0.05))),
    developmentVolatility: BALANCE_CONFIG.draft.developmentVolatility.minimum + rng.nextFloat() * BALANCE_CONFIG.draft.developmentVolatility.range,
    scoutedPotentialGrade: gradeFor(scoutedValue),
    scoutingConfidence,
    serviceRosterDays: 0,
    birdTeamId: null,
    birdYears: 0,
    contract: {
      salary: 0,
      yearsRemaining: 0,
      guaranteedAmount: 0,
      status: "UFA",
      optionType: "NONE",
      optionDecision: "NOT_APPLICABLE",
    },
    seasonStats: emptyPlayerSeasonStats(),
    postseasonStats: emptyPlayerSeasonStats(),
  };
}

function historicalTemplatesForClass(state: GameState, draftSeed: string): Map<number, HistoricalPlayerTemplate> {
  const config = BALANCE_CONFIG.draft.historicalRebirth;
  if (!config.enabled || config.mode !== "LEGEND_ARCHETYPE" || state.league.seasonYear < config.firstEligibleSeasonYear) return new Map();
  const used = new Set(state.history.rebornHistoricalSourceIds ?? []);
  const eligible = eligibleHistoricalTemplates()
    .filter((template) => !used.has(template.sourcePlayerId))
    .sort((left, right) => stableHash(draftSeed, left.sourcePlayerId).localeCompare(stableHash(draftSeed, right.sourcePlayerId)));
  const count = Math.min(config.maximumPerClass, Math.round(BALANCE_CONFIG.draft.classSize * config.classShare), eligible.length);
  const selected = eligible.slice(0, count).sort((left, right) => right.peakOverall - left.peakOverall || left.sourcePlayerId.localeCompare(right.sourcePlayerId));
  const rankSlots = createRng(stableHash(draftSeed, "historical-rank-slots"))
    .shuffle(Array.from({ length: BALANCE_CONFIG.draft.classSize }, (_, index) => index))
    .slice(0, count)
    .sort((left, right) => left - right);
  return new Map(selected.map((template, index) => [rankSlots[index], template]));
}

function expansionPackageOwner(state: GameState, packageId: "A" | "B"): ExpansionCityId {
  const found = (["SEA", "LVG"] as const).find((teamId) => state.expansion?.rightsDraw.packageByTeam[teamId] === packageId);
  if (!found) throw new Error(`Expansion Package ${packageId} has no owner`);
  return found;
}

function buildPickOrder(state: GameState, draftSeed: string): RookieDraftPick[] {
  if (state.league.seasonYear > BALANCE_CONFIG.playerLifecycle.snapshotSeasonYear) return buildFuturePickOrder(state, draftSeed);
  const packageB = expansionPackageOwner(state, "B");
  const packageA = expansionPackageOwner(state, "A");
  const packageAPick = BALANCE_CONFIG.expansion.package.A.rookieDraftPick;
  const packageBPick = BALANCE_CONFIG.expansion.package.B.rookieDraftPick;
  return [1, 2].flatMap((roundValue) => {
    const round = roundValue as 1 | 2;
    const official: Array<Omit<RookieDraftPick, "pickNumber">> = REAL_2026_DRAFT
      .filter((entry) => round === 1 ? entry.realPickNumber <= 30 : entry.realPickNumber > 30)
      .map((entry) => ({
        round,
        originalTeamId: entry.draftingTeamId,
        ownerTeamId: entry.finalTeamId,
        realPickNumber: entry.realPickNumber,
        scriptedPlayerId: entry.playerId,
      }));
    for (const [roundPick, teamId] of [[packageAPick, packageA], [packageBPick, packageB]].sort((left, right) => Number(left[0]) - Number(right[0]))) {
      official.splice(Number(roundPick) - 1, 0, {
        round,
        originalTeamId: teamId as string,
        ownerTeamId: teamId as string,
        realPickNumber: undefined,
        scriptedPlayerId: undefined,
      });
    }
    return official.map((entry, index) => ({
      ...entry,
      pickNumber: index + 1 + (round - 1) * official.length,
    }));
  });
}

function recordOrder(state: GameState, teamIds: string[], draftSeed: string): string[] {
  return [...teamIds].sort((left, right) => {
    const a = state.standings[left];
    const b = state.standings[right];
    return a.wins - b.wins || b.losses - a.losses
      || stableHash(draftSeed, "tiebreak", left).localeCompare(stableHash(draftSeed, "tiebreak", right));
  });
}

function drawLottery(state: GameState, eligible: string[], draftSeed: string): string[] {
  const remaining = recordOrder(state, eligible, draftSeed).map((teamId, index) => ({ teamId, weight: BALANCE_CONFIG.draft.lotteryWeights[index] ?? 0 }));
  const rng = createRng(stableHash(draftSeed, "lottery"));
  const winners: string[] = [];
  for (let pick = 0; pick < BALANCE_CONFIG.draft.lotteryDrawCount; pick += 1) {
    const total = remaining.reduce((sum, entry) => sum + entry.weight, 0);
    let target = rng.nextFloat() * total;
    let selectedIndex = 0;
    for (let index = 0; index < remaining.length; index += 1) {
      target -= remaining[index].weight;
      if (target <= 0) { selectedIndex = index; break; }
    }
    winners.push(remaining[selectedIndex].teamId);
    remaining.splice(selectedIndex, 1);
  }
  return [...winners, ...recordOrder(state, remaining.map((entry) => entry.teamId), draftSeed)];
}

function pickOwner(state: GameState, year: number, round: 1 | 2, originalTeamId: string): string {
  return state.draftPicks[`${year}-R${round}-${originalTeamId}`]?.ownerTeamId ?? originalTeamId;
}

function buildFuturePickOrder(state: GameState, draftSeed: string): RookieDraftPick[] {
  const westPlayoffs = resolveConferenceStandings("WEST", state.standings, state.teams, state.seeds.seasonSeed).slice(0, 8).map((record) => record.teamId);
  const eastPlayoffs = resolveConferenceStandings("EAST", state.standings, state.teams, state.seeds.seasonSeed).slice(0, 8).map((record) => record.teamId);
  const playoffSet = new Set([...westPlayoffs, ...eastPlayoffs]);
  const lotteryTeams = Object.keys(state.teams).filter((teamId) => !playoffSet.has(teamId));
  const playoffTeams = Object.keys(state.teams).filter((teamId) => playoffSet.has(teamId));
  const firstRound = [...drawLottery(state, lotteryTeams, draftSeed), ...recordOrder(state, playoffTeams, draftSeed)];
  const secondRound = recordOrder(state, Object.keys(state.teams), stableHash(draftSeed, "round-2"));
  return [
    ...firstRound.map((teamId, index) => ({ pickNumber: index + 1, round: 1 as const, originalTeamId: teamId, ownerTeamId: pickOwner(state, state.league.seasonYear, 1, teamId) })),
    ...secondRound.map((teamId, index) => ({ pickNumber: index + firstRound.length + 1, round: 2 as const, originalTeamId: teamId, ownerTeamId: pickOwner(state, state.league.seasonYear, 2, teamId) })),
  ];
}

function gradeValue(grade: Player["scoutedPotentialGrade"]): number {
  return BALANCE_CONFIG.draft.potentialGrades.find((entry) => entry.grade === (grade ?? "D"))?.publicValue
    ?? BALANCE_CONFIG.draft.potentialGrades.at(-1)?.publicValue
    ?? 0;
}

function publicDraftScore(player: Player, teamId: string, state: GameState): number {
  const readiness = publicPlayerValue(player, "BALANCED");
  const rosterPositions = state.teams[teamId].playerIds.map((id) => state.players[id]?.position);
  const need = 5 - rosterPositions.filter((position) => position === player.position).length;
  const preference = BALANCE_CONFIG.ai.draftPreference;
  const potentialWeight = teamId === state.expansion?.aiTeamId && state.expansion.aiStrategy === "FUTURE_FIRST"
    ? preference.futureFirstPotentialWeight
    : preference.potentialWeight;
  return readiness * (1 - potentialWeight) + gradeValue(player.scoutedPotentialGrade) * potentialWeight
    + need * preference.rosterNeedWeight - player.age * preference.agePenalty;
}

function signRookie(state: GameState, player: Player, pick: RookieDraftPick): void {
  const team = state.teams[pick.ownerTeamId];
  clearAiRookieRosterSlot(state, team.id);
  if (team.playerIds.length >= LEAGUE_FINANCE_CONFIG.rosterLimits.offseasonMaximum) throw new Error(`${team.fullName} exceeds the offseason roster limit`);
  const firstRound = pick.round === 1;
  const year1 = firstRound
    ? Math.round((LEAGUE_FINANCE_CONFIG.rookieScale[pick.pickNumber] * LEAGUE_FINANCE_CONFIG.rookieContracts.firstRoundScaleMultiplier) / 10_000) * 10_000
    : LEAGUE_FINANCE_CONFIG.minimumSalary;
  const growth = firstRound ? LEAGUE_FINANCE_CONFIG.rookieContracts.firstRoundSalaryGrowth : LEAGUE_FINANCE_CONFIG.rookieContracts.secondRoundSalaryGrowth;
  const salaryByYear = growth.map((multiplier) => Math.round(year1 * multiplier));
  const guaranteedYears = firstRound ? LEAGUE_FINANCE_CONFIG.rookieContracts.firstRoundGuaranteedYears : LEAGUE_FINANCE_CONFIG.rookieContracts.secondRoundGuaranteedYears;
  player.teamId = team.id;
  player.rotationRole = "BENCH";
  player.contract = {
    salary: salaryByYear[0],
    yearsRemaining: salaryByYear.length,
    guaranteedAmount: salaryByYear[0] + (salaryByYear[1] ?? 0),
    status: "STANDARD",
    optionType: firstRound ? "TEAM" : "TEAM",
    optionDecision: "NOT_APPLICABLE",
    contractId: stableHash(state.league.seasonId, player.id, "rookie-contract"),
    contractType: firstRound ? "ROOKIE_FIRST" : "ROOKIE_SECOND",
    startSeason: state.league.seasonYear,
    endSeason: state.league.seasonYear + salaryByYear.length - 1,
    currentYearIndex: 0,
    salaryByYear,
    guaranteedByYear: salaryByYear.map((salary, index) => index < guaranteedYears ? salary : 0),
    optionByYear: firstRound ? ["NONE", "NONE", "TEAM_OPTION", "TEAM_OPTION"] : ["NONE", "TEAM_OPTION"],
    signedTeamId: team.id,
    signedPhase: "DRAFT",
  };
  player.birdTeamId = team.id;
  player.birdYears = 1;
  if (player.career) { player.career.unemployedGameDays = 0; player.career.unemployedLeagueYears = 0; }
  team.playerIds.push(player.id);
  pick.playerId = player.id;
  if (pick.ownerTeamId === state.userTeamId && !state.gmCareer.draftHistory.some((entry) => entry.seasonId === state.league.seasonId && entry.pickNumber === pick.pickNumber)) {
    state.gmCareer.draftHistory.push({ seasonId: state.league.seasonId, pickNumber: pick.pickNumber, playerId: player.id });
  }
}

function availableProspects(state: GameState): Player[] {
  const draft = state.rookieDraft as RookieDraftState;
  return draft.classPlayerIds.map((id) => state.players[id]).filter((player) => player.teamId === "FREE_AGENT");
}

function addDraftWaiverDeadMoney(state: GameState, player: Player, teamId: string): void {
  const guaranteed = player.contract.guaranteedByYear ?? [];
  const salaryBySeason: Record<string, number> = {};
  for (let index = player.contract.currentYearIndex ?? 0; index < guaranteed.length; index += 1) {
    const year = (player.contract.startSeason ?? state.league.seasonYear) + index;
    const seasonId = `${year}-${String((year + 1) % 100).padStart(2, "0")}`;
    if (guaranteed[index] > 0) salaryBySeason[seasonId] = guaranteed[index];
  }
  if (Object.keys(salaryBySeason).length === 0 && player.contract.guaranteedAmount > 0) {
    salaryBySeason[state.league.seasonId] = Math.min(player.contract.salary, player.contract.guaranteedAmount);
  }
  if (Object.keys(salaryBySeason).length) {
    state.capState.deadMoney.push({ id: stableHash(teamId, player.id, "draft-roster-cut", state.league.seasonId), teamId, salaryBySeason });
  }
}

function clearAiRookieRosterSlot(state: GameState, teamId: string): void {
  const team = state.teams[teamId];
  if (team.playerIds.length < LEAGUE_FINANCE_CONFIG.rosterLimits.offseasonMaximum) return;
  if (teamId === state.userTeamId) throw new Error(`${team.fullName} exceeds the offseason roster limit`);
  const player = team.playerIds
    .map((id) => state.players[id])
    .sort((left, right) => {
      const leftRookie = ["ROOKIE_FIRST", "ROOKIE_SECOND"].includes(left.contract.contractType ?? "") ? 1 : 0;
      const rightRookie = ["ROOKIE_FIRST", "ROOKIE_SECOND"].includes(right.contract.contractType ?? "") ? 1 : 0;
      return leftRookie - rightRookie || publicPlayerValue(left) - publicPlayerValue(right) || left.id.localeCompare(right.id);
    })[0];
  if (!player) throw new Error(`${team.fullName} cannot clear a rookie roster slot`);
  addDraftWaiverDeadMoney(state, player, teamId);
  team.playerIds = team.playerIds.filter((id) => id !== player.id);
  player.teamId = "FREE_AGENT";
  player.rotationRole = "OUT";
  player.teamRole = "DEVELOPMENT";
  player.contract = { salary: 0, yearsRemaining: 0, guaranteedAmount: 0, status: "UFA", optionType: "NONE", optionDecision: "NOT_APPLICABLE" };
  player.birdTeamId = null;
  player.birdYears = 0;
  if (state.trainingPlan) delete state.trainingPlan.assignments[player.id];
}

function completeDraft(state: GameState): void {
  const draft = state.rookieDraft as RookieDraftState;
  if (draft.currentPickIndex !== draft.pickOrder.length) throw new Error(`Rookie Draft cannot finalize before ${draft.pickOrder.length} picks`);
  draft.completed = true;
  for (const prospect of availableProspects(state)) prospect.contract.status = "UFA";
  if (state.league.seasonYear === 2026 && state.meta.dataVersion.startsWith("bundled.")) {
    for (const player of Object.values(state.players)) {
      if (player.teamId === "FREE_AGENT" && player.profileSource === "PROCEDURAL_DRAFT") player.teamId = "UNDRAFTED";
    }
  }
  state.league.currentPhase = "OFFSEASON_POST_DRAFT";
}

function equivalentReplacement(state: GameState, pick: RookieDraftPick, scripted: Player): Player {
  const reserve = availableProspects(state)
    .filter((player) => player.profileSource === "PROCEDURAL_DRAFT")
    .sort((left, right) => right.id.localeCompare(left.id))[0];
  if (!reserve) throw new Error("No procedural prospect remains for the intercepted real draft pick");
  const profile = createFictionalPlayerProfile(state.rookieDraft!.draftSeed, pick.pickNumber, reserve.id, scripted.position, scripted.age);
  return {
    ...reserve,
    age: scripted.age,
    ageAtSnapshot: scripted.age,
    birthDate: profile.birthDate,
    ageSource: profile.ageSource,
    heightCm: profile.heightCm,
    weightKg: profile.weightKg,
    position: scripted.position,
    secondaryPosition: scripted.secondaryPosition,
    marketPreference: calculateMarketPreference(reserve.personality, scripted.age),
    attributes: { ...scripted.attributes },
    overallAdjustment: scripted.overallAdjustment,
    threeRate: scripted.threeRate,
    assistRate: scripted.assistRate,
    rimRate: scripted.rimRate,
    usageTendency: scripted.usageTendency,
    injuryRating: scripted.injuryRating,
    traits: scripted.traits ? [...scripted.traits] : undefined,
    truePotential: scripted.truePotential,
    developmentRate: scripted.developmentRate,
    developmentVolatility: scripted.developmentVolatility,
    scoutedPotentialGrade: scripted.scoutedPotentialGrade,
    scoutingConfidence: scripted.scoutingConfidence,
    projectionDataVersion: `${NBA_PLAYER_DATASET.datasetVersion}+real-2026-equivalent`,
  };
}

function selectAiProspect(state: GameState, pick: RookieDraftPick, commitReplacement = false): Player {
  const available = availableProspects(state);
  const scripted = pick.scriptedPlayerId ? state.players[pick.scriptedPlayerId] : undefined;
  if (pick.scriptedPlayerId && !scripted) throw new Error(`Missing scripted 2026 prospect ${pick.scriptedPlayerId}`);
  if (scripted?.teamId === "FREE_AGENT") return scripted;
  if (scripted) {
    const replacement = equivalentReplacement(state, pick, scripted);
    if (commitReplacement) state.players[replacement.id] = replacement;
    return replacement;
  }
  const prospect = available.sort((left, right) =>
    publicDraftScore(right, pick.ownerTeamId, state) - publicDraftScore(left, pick.ownerTeamId, state)
    || left.id.localeCompare(right.id))[0];
  if (!prospect) throw new Error("No eligible prospect remains");
  return prospect;
}

export function prepareRookieDraft(input: GameState): GameState {
  assertPhaseAllowed(input, "Prepare rookie draft", ["ROOKIE_DRAFT_PENDING", "OFFSEASON_PRE_DRAFT"]);
  if (input.league.seasonYear === BALANCE_CONFIG.playerLifecycle.snapshotSeasonYear && !input.expansion?.finalized) throw new Error("Expansion Draft must be finalized first");
  const state = structuredClone(input);
  const draftSeed = stableHash(state.seeds.seasonSeed, "rookie_draft", state.league.seasonYear);
  const historicalByRank = historicalTemplatesForClass(state, draftSeed);
  const classPlayerIds: string[] = [];
  const isCurated2026 = state.league.seasonYear === BALANCE_CONFIG.playerLifecycle.snapshotSeasonYear;
  const curatedClass = isCurated2026 ? curated2026Class(state, draftSeed) : null;
  if (isCurated2026) {
    for (const playerId of REAL_2026_DRAFT_PLAYER_IDS) {
      const existing = state.players[playerId];
      if (existing && existing.teamId !== "FREE_AGENT") {
        state.teams[existing.teamId].playerIds = state.teams[existing.teamId].playerIds.filter((id) => id !== playerId);
      }
      delete state.players[playerId];
    }
    for (const playerId of REAL_2026_UNDRAFTED_PLAYER_IDS) {
      const existing = state.players[playerId];
      if (existing && existing.teamId !== "FREE_AGENT") {
        state.teams[existing.teamId].playerIds = state.teams[existing.teamId].playerIds.filter((id) => id !== playerId);
      }
      delete state.players[playerId];
    }
  }
  for (let rank = 0; rank < BALANCE_CONFIG.draft.classSize; rank += 1) {
    const template = historicalByRank.get(rank);
    const prospect = curatedClass?.[rank] ?? (template ? historicalProspect(state, rank, draftSeed, template) : generateProspect(state, rank, draftSeed));
    state.players[prospect.id] = prospect;
    classPlayerIds.push(prospect.id);
  }
  state.history.rebornHistoricalSourceIds.push(...[...historicalByRank.values()].map((template) => template.sourcePlayerId));
  state.rookieDraft = {
    draftSeed,
    classPlayerIds,
    revealedProspectIds: [],
    pickOrder: buildPickOrder(state, draftSeed),
    currentPickIndex: 0,
    completed: false,
    source: isCurated2026
      ? "CURATED_2026"
      : historicalByRank.size > 0 ? "MIXED_FUTURE" : "PROCEDURAL_FUTURE",
  };
  state.league.currentPhase = "DRAFT";
  validateRookieDraftState(state);
  return state;
}

function revealDraftProspect(input: GameState, playerId: string): GameState {
  assertPhaseAllowed(input, "Reveal draft prospect", ["DRAFT", "OFFSEASON_POST_DRAFT"]);
  const draft = input.rookieDraft;
  if (!draft || !draft.classPlayerIds.includes(playerId)) throw new Error("Prospect is not in the current draft class");
  const state = structuredClone(input);
  const revealed = state.rookieDraft?.revealedProspectIds ?? [];
  if (!revealed.includes(playerId)) revealed.push(playerId);
  if (state.rookieDraft) state.rookieDraft.revealedProspectIds = revealed;
  return state;
}

export function getNextAiDraftProspect(state: GameState): DraftProspectView | undefined {
  const draft = state.rookieDraft;
  const pick = draft?.pickOrder[draft.currentPickIndex];
  if (!draft || !pick || pick.ownerTeamId === state.userTeamId) return undefined;
  return publicProspect(selectAiProspect(state, pick));
}

export function advanceRookieDraftAiPick(input: GameState, expectedPickNumber: number): GameState {
  assertPhaseAllowed(input, "Advance rookie draft AI pick", ["DRAFT"]);
  const draft = input.rookieDraft;
  if (!draft) throw new Error("Rookie Draft is not prepared");
  const pick = draft.pickOrder[draft.currentPickIndex];
  if (!pick || pick.pickNumber !== expectedPickNumber) throw new Error("Draft pick has changed; refresh and try again");
  if (pick.ownerTeamId === input.userTeamId) throw new Error("Current pick is controlled by the player team");
  const state = structuredClone(input);
  const nextDraft = state.rookieDraft as RookieDraftState;
  const nextPick = nextDraft.pickOrder[nextDraft.currentPickIndex];
  signRookie(state, selectAiProspect(state, nextPick, true), nextPick);
  nextDraft.currentPickIndex += 1;
  if (nextDraft.currentPickIndex === nextDraft.pickOrder.length) completeDraft(state);
  validateRookieDraftState(state);
  return state;
}

export function fastForwardRookieDraft(input: GameState, expectedPickNumber: number): GameState {
  assertPhaseAllowed(input, "Fast forward rookie draft", ["DRAFT"]);
  const draft = input.rookieDraft;
  if (!draft) throw new Error("Rookie Draft is not prepared");
  const pick = draft.pickOrder[draft.currentPickIndex];
  if (!pick || pick.pickNumber !== expectedPickNumber) throw new Error("Draft pick has changed; refresh and try again");
  if (pick.ownerTeamId === input.userTeamId) throw new Error("Current pick is controlled by the player team");

  const state = structuredClone(input);
  const nextDraft = state.rookieDraft as RookieDraftState;
  while (nextDraft.currentPickIndex < nextDraft.pickOrder.length) {
    const nextPick = nextDraft.pickOrder[nextDraft.currentPickIndex];
    if (nextPick.ownerTeamId === state.userTeamId) break;
    signRookie(state, selectAiProspect(state, nextPick, true), nextPick);
    nextDraft.currentPickIndex += 1;
  }
  if (nextDraft.currentPickIndex === nextDraft.pickOrder.length) completeDraft(state);
  validateRookieDraftState(state);
  return state;
}

export function draftPlayer(input: GameState, playerId: string, expectedPickNumber: number): GameState {
  assertPhaseAllowed(input, "Draft player", ["DRAFT"]);
  const draft = input.rookieDraft;
  if (!draft) throw new Error("Rookie Draft is not prepared");
  const pick = draft.pickOrder[draft.currentPickIndex];
  if (!pick || pick.pickNumber !== expectedPickNumber) throw new Error("Draft pick has changed; refresh and try again");
  if (pick.ownerTeamId !== input.userTeamId) throw new Error("Current pick is not controlled by the player team");
  if (!draft.classPlayerIds.includes(playerId) || input.players[playerId]?.teamId !== "FREE_AGENT") throw new Error("Prospect is not available");
  const state = structuredClone(input);
  const nextDraft = state.rookieDraft as RookieDraftState;
  signRookie(state, state.players[playerId], nextDraft.pickOrder[nextDraft.currentPickIndex]);
  nextDraft.currentPickIndex += 1;
  if (nextDraft.currentPickIndex === nextDraft.pickOrder.length) completeDraft(state);
  validateRookieDraftState(state);
  return state;
}

function publicProspect(player: Player): DraftProspectView {
  return {
    id: player.id,
    name: player.name,
    age: player.age,
    position: player.position,
    secondaryPosition: player.secondaryPosition,
    heightCm: player.heightCm,
    weightKg: player.weightKg,
    attributes: player.attributes,
    scoutedPotentialGrade: player.scoutedPotentialGrade,
    scoutingConfidence: player.scoutingConfidence,
    traits: player.traits,
  };
}

export function getAvailableDraftProspects(state: GameState): DraftProspectView[] {
  if (!state.rookieDraft) return [];
  const teamId = state.rookieDraft.pickOrder[state.rookieDraft.currentPickIndex]?.ownerTeamId ?? state.userTeamId;
  return availableProspects(state).sort((left, right) =>
    publicDraftScore(right, teamId, state) - publicDraftScore(left, teamId, state) || left.id.localeCompare(right.id)).map(publicProspect);
}

export function validateRookieDraftState(state: GameState): void {
  const draft = state.rookieDraft;
  if (!draft) return;
  if (draft.classPlayerIds.length !== BALANCE_CONFIG.draft.classSize || new Set(draft.classPlayerIds).size !== BALANCE_CONFIG.draft.classSize) throw new Error(`Draft class must contain ${BALANCE_CONFIG.draft.classSize} unique prospects`);
  const expectedPicks = Object.keys(state.teams).length * BALANCE_CONFIG.draft.rounds;
  if (draft.pickOrder.length !== expectedPicks) throw new Error(`Rookie Draft must contain ${expectedPicks} picks`);
  if (draft.currentPickIndex !== draft.pickOrder.filter((pick) => pick.playerId).length) throw new Error("Draft cursor does not match committed picks");
  const pickedIds = draft.pickOrder.flatMap((pick) => pick.playerId ? [pick.playerId] : []);
  if (new Set(pickedIds).size !== pickedIds.length) throw new Error("A prospect was drafted more than once");
  if (draft.completed && pickedIds.length !== expectedPicks) throw new Error(`Completed Draft does not contain ${expectedPicks} selections`);
  for (const team of Object.values(state.teams)) if (team.playerIds.length > LEAGUE_FINANCE_CONFIG.rosterLimits.offseasonMaximum) throw new Error(`${team.id} exceeds offseason roster limit`);
}

export function executeDraftCommand(state: GameState, command: DraftCommand): GameState {
  const payloadHash = stableHash(command.type, command.payload);
  const receipt = state.commandReceipts[command.commandId];
  if (receipt) {
    if (receipt.payloadHash !== payloadHash) throw new Error("Command ID 已被不同 Payload 使用");
    return state;
  }
  const next = command.type === "PREPARE_ROOKIE_DRAFT"
    ? prepareRookieDraft(state)
    : command.type === "REVEAL_DRAFT_PROSPECT"
      ? revealDraftProspect(state, command.payload.playerId)
    : command.type === "ADVANCE_ROOKIE_DRAFT_AI_PICK"
      ? advanceRookieDraftAiPick(state, command.payload.expectedPickNumber)
      : command.type === "FAST_FORWARD_ROOKIE_DRAFT"
        ? fastForwardRookieDraft(state, command.payload.expectedPickNumber)
      : draftPlayer(state, command.payload.playerId, command.payload.expectedPickNumber);
  next.commandReceipts[command.commandId] = { payloadHash };
  return next;
}
