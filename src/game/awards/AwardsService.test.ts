import { describe, expect, it } from "vitest";
import { createCareer } from "../season/career";
import { simulateGame } from "../simulation/simulateGame";
import { createExpansionCareerFromBundledDataset } from "../../data/hupuRoster";
import { emptyPlayerSeasonStats } from "../state/types";
import { finalizeFinalsAwards, finalizeRegularSeasonAwards, getAwardRace, getGameMvpStat, getLeagueLeaders } from "./AwardsService";

describe("AwardsService", () => {
  it("selects two 12-player All-Star rosters and every required regular-season award idempotently", () => {
    const state = createCareer("awards-regular-season");
    for (const player of Object.values(state.players)) {
      player.seasonStats.games = 82;
      player.seasonStats.seconds = 82 * 20 * 60;
      player.seasonStats.pts = 82 * 8;
      player.seasonStats.reb = 82 * 3;
      player.seasonStats.ast = 82 * 2;
    }
    const starId = state.teams.SEA.playerIds[0];
    const star = state.players[starId];
    star.age = 22;
    star.serviceYears = 1;
    star.seasonStats.pts = 82 * 34;
    star.seasonStats.reb = 82 * 11;
    star.seasonStats.ast = 82 * 10;
    star.seasonStats.stl = 82 * 3;
    star.seasonStats.blk = 82 * 3;
    const breakout = state.players[state.teams.SEA.playerIds[1]];
    breakout.seasonStats.pts = 82 * 15;
    breakout.career = {
      seasonsPlayed: 1, totals: emptyPlayerSeasonStats(), peakOverall: 70, peakImpact: 70,
      unemployedGameDays: 0, unemployedLeagueYears: 0, careerInjuryGamesMissed: 0,
      lastSeasonStats: { ...emptyPlayerSeasonStats(), games: 82, pts: 82 * 5, reb: 82 * 3, ast: 82 * 2 },
    };
    state.standings.SEA.wins = 70;
    state.standings.SEA.losses = 12;

    expect(getAwardRace(state, "MVP", 5)[0].id).toBe(starId);
    const awarded = finalizeRegularSeasonAwards(state);
    const record = awarded.history.seasonAwards[0];
    expect(record.allStars.WEST).toHaveLength(12);
    expect(record.allStars.EAST).toHaveLength(12);
    expect(record.winners.MVP).toBe(starId);
    expect(record.winners.MIP).toBe(breakout.id);
    for (const award of ["MVP", "DPOY", "ROY", "MIP", "SIXTH_MAN"] as const) expect(record.winners[award]).toBeTruthy();
    const honorCount = awarded.players[starId].career?.honors?.allStar;
    const replayed = finalizeRegularSeasonAwards(awarded);
    expect(replayed.players[starId].career?.honors?.allStar).toBe(honorCount);
  });

  it("does not mistake a star's total production for year-over-year improvement", () => {
    const state = createCareer("awards-mip-comparison");
    for (const player of Object.values(state.players)) player.seasonStats.games = 0;
    const [star, breakout] = state.teams.SEA.playerIds.slice(0, 2).map((id) => state.players[id]);
    star.seasonStats = { ...star.seasonStats, games: 82, pts: 82 * 35, reb: 82 * 10, ast: 82 * 9 };
    expect(getAwardRace(state, "MIP")).toEqual([]);
    expect(finalizeRegularSeasonAwards(state).history.seasonAwards[0].winners.MIP).toBeUndefined();

    star.career = {
      seasonsPlayed: 1, totals: emptyPlayerSeasonStats(), peakOverall: 90, peakImpact: 90,
      unemployedGameDays: 0, unemployedLeagueYears: 0, careerInjuryGamesMissed: 0,
      lastSeasonStats: { ...emptyPlayerSeasonStats(), games: 82, pts: 82 * 34, reb: 82 * 10, ast: 82 * 9 },
    };
    breakout.seasonStats = { ...breakout.seasonStats, games: 82, pts: 82 * 18, reb: 82 * 5, ast: 82 * 4 };
    breakout.career = {
      seasonsPlayed: 1, totals: emptyPlayerSeasonStats(), peakOverall: 70, peakImpact: 70,
      unemployedGameDays: 0, unemployedLeagueYears: 0, careerInjuryGamesMissed: 0,
      lastSeasonStats: { ...emptyPlayerSeasonStats(), games: 82, pts: 82 * 8, reb: 82 * 5, ast: 82 * 4 },
    };
    expect(getAwardRace(state, "MIP").map((player) => player.id)).toEqual([breakout.id]);
    expect(finalizeRegularSeasonAwards(state).history.seasonAwards[0].winners.MIP).toBe(breakout.id);
  });

  it("requires an MVP candidate's team to finish in the conference top six", () => {
    const state = createCareer("awards-mvp-standings");
    const eastTeams = Object.values(state.teams).filter((team) => team.conference === "EAST");
    for (const player of Object.values(state.players)) player.seasonStats.games = 0;
    eastTeams.forEach((team, index) => {
      state.standings[team.id].wins = index < 6 ? 60 - index : index === 6 ? 43 : 20;
      state.standings[team.id].losses = 82 - state.standings[team.id].wins;
    });
    const leader = state.players[eastTeams[0].playerIds[0]];
    const seventhPlaceStar = state.players[eastTeams[6].playerIds[0]];
    leader.seasonStats = { ...leader.seasonStats, games: 82, pts: 82 * 27, reb: 82 * 7, ast: 82 * 8 };
    seventhPlaceStar.seasonStats = { ...seventhPlaceStar.seasonStats, games: 82, pts: 82 * 40, reb: 82 * 12, ast: 82 * 12 };

    expect(getAwardRace(state, "MVP").map((player) => player.id)).toEqual([leader.id]);
    expect(finalizeRegularSeasonAwards(state).history.seasonAwards[0].winners.MVP).toBe(leader.id);
  });

  it("lets a substantially better team record decide MVP between top-six players", () => {
    const state = createCareer("awards-mvp-team-wins");
    const eastTeams = Object.values(state.teams).filter((team) => team.conference === "EAST");
    for (const player of Object.values(state.players)) player.seasonStats.games = 0;
    eastTeams.forEach((team, index) => {
      state.standings[team.id].wins = index < 6 ? 62 - index * 3 : 30;
      state.standings[team.id].losses = 82 - state.standings[team.id].wins;
    });
    const topSeedStar = state.players[eastTeams[0].playerIds[0]];
    const sixthSeedStar = state.players[eastTeams[5].playerIds[0]];
    topSeedStar.seasonStats = { ...topSeedStar.seasonStats, games: 82, pts: 82 * 25, reb: 82 * 8, ast: 82 * 8 };
    sixthSeedStar.seasonStats = { ...sixthSeedStar.seasonStats, games: 82, pts: 82 * 30, reb: 82 * 8, ast: 82 * 8 };

    expect(getAwardRace(state, "MVP")[0].id).toBe(topSeedStar.id);
  });

  it("excludes Flagg from 2026-27 Rookie of the Year despite his production", () => {
    const state = createExpansionCareerFromBundledDataset("awards-real-rookies");
    const flagg = state.players["nba:1642843"];
    const rookie = Object.values(state.players).find((player) => state.teams[player.teamId] && player.serviceYears === 0);
    if (!flagg || !rookie) throw new Error("opening roster is missing a rookie or Flagg");
    expect(state.league.seasonId).toBe("2026-27");
    expect(flagg.serviceYears).toBe(1);
    for (const player of Object.values(state.players)) player.seasonStats.games = 0;
    flagg.seasonStats = { ...flagg.seasonStats, games: 82, pts: 82 * 40 };
    rookie.seasonStats = { ...rookie.seasonStats, games: 82, pts: 82 * 15 };

    expect(getAwardRace(state, "ROY").map((player) => player.id)).toEqual([rookie.id]);
    const awarded = finalizeRegularSeasonAwards(state);
    expect(awarded.history.seasonAwards[0].winners.ROY).toBe(rookie.id);
    awarded.players[rookie.id].career!.seasonsPlayed = 1;
    expect(getAwardRace(awarded, "ROY")).toEqual([]);
  });

  it("records a champion and Finals MVP from the winning-team box scores", () => {
    const state = createCareer("awards-finals");
    const game = state.schedule[0];
    const result = simulateGame(game, state.teams[game.homeTeamId], state.teams[game.awayTeamId], state.players, state.seeds.seasonSeed, true);
    const winningBox = result.winnerTeamId === result.homeTeamId ? result.homeBoxScore : result.awayBoxScore;
    const forcedMvp = winningBox?.playerStats[0];
    if (!forcedMvp) throw new Error("detailed box score missing");
    forcedMvp.pts = 999;
    expect(getGameMvpStat(result)?.playerId).toBe(forcedMvp.playerId);
    finalizeFinalsAwards(state, result.winnerTeamId, [result]);
    const record = state.history.seasonAwards[0];
    const finalsMvp = record.winners.FINALS_MVP as string;
    expect(state.teams[result.winnerTeamId].playerIds).toContain(finalsMvp);
    expect(state.players[finalsMvp].career?.honors?.finalsMvp).toBe(1);
    expect(state.teams[result.winnerTeamId].playerIds.every((id) => state.players[id].career?.honors?.championships === 1)).toBe(true);
  });

  it("selects the postgame MVP from the winner even when a losing player scores more", () => {
    const state = createCareer("awards-postgame-winner");
    const scheduled = state.schedule[0];
    const result = simulateGame(scheduled, state.teams[scheduled.homeTeamId], state.teams[scheduled.awayTeamId], state.players, state.seeds.seasonSeed, true);
    const winnerBox = result.winnerTeamId === result.homeTeamId ? result.homeBoxScore : result.awayBoxScore;
    const loserBox = result.winnerTeamId === result.homeTeamId ? result.awayBoxScore : result.homeBoxScore;
    const winningPlayer = winnerBox?.playerStats[0];
    const losingPlayer = loserBox?.playerStats[0];
    if (!winningPlayer || !losingPlayer) throw new Error("detailed box scores missing");
    winningPlayer.pts = 999;
    losingPlayer.pts = 2000;

    const mirroredResult = {
      ...result,
      homeTeamId: result.awayTeamId,
      awayTeamId: result.homeTeamId,
      homeScore: result.awayScore,
      awayScore: result.homeScore,
      homeBoxScore: result.awayBoxScore,
      awayBoxScore: result.homeBoxScore,
    };
    expect(getGameMvpStat(result)?.playerId).toBe(winningPlayer.playerId);
    expect(getGameMvpStat(mirroredResult)?.playerId).toBe(winningPlayer.playerId);
    expect(getGameMvpStat({ ...result, [result.winnerTeamId === result.homeTeamId ? "homeBoxScore" : "awayBoxScore"]: undefined })).toBeUndefined();
  });

  it("calculates qualified per-game league leaders in the engine", () => {
    const state = createCareer("awards-league-leaders");
    const players = Object.values(state.players);
    for (const player of players) {
      player.seasonStats.games = 10;
      player.seasonStats.pts = 100;
      player.seasonStats.reb = 50;
      player.seasonStats.ast = 30;
    }
    const pointsLeader = players[0];
    const reboundsLeader = players[1];
    const assistsLeader = players[2];
    const unqualifiedScorer = players[3];
    pointsLeader.seasonStats.pts = 300;
    reboundsLeader.seasonStats.reb = 200;
    assistsLeader.seasonStats.ast = 150;
    unqualifiedScorer.seasonStats.games = 9;
    unqualifiedScorer.seasonStats.pts = 900;

    const leaders = getLeagueLeaders(state);
    expect(leaders.points?.id).toBe(pointsLeader.id);
    expect(leaders.rebounds?.id).toBe(reboundsLeader.id);
    expect(leaders.assists?.id).toBe(assistsLeader.id);
  });
});
