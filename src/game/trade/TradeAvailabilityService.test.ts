import { describe, expect, it } from "vitest";
import { createCareer } from "../season/career";
import { createExpansionCareerFromBundledDataset } from "../../data/hupuRoster";
import { isUntouchable, untouchablePlayerIds } from "./TradeAvailabilityService";

describe("TradeAvailabilityService", () => {
  it("always protects the seven named stars while they belong to AI teams", () => {
    const state = createExpansionCareerFromBundledDataset("expansion-era-demo");
    const namedStars = [
      ["nba:203507", "Giannis Antetokounmpo"],
      ["nba:201939", "Stephen Curry"],
      ["nba:202695", "Kawhi Leonard"],
      ["nba:2544", "LeBron James"],
      ["nba:201142", "Kevin Durant"],
      ["nba:203954", "Joel Embiid"],
      ["nba:1627759", "Jaylen Brown"],
    ] as const;
    for (const [id, name] of namedStars) {
      const player = state.players[id];
      expect(player.name).toBe(name);
      expect(isUntouchable(state, id)).toBe(true);
      player.age = 99;
      expect(isUntouchable(state, id)).toBe(true);
    }

    const destination = state.teams.MIA;
    for (const [id] of namedStars) {
      const oldTeam = state.teams[state.players[id].teamId];
      oldTeam.playerIds = oldTeam.playerIds.filter((playerId) => playerId !== id);
      destination.playerIds.push(id);
      state.players[id].teamId = destination.id;
    }
    expect(untouchablePlayerIds(state, destination.id)).toEqual(expect.arrayContaining(namedStars.map(([id]) => id)));
  });

  it("preserves the top ranked player when a team has three named untouchables", () => {
    const state = createExpansionCareerFromBundledDataset("expansion-era-demo");
    const counts = Object.values(state.teams).map((team) => untouchablePlayerIds(state, team.id).length);
    expect(counts.some((count) => count === 2)).toBe(true);
    expect(counts.some((count) => count === 3)).toBe(true);
    expect(counts.every((count) => count <= 4)).toBe(true);
    expect(untouchablePlayerIds(state, "PHI")).toEqual(expect.arrayContaining([
      "nba:2544", // LeBron James
      "nba:203954", // Joel Embiid
      "nba:1627759", // Jaylen Brown
      "nba:1630178", // Tyrese Maxey
    ]));
  });

  it("selects zero to three AI players deterministically from public data and team direction", () => {
    const state = createCareer("sample");
    const counts = Object.values(state.teams).map((team) => untouchablePlayerIds(state, team.id).length);
    expect(Math.max(...counts)).toBe(3);
    expect(counts.some((count) => count === 2)).toBe(true);
    expect(counts.some((count) => count === 0)).toBe(true);
    expect(untouchablePlayerIds(state, state.userTeamId)).toEqual([]);

    const protectedId = untouchablePlayerIds(state, "MIA")[0];
    const roundTrip = JSON.parse(JSON.stringify(state)) as typeof state;
    expect(isUntouchable(roundTrip, protectedId)).toBe(true);
    roundTrip.players[protectedId].teamRole = "BENCH";
    roundTrip.players[protectedId].truePotential = 25;
    expect(isUntouchable(roundTrip, protectedId)).toBe(true);
  });

  it("recalculates protection from the current holder after a roster move", () => {
    const state = createCareer("sample");
    const playerId = untouchablePlayerIds(state, "MIA")[0];
    expect(isUntouchable(state, playerId)).toBe(true);
    state.teams.MIA.playerIds = state.teams.MIA.playerIds.filter((id) => id !== playerId);
    state.teams.PHI.playerIds.push(playerId);
    state.players[playerId].teamId = "PHI";
    expect(untouchablePlayerIds(state, "MIA")).not.toContain(playerId);
    expect(isUntouchable(state, playerId)).toBe(true);
    state.teams.PHI.playerIds = state.teams.PHI.playerIds.filter((id) => id !== playerId);
    state.teams[state.userTeamId].playerIds.push(playerId);
    state.players[playerId].teamId = state.userTeamId;
    expect(isUntouchable(state, playerId)).toBe(false);
  });
});
