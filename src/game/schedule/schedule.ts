import { TEAM_DEFINITIONS } from "../../data/league";
import { stableHash } from "../random/hash";
import { createRng } from "../random/xoshiro";
import { BALANCE_CONFIG } from "../../config/balanceConfig";
import type { Conference, ScheduleGame, Team } from "../state/types";

interface DraftGame {
  homeTeamId: string;
  awayTeamId: string;
}

export interface ScheduleValidationReport {
  valid: boolean;
  errors: string[];
  b2bByTeam: Record<string, number>;
  maxHomeStreakByTeam: Record<string, number>;
  maxAwayStreakByTeam: Record<string, number>;
}

const pairKey = (a: string, b: string): string => [a, b].sort().join("::");

const conferenceDivisionIds = (conference: Conference): string[][] => {
  const conferenceTeams = TEAM_DEFINITIONS.filter((team) => team.conference === conference);
  const divisions = [...new Set(conferenceTeams.map((team) => team.division))];
  return divisions.map((division) => conferenceTeams.filter((team) => team.division === division).map((team) => team.id));
};

const DIVISION_CYCLES: Array<Array<[number, number]>> = [
  [[0, 1], [1, 2], [2, 3], [3, 0]],
  [[0, 1], [1, 3], [3, 2], [2, 0]],
  [[0, 2], [2, 1], [1, 3], [3, 0]],
];

function divisionPairKey(a: number, b: number): string {
  return [a, b].sort((left, right) => left - right).join("-");
}

function fourGamePairsForConference(conference: Conference, cycleYear: number): Set<string> {
  const divisions = conferenceDivisionIds(conference);
  const cycle = DIVISION_CYCLES[cycleYear % 3];
  const selected = new Set<string>();

  for (const [rawA, rawB] of cycle) {
    const [divisionA, divisionB] = rawA < rawB ? [rawA, rawB] : [rawB, rawA];
    const key = divisionPairKey(divisionA, divisionB);
    let priorAppearances = 0;
    for (let year = 0; year < cycleYear; year += 1) {
      if (DIVISION_CYCLES[year % 3].some(([a, b]) => divisionPairKey(a, b) === key)) priorAppearances += 1;
    }
    const shift = priorAppearances % 4;
    for (let slot = 0; slot < 4; slot += 1) {
      selected.add(pairKey(divisions[divisionA][slot], divisions[divisionB][(slot + shift) % 4]));
    }
  }

  return selected;
}

function orientEvenGraph(teamIds: string[], undirectedEdges: Array<[string, string]>): Map<string, string> {
  const adjacency = new Map<string, Array<{ edgeIndex: number; other: string }>>();
  teamIds.forEach((id) => adjacency.set(id, []));
  undirectedEdges.forEach(([a, b], edgeIndex) => {
    adjacency.get(a)?.push({ edgeIndex, other: b });
    adjacency.get(b)?.push({ edgeIndex, other: a });
  });
  adjacency.forEach((entries) => entries.sort((a, b) => a.other.localeCompare(b.other)));

  const used = new Set<number>();
  const orientation = new Map<string, string>();
  for (const start of [...teamIds].sort()) {
    if ((adjacency.get(start) ?? []).every((edge) => used.has(edge.edgeIndex))) continue;
    const stack = [start];
    const circuit: string[] = [];
    while (stack.length > 0) {
      const vertex = stack[stack.length - 1];
      const edge = (adjacency.get(vertex) ?? []).find((candidate) => !used.has(candidate.edgeIndex));
      if (edge) {
        used.add(edge.edgeIndex);
        stack.push(edge.other);
      } else {
        circuit.push(stack.pop() as string);
      }
    }
    circuit.reverse();
    for (let index = 0; index < circuit.length - 1; index += 1) {
      orientation.set(pairKey(circuit[index], circuit[index + 1]), circuit[index]);
    }
  }
  return orientation;
}

