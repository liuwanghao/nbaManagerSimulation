import { stableHash } from "../random/hash";
import { createRng } from "../random/xoshiro";
import { calculatePlayerOverall } from "../player/PlayerRatingService";
import { emptyPlayerSeasonStats, type GameState, type Player } from "../state/types";

const OPENING_CANDIDATE_COUNT = 30;

/** A small, explicitly synthetic comparison group for the opening season only. */
export function seedOpeningMipBaselines(state: GameState): void {
  if (state.league.seasonYear !== 2026) return;
  const eligible = Object.values(state.players)
    .filter((player) => state.teams[player.teamId] && player.serviceYears > 0 && player.age <= 29)
    .map((player) => ({ player, overall: calculatePlayerOverall(player) }))
    .filter(({ player, overall }) => overall >= 68 && (player.truePotential ?? overall) > overall)
    .sort((left, right) => {
      const score = (entry: { player: Player; overall: number }) =>
        (entry.player.truePotential ?? entry.overall) - entry.overall + entry.overall * 0.22 - Math.max(0, entry.player.age - 25) * 0.8;
      return score(right) - score(left) || left.player.id.localeCompare(right.player.id);
    })
    .slice(0, OPENING_CANDIDATE_COUNT);

  for (const { player, overall } of eligible) {
    if (player.career?.lastSeasonStats) continue;
    const rng = createRng(stableHash(state.seeds.careerSeed, "opening-mip-baseline", player.id));
    const games = rng.int(55, 78);
    const starter = player.rotationRole === "STARTER";
    const points = Math.max(4, (overall - 60) * 0.39 + (starter ? 2 : 0) + rng.nextFloat() * 2);
    const rebounds = Math.max(1.5, (player.attributes.rebounding - 45) * 0.08 + rng.nextFloat());
    const assists = Math.max(1, (player.attributes.playmaking - 45) * 0.065 + rng.nextFloat());
    player.career ??= {
      seasonsPlayed: 0, totals: emptyPlayerSeasonStats(), peakOverall: overall, peakImpact: overall,
      unemployedGameDays: 0, unemployedLeagueYears: 0, careerInjuryGamesMissed: 0,
    };
    player.career.lastSeasonStats = {
      ...emptyPlayerSeasonStats(), games, seconds: games * (starter ? 25 : 19) * 60,
      pts: Math.round(points * games), reb: Math.round(rebounds * games), ast: Math.round(assists * games),
      stl: Math.round(0.7 * games), blk: Math.round(0.5 * games), tov: Math.round(1.5 * games),
    };
    player.career.lastSeasonStatsSource = "SYNTHETIC_OPENING";
  }
}

export function hasOpeningMipBaselines(state: GameState): boolean {
  return state.league.seasonYear === 2026
    && Object.values(state.players).some((player) => player.career?.lastSeasonStatsSource === "SYNTHETIC_OPENING");
}
