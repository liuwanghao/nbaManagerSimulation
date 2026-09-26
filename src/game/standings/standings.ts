import { stableHash } from "../random/hash";
import type { Division, GameResult, StandingRecord, Team } from "../state/types";

const ratio = (wins: number, losses: number): number => wins + losses === 0 ? 0 : wins / (wins + losses);

export function applyResultToStandings(
  standings: Record<string, StandingRecord>,
  teams: Record<string, Team>,
  result: GameResult,
): void {
  const home = standings[result.homeTeamId];
  const away = standings[result.awayTeamId];
  const homeWon = result.winnerTeamId === result.homeTeamId;
  home.wins += homeWon ? 1 : 0;
  home.losses += homeWon ? 0 : 1;
  home.homeWins += homeWon ? 1 : 0;
  home.homeLosses += homeWon ? 0 : 1;
  away.wins += homeWon ? 0 : 1;
  away.losses += homeWon ? 1 : 0;
  away.awayWins += homeWon ? 0 : 1;
  away.awayLosses += homeWon ? 1 : 0;
  home.pointsFor += result.homeScore;
  home.pointsAgainst += result.awayScore;
  away.pointsFor += result.awayScore;
  away.pointsAgainst += result.homeScore;
  const sameConference = teams[home.teamId].conference === teams[away.teamId].conference;
  const sameDivision = teams[home.teamId].division === teams[away.teamId].division;
  if (sameConference) {
    home.conferenceWins += homeWon ? 1 : 0;
    home.conferenceLosses += homeWon ? 0 : 1;
    away.conferenceWins += homeWon ? 0 : 1;
    away.conferenceLosses += homeWon ? 1 : 0;
  }
  if (sameDivision) {
    home.divisionWins += homeWon ? 1 : 0;
    home.divisionLosses += homeWon ? 0 : 1;
    away.divisionWins += homeWon ? 0 : 1;
    away.divisionLosses += homeWon ? 1 : 0;
  }
  home.headToHead[away.teamId] ??= { wins: 0, losses: 0 };
  away.headToHead[home.teamId] ??= { wins: 0, losses: 0 };
  home.headToHead[away.teamId].wins += homeWon ? 1 : 0;
  home.headToHead[away.teamId].losses += homeWon ? 0 : 1;
  away.headToHead[home.teamId].wins += homeWon ? 0 : 1;
  away.headToHead[home.teamId].losses += homeWon ? 1 : 0;
}

function tieMetrics(
  candidate: StandingRecord,
  remaining: StandingRecord[],
  teams: Record<string, Team>,
  seasonSeed: string,
): number[] {
  let combinedWins = 0;
  let combinedLosses = 0;
  for (const opponent of remaining) {
    if (opponent.teamId === candidate.teamId) continue;
    const record = candidate.headToHead[opponent.teamId];
    combinedWins += record?.wins ?? 0;
    combinedLosses += record?.losses ?? 0;
  }
  const allSameDivision = remaining.every((record) => teams[record.teamId].division === teams[candidate.teamId].division);
  const draw = Number.parseInt(stableHash(seasonSeed, "standings_tiebreak", remaining.map((record) => record.teamId).sort(), candidate.teamId).slice(-8), 16);
  return [
    ratio(combinedWins, combinedLosses),
    allSameDivision ? ratio(candidate.divisionWins, candidate.divisionLosses) : -1,
    ratio(candidate.conferenceWins, candidate.conferenceLosses),
    candidate.pointsFor - candidate.pointsAgainst,
    draw,
  ];
}

function compareMetrics(left: number[], right: number[]): number {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return right[index] - left[index];
  }
  return 0;
}

function resolveTieGroup(
  records: StandingRecord[],
  teams: Record<string, Team>,
  seasonSeed: string,
): StandingRecord[] {
  const remaining = [...records];
  const resolved: StandingRecord[] = [];
  while (remaining.length > 0) {
    const ranked = [...remaining].sort((a, b) => {
      const metric = compareMetrics(tieMetrics(a, remaining, teams, seasonSeed), tieMetrics(b, remaining, teams, seasonSeed));
      return metric || a.teamId.localeCompare(b.teamId);
    });
    const selected = ranked[0];
    resolved.push(selected);
    remaining.splice(remaining.findIndex((record) => record.teamId === selected.teamId), 1);
  }
  return resolved;
}

function resolveStandings(records: StandingRecord[], teams: Record<string, Team>, seasonSeed: string): StandingRecord[] {
  const byWins = new Map<number, StandingRecord[]>();
  for (const record of records) {
    const group = byWins.get(record.wins) ?? [];
    group.push(record);
    byWins.set(record.wins, group);
  }
  return [...byWins.entries()]
    .sort(([left], [right]) => right - left)
    .flatMap(([, group]) => group.length === 1 ? group : resolveTieGroup(group, teams, seasonSeed));
}

export function resolveConferenceStandings(
  conference: "WEST" | "EAST",
  standings: Record<string, StandingRecord>,
  teams: Record<string, Team>,
  seasonSeed: string,
): StandingRecord[] {
  return resolveStandings(Object.values(standings).filter((record) => teams[record.teamId].conference === conference), teams, seasonSeed);
}

export function resolveDivisionStandings(
  division: Division,
  standings: Record<string, StandingRecord>,
  teams: Record<string, Team>,
  seasonSeed: string,
): StandingRecord[] {
  return resolveStandings(Object.values(standings).filter((record) => teams[record.teamId].division === division), teams, seasonSeed);
}