function buildGameDrafts(teams: Record<string, Team>, cycleYear: number, scheduleSeed: string): DraftGame[] {
  const fourGamePairs = new Set([
    ...fourGamePairsForConference("WEST", cycleYear),
    ...fourGamePairsForConference("EAST", cycleYear),
  ]);
  const threeGameEdges: Array<[string, string]> = [];
  const ids = Object.keys(teams).sort();
  for (let left = 0; left < ids.length; left += 1) {
    for (let right = left + 1; right < ids.length; right += 1) {
      const a = teams[ids[left]];
      const b = teams[ids[right]];
      if (a.conference === b.conference && a.division !== b.division && !fourGamePairs.has(pairKey(a.id, b.id))) {
        threeGameEdges.push([a.id, b.id]);
      }
    }
  }

  const orientations = new Map<string, string>();
  for (const conference of ["WEST", "EAST"] as const) {
    const conferenceIds = ids.filter((id) => teams[id].conference === conference);
    const conferenceEdges = threeGameEdges.filter(([a]) => teams[a].conference === conference);
    for (const [key, homeHeavy] of orientEvenGraph(conferenceIds, conferenceEdges)) orientations.set(key, homeHeavy);
  }

  const drafts: DraftGame[] = [];
  for (let left = 0; left < ids.length; left += 1) {
    for (let right = left + 1; right < ids.length; right += 1) {
      const a = teams[ids[left]];
      const b = teams[ids[right]];
      const sameDivision = a.division === b.division;
      const sameConference = a.conference === b.conference;
      const games = sameDivision ? 4 : sameConference ? (fourGamePairs.has(pairKey(a.id, b.id)) ? 4 : 3) : 2;
      if (games === 3) {
        const homeHeavy = orientations.get(pairKey(a.id, b.id));
        const other = homeHeavy === a.id ? b.id : a.id;
        drafts.push({ homeTeamId: homeHeavy as string, awayTeamId: other });
        drafts.push({ homeTeamId: homeHeavy as string, awayTeamId: other });
        drafts.push({ homeTeamId: other, awayTeamId: homeHeavy as string });
      } else {
        for (let game = 0; game < games / 2; game += 1) {
          drafts.push({ homeTeamId: a.id, awayTeamId: b.id });
          drafts.push({ homeTeamId: b.id, awayTeamId: a.id });
        }
      }
    }
  }
  return createRng(stableHash(scheduleSeed, "draft_order")).shuffle(drafts);
}

function circleRounds(teamIds: string[]): Array<Array<[string, string]>> {
  let rotation = [...teamIds];
  const rounds: Array<Array<[string, string]>> = [];
  for (let round = 0; round < teamIds.length - 1; round += 1) {
    const pairs: Array<[string, string]> = [];
    for (let index = 0; index < teamIds.length / 2; index += 1) {
      pairs.push([rotation[index], rotation[teamIds.length - 1 - index]]);
    }
    rounds.push(pairs);
    rotation = [rotation[0], rotation[rotation.length - 1], ...rotation.slice(1, -1)];
  }
  return rounds;
}

const FOUR_TEAM_FACTORS: Array<Array<[number, number]>> = [
  [[0, 1], [2, 3]],
  [[0, 2], [1, 3]],
  [[0, 3], [1, 2]],
];

function alternatingCycleMatchings(teamIds: string[], selectedPairs: Set<string>): Array<Array<[string, string]>> {
  const adjacency = new Map<string, string[]>();
  teamIds.forEach((id) => adjacency.set(id, []));
  for (const key of selectedPairs) {
    const [a, b] = key.split("::");
    if (!adjacency.has(a) || !adjacency.has(b)) continue;
    adjacency.get(a)?.push(b);
    adjacency.get(b)?.push(a);
  }
  const visited = new Set<string>();
  const matchings: Array<Array<[string, string]>> = [[], []];
  for (const start of [...teamIds].sort()) {
    if (visited.has(start)) continue;
    const cycle: string[] = [start];
    let previous = "";
    let current = start;
    while (true) {
      visited.add(current);
      const neighbors = (adjacency.get(current) ?? []).sort();
      if (neighbors.length !== 2) throw new Error(`Four-game rotation degree is not 2 for ${current}`);
      const next = neighbors[0] === previous ? neighbors[1] : neighbors[0];
      if (next === start) break;
      cycle.push(next);
      previous = current;
      current = next;
    }
    if (cycle.length % 2 !== 0) throw new Error("Four-game rotation produced an odd cycle");
    for (let index = 0; index < cycle.length; index += 1) {
      matchings[index % 2].push([cycle[index], cycle[(index + 1) % cycle.length]]);
    }
  }
  return matchings;
}

