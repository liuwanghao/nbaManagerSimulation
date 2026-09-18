import { describe, expect, it } from "vitest";
import { stableHash, stableSerialize } from "../random/hash";
import { advanceSeason, createCareer, simulateNextGameDay, simulateRegularSeason, simulateToNextEvent } from "./career";

describe("season loop", () => {
  it("advances the whole league clock through the user's next game", () => {
    const initial = createCareer("next-user-game");
    const next = simulateNextGameDay(initial);
    expect(Object.keys(next.userGameDetails)).toHaveLength(1);
    expect(next.lightweightResults.length).toBeGreaterThan(1);
    expect(next.calendar.currentDateIndex).toBeGreaterThan(0);
  });

  it("stops batch simulation when the next manager-facing event is queued", () => {
    const initial = createCareer("next-event");
    const next = simulateToNextEvent(initial);
    expect(Object.keys(next.userGameDetails).length).toBeGreaterThan(0);
    expect(Object.keys(next.userGameDetails).length).toBeLessThanOrEqual(82);
    expect(next.eventState.queue.some((event) => event.status === "PENDING")
      || Boolean(next.injuryState.pendingUserMajorInjury)
      || Boolean(next.injuryState.pendingEmergencyRoster)
      || next.schedule.every((game) => game.status === "FINAL")).toBe(true);
  });

  it("completes 82 games per team and advances into a new season", () => {
    const initial = createCareer("career-flow");
    const completed = simulateRegularSeason(initial, { autoAcknowledgeMajorInjuries: true, autoResolveEmergencyRosters: true, autoResolveEvents: true });
    expect(completed.lightweightResults).toHaveLength(1312);
    for (const record of Object.values(completed.standings)) expect(record.wins + record.losses).toBe(82);
    const nextSeason = advanceSeason(completed);
    expect(nextSeason.league.seasonId).toBe("2027-28");
    expect(nextSeason.league.currentPhase).toBe("REGULAR_PRE_DEADLINE");
    expect(nextSeason.schedule).toHaveLength(1312);
    expect(nextSeason.schedule.every((game) => game.status === "SCHEDULED")).toBe(true);
    expect(nextSeason.history.champions).toHaveLength(1);
    expect(nextSeason.history.seasonAwards).toHaveLength(1);
    expect(nextSeason.history.seasonAwards[0].allStars.WEST).toHaveLength(12);
    expect(nextSeason.history.seasonAwards[0].allStars.EAST).toHaveLength(12);
    expect(nextSeason.history.seasonAwards[0].winners.MVP).toBeTruthy();
    expect(nextSeason.history.seasonAwards[0].winners.FINALS_MVP).toBeTruthy();
    expect(nextSeason.history.seasons).toHaveLength(1);
    expect(nextSeason.history.seasons[0].regularSeasonResults).toHaveLength(1312);
    expect(Object.keys(nextSeason.history.seasons[0].userRegularGameDetails)).toHaveLength(82);
    expect(Object.keys(nextSeason.history.seasons[0].postseasonGameDetails).length).toBeGreaterThan(50);
    expect(nextSeason.history.seasons[0].regularSeasonResults.every((game) => !game.homeBoxScore && !game.awayBoxScore)).toBe(true);
    expect(Object.values(nextSeason.players).some((player) => (player.career?.lastSeasonStats?.games ?? 0) === 82)).toBe(true);
    expect(Object.values(nextSeason.players).every((player) => player.postseasonStats?.games === 0)).toBe(true);
    expect(nextSeason.gmCareer.seasons).toBe(1);
    expect(nextSeason.gmCareer.regularSeasonWins + nextSeason.gmCareer.regularSeasonLosses).toBe(82);
    expect(nextSeason.achievements.FIRST_WIN.unlocked).toBe(true);
    expect(nextSeason.achievements.TEN_WINS.unlocked).toBe(true);
  });

  it("replays a full regular season from the same seed", () => {
    const first = simulateRegularSeason(createCareer("career-replay"), { autoAcknowledgeMajorInjuries: true, autoResolveEmergencyRosters: true, autoResolveEvents: true });
    const second = simulateRegularSeason(createCareer("career-replay"), { autoAcknowledgeMajorInjuries: true, autoResolveEmergencyRosters: true, autoResolveEvents: true });
    expect(stableHash(stableSerialize(first))).toBe(stableHash(stableSerialize(second)));
  }, 60_000);
});
