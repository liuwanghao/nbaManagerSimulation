import type { Conference, GameResult, GameState } from "../game/state/types";
import { standingsForConference } from "../game/season/career";

export interface PostseasonSeriesView {
  teamA?: string;
  teamB?: string;
  placeholderA?: string;
  placeholderB?: string;
  winsA?: number;
  winsB?: number;
  winner?: string;
}

export interface ConferenceBracketView {
  conference: Conference;
  playIn: PostseasonSeriesView[];
  firstRound: PostseasonSeriesView[];
  semifinals: PostseasonSeriesView[];
  final: PostseasonSeriesView[];
}

export interface PostseasonBracketView {
  conferences: ConferenceBracketView[];
  finals: PostseasonSeriesView[];
  settled: boolean;
}

function previewConference(state: GameState, conference: Conference): ConferenceBracketView {
  const seeds = standingsForConference(state, conference).map((record) => record.teamId);
  const pair = (first: number, second: number): PostseasonSeriesView => ({ teamA: seeds[first], teamB: seeds[second] });
  return {
    conference,
    // Place the eighth-seed decider next to 1 vs 8, and 7 vs 8 next to 2 vs 7.
    playIn: [{ placeholderA: "7/8 负者", placeholderB: "9/10 胜者" }, pair(8, 9), pair(6, 7)],
    firstRound: [
      { teamA: seeds[0], placeholderB: "第 8 席" },
      pair(3, 4),
      { teamA: seeds[1], placeholderB: "第 7 席" },
      pair(2, 5),
    ],
    semifinals: [{ placeholderA: "首轮胜者", placeholderB: "首轮胜者" }, { placeholderA: "首轮胜者", placeholderB: "首轮胜者" }],
    final: [{ placeholderA: "半决赛胜者", placeholderB: "半决赛胜者" }],
  };
}

function seriesFromGames(games: GameResult[]): PostseasonSeriesView {
  const [teamA, teamB] = [games[0].homeTeamId, games[0].awayTeamId];
  const winsA = games.filter((game) => game.winnerTeamId === teamA).length;
  const winsB = games.filter((game) => game.winnerTeamId === teamB).length;
  return { teamA, teamB, winsA, winsB, winner: winsA > winsB ? teamA : teamB };
}

function completedConference(state: GameState, conference: Conference, games: GameResult[]): ConferenceBracketView {
  const groups = new Map<string, GameResult[]>();
  for (const game of games) {
    if (state.teams[game.homeTeamId]?.conference !== conference || state.teams[game.awayTeamId]?.conference !== conference) continue;
    const key = [game.homeTeamId, game.awayTeamId].sort().join("|");
    const group = groups.get(key) ?? [];
    group.push(game);
    groups.set(key, group);
  }
  const ordered = [...groups.values()].sort((left, right) => left[0].date.localeCompare(right[0].date));
  return {
    conference,
    playIn: [ordered[2], ordered[1], ordered[0]].filter(Boolean).map(seriesFromGames),
    firstRound: ordered.slice(3, 7).map(seriesFromGames),
    semifinals: ordered.slice(7, 9).map(seriesFromGames),
    final: ordered.slice(9, 10).map(seriesFromGames),
  };
}

export function postseasonBracket(state: GameState): PostseasonBracketView {
  const archive = state.history.seasons.find((season) => season.seasonId === state.league.seasonId);
  const games = Object.values(archive?.postseasonGameDetails ?? {});
  if (!games.length) {
    return { conferences: [previewConference(state, "EAST"), previewConference(state, "WEST")], finals: [], settled: false };
  }
  const finalsGames = games.filter((game) => state.teams[game.homeTeamId]?.conference !== state.teams[game.awayTeamId]?.conference);
  return {
    conferences: [completedConference(state, "EAST", games), completedConference(state, "WEST", games)],
    finals: finalsGames.length ? [seriesFromGames(finalsGames)] : [],
    settled: true,
  };
}