function decomposeIntoRounds(
  teams: Record<string, Team>,
  teamIds: string[],
  drafts: DraftGame[],
  seed: string,
): DraftGame[][] {
  const buckets = new Map<string, DraftGame[]>();
  for (const draft of drafts) {
    const key = pairKey(draft.homeTeamId, draft.awayTeamId);
    const bucket = buckets.get(key) ?? [];
    bucket.push(draft);
    buckets.set(key, bucket);
  }
  const rng = createRng(stableHash(seed, "round_decomposition"));
  for (const [key, bucket] of buckets) buckets.set(key, rng.shuffle(bucket));
  const pairRounds: Array<Array<[string, string]>> = [];

  const base = circleRounds(teamIds);
  pairRounds.push(...base, ...base);

  for (let repeat = 0; repeat < 2; repeat += 1) {
    for (const factor of FOUR_TEAM_FACTORS) {
      const round: Array<[string, string]> = [];
      for (const division of [...new Set(Object.values(teams).map((team) => team.division))]) {
        const divisionTeams = teamIds.filter((id) => teams[id].division === division);
        for (const [left, right] of factor) round.push([divisionTeams[left], divisionTeams[right]]);
      }
      pairRounds.push(round);
    }
  }

  for (const divisionFactor of FOUR_TEAM_FACTORS) {
    for (let shift = 0; shift < 4; shift += 1) {
      const round: Array<[string, string]> = [];
      for (const conference of ["WEST", "EAST"] as const) {
        const divisions = conferenceDivisionIds(conference);
        for (const [leftDivision, rightDivision] of divisionFactor) {
          for (let slot = 0; slot < 4; slot += 1) {
            round.push([divisions[leftDivision][slot], divisions[rightDivision][(slot + shift) % 4]]);
          }
        }
      }
      pairRounds.push(round);
    }
  }

  const extraWest = alternatingCycleMatchings(
    teamIds.filter((id) => teams[id].conference === "WEST"),
    new Set([...buckets.entries()].filter(([key, bucket]) => {
      const [a, b] = key.split("::");
      return bucket.length === 4
        && teams[a].conference === "WEST"
        && teams[b].conference === "WEST"
        && teams[a].division !== teams[b].division;
    }).map(([key]) => key)),
  );
  const extraEast = alternatingCycleMatchings(
    teamIds.filter((id) => teams[id].conference === "EAST"),
    new Set([...buckets.entries()].filter(([key, bucket]) => bucket.length === 4 && key.split("::").every((id) => teams[id].conference === "EAST") && teams[key.split("::")[0]].division !== teams[key.split("::")[1]].division).map(([key]) => key)),
  );
  for (let index = 0; index < 2; index += 1) pairRounds.push([...extraWest[index], ...extraEast[index]]);

  if (pairRounds.length !== 82 || pairRounds.some((round) => round.length !== 16)) {
    throw new Error(`Invalid structural round decomposition: ${pairRounds.length} rounds`);
  }
  return pairRounds.map((matching) => matching.map(([a, b]) => {
    const bucket = buckets.get(pairKey(a, b));
    const game = bucket?.pop();
    if (!game) throw new Error(`Missing matchup bucket for ${a} vs ${b}`);
    return game;
  }).sort((a, b) => pairKey(a.homeTeamId, a.awayTeamId).localeCompare(pairKey(b.homeTeamId, b.awayTeamId))));
}

function streakScore(rounds: DraftGame[][], teamIds: string[]): number {
  let score = 0;
  for (const teamId of teamIds) {
    let state = "";
    let run = 0;
    for (const round of rounds) {
      const game = round.find((entry) => entry.homeTeamId === teamId || entry.awayTeamId === teamId) as DraftGame;
      const next = game.homeTeamId === teamId ? "H" : "A";
      run = next === state ? run + 1 : 1;
      state = next;
      const limit = state === "H" ? BALANCE_CONFIG.scheduleQuality.maximumHomeStreak : BALANCE_CONFIG.scheduleQuality.maximumAwayStreak;
      if (run > limit) score += (run - limit) ** 2;
    }
  }
  return score;
}

function optimizeRoundOrder(rounds: DraftGame[][], teamIds: string[], seed: string): DraftGame[][] {
  const rng = createRng(stableHash(seed, "round_order"));
  let best = [...rounds];
  let bestScore = streakScore(best, teamIds);
  for (let restart = 0; restart < BALANCE_CONFIG.scheduleQuality.optimizerRestarts && bestScore > 0; restart += 1) {
    const candidate = rng.shuffle(rounds);
    let candidateScore = streakScore(candidate, teamIds);
    for (let step = 0; step < BALANCE_CONFIG.scheduleQuality.optimizerSteps && candidateScore > 0; step += 1) {
      const left = rng.int(0, candidate.length - 1);
      const right = rng.int(0, candidate.length - 1);
      if (left === right) continue;
      [candidate[left], candidate[right]] = [candidate[right], candidate[left]];
      const swappedScore = streakScore(candidate, teamIds);
      if (swappedScore <= candidateScore) {
        candidateScore = swappedScore;
      } else {
        [candidate[left], candidate[right]] = [candidate[right], candidate[left]];
      }
    }
    if (candidateScore < bestScore) {
      best = [...candidate];
      bestScore = candidateScore;
    }
  }
  if (bestScore > 0) throw new Error(`Unable to satisfy home/away streak limits; score=${bestScore}`);
  return best;
}

function b2bGapIndexes(rounds: DraftGame[][]): Set<number> {
  const indexes = new Set<number>();
  const targetBackToBacks = BALANCE_CONFIG.scheduleQuality.targetBackToBacks;
  const targetPositions = Array.from({ length: targetBackToBacks }, (_, index) => Math.round(((index + 0.5) * 81) / targetBackToBacks) - 1);
  for (const target of targetPositions) {
    const candidates = Array.from({ length: 81 }, (_, index) => index)
      .filter((index) => !indexes.has(index) && !indexes.has(index - 1) && !indexes.has(index + 1))
      .filter((index) => {
        const previousPairs = new Set(rounds[index].map((game) => pairKey(game.homeTeamId, game.awayTeamId)));
        return rounds[index + 1].every((game) => !previousPairs.has(pairKey(game.homeTeamId, game.awayTeamId)));
      })
      .sort((a, b) => Math.abs(a - target) - Math.abs(b - target) || a - b);
    if (candidates.length === 0) throw new Error("Unable to place 14 back-to-back gaps");
    indexes.add(candidates[0]);
  }
  return indexes;
}

function dateIndexesForRounds(rounds: DraftGame[][]): number[] {
  const b2b = b2bGapIndexes(rounds);
  const gaps = Array.from({ length: 81 }, (_, index) => (b2b.has(index) ? 1 : 2));
  let extraDays = 173 - gaps.reduce((sum, gap) => sum + gap, 0);
  for (let index = 0; index < gaps.length && extraDays > 0; index += 1) {
    if (gaps[index] === 2) {
      gaps[index] += 1;
      extraDays -= 1;
    }
  }
  const dates = [0];
  for (const gap of gaps) dates.push(dates[dates.length - 1] + gap);
  return dates;
}

function isoDate(openingDate: string, dateIndex: number): string {
  const date = new Date(`${openingDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + dateIndex);
  return date.toISOString().slice(0, 10);
}

export function generateSchedule(
  teams: Record<string, Team>,
  seasonId: string,
  openingDate: string,
  cycleYear: number,
  scheduleSeed: string,
): ScheduleGame[] {
  const teamIds = Object.keys(teams).sort();
  const drafts = buildGameDrafts(teams, cycleYear, scheduleSeed);
  const rounds = optimizeRoundOrder(decomposeIntoRounds(teams, teamIds, drafts, scheduleSeed), teamIds, scheduleSeed);
  const roundDates = dateIndexesForRounds(rounds);
  const ordinals = new Map<string, number>();
  const games: ScheduleGame[] = [];

  rounds.forEach((round, roundIndex) => {
    for (const draft of round) {
      const homeAwayKey = `${draft.homeTeamId}::${draft.awayTeamId}`;
      const matchupOrdinal = (ordinals.get(homeAwayKey) ?? 0) + 1;
      ordinals.set(homeAwayKey, matchupOrdinal);
      games.push({
        id: stableHash(seasonId, draft.homeTeamId, draft.awayTeamId, matchupOrdinal),
        seasonId,
        dateIndex: roundDates[roundIndex],
        date: isoDate(openingDate, roundDates[roundIndex]),
        homeTeamId: draft.homeTeamId,
        awayTeamId: draft.awayTeamId,
        matchupOrdinal,
        status: "SCHEDULED",
      });
    }
  });

  return games.sort((a, b) => a.dateIndex - b.dateIndex || a.id.localeCompare(b.id));
}

function longestRun(sequence: string[], value: string): number {
  let longest = 0;
  let current = 0;
  for (const item of sequence) {
    current = item === value ? current + 1 : 0;
    longest = Math.max(longest, current);
  }
  return longest;
}

export function validateSchedule(games: ScheduleGame[], teams: Record<string, Team>): ScheduleValidationReport {
  const errors: string[] = [];
  const ids = Object.keys(teams).sort();
  const b2bByTeam: Record<string, number> = {};
  const maxHomeStreakByTeam: Record<string, number> = {};
  const maxAwayStreakByTeam: Record<string, number> = {};
  if (games.length !== 1312) errors.push(`Expected 1312 games, received ${games.length}`);
  const finalDateIndex = Math.max(...games.map((game) => game.dateIndex));
  if (games.filter((game) => game.dateIndex === finalDateIndex).length !== 16) errors.push("Final day must contain 16 games");

  for (const teamId of ids) {
    const teamGames = games
      .filter((game) => game.homeTeamId === teamId || game.awayTeamId === teamId)
      .sort((a, b) => a.dateIndex - b.dateIndex);
    const home = teamGames.filter((game) => game.homeTeamId === teamId).length;
    const away = teamGames.length - home;
    if (teamGames.length !== 82) errors.push(`${teamId} has ${teamGames.length} games`);
    if (home !== 41 || away !== 41) errors.push(`${teamId} home/away is ${home}/${away}`);
    const duplicateDate = teamGames.find((game, index) => index > 0 && game.dateIndex === teamGames[index - 1].dateIndex);
    if (duplicateDate) errors.push(`${teamId} plays twice on day ${duplicateDate.dateIndex}`);
    let b2b = 0;
    for (let index = 1; index < teamGames.length; index += 1) {
      const gap = teamGames[index].dateIndex - teamGames[index - 1].dateIndex;
      if (gap === 1) b2b += 1;
      if (index >= 2 && teamGames[index].dateIndex - teamGames[index - 2].dateIndex <= 2) errors.push(`${teamId} has 3 games in 3 days`);
      const previousOpponent = teamGames[index - 1].homeTeamId === teamId ? teamGames[index - 1].awayTeamId : teamGames[index - 1].homeTeamId;
      const opponent = teamGames[index].homeTeamId === teamId ? teamGames[index].awayTeamId : teamGames[index].homeTeamId;
      if (previousOpponent === opponent && gap < 2) errors.push(`${teamId} repeats ${opponent} without a rest day`);
    }
    b2bByTeam[teamId] = b2b;
    if (b2b < BALANCE_CONFIG.scheduleQuality.minimumBackToBacks || b2b > BALANCE_CONFIG.scheduleQuality.maximumBackToBacks) errors.push(`${teamId} has ${b2b} B2Bs`);
    const venues = teamGames.map((game) => (game.homeTeamId === teamId ? "H" : "A"));
    maxHomeStreakByTeam[teamId] = longestRun(venues, "H");
    maxAwayStreakByTeam[teamId] = longestRun(venues, "A");
    if (maxHomeStreakByTeam[teamId] > BALANCE_CONFIG.scheduleQuality.maximumHomeStreak) errors.push(`${teamId} home stand exceeds ${BALANCE_CONFIG.scheduleQuality.maximumHomeStreak}`);
    if (maxAwayStreakByTeam[teamId] > BALANCE_CONFIG.scheduleQuality.maximumAwayStreak) errors.push(`${teamId} road trip exceeds ${BALANCE_CONFIG.scheduleQuality.maximumAwayStreak}`);
  }

  return { valid: errors.length === 0, errors, b2bByTeam, maxHomeStreakByTeam, maxAwayStreakByTeam };
}
