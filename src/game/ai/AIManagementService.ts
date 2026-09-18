import { BALANCE_CONFIG } from "../../config/balanceConfig";
import { stableHash } from "../random/hash";
import type { AiTeamProfile, GameState, GmPersonality, TeamDirection } from "../state/types";

const PERSONALITIES: GmPersonality[] = ["AGGRESSIVE", "CONSERVATIVE", "STAR_CHASER", "DRAFT_FOCUSED", "DEVELOPMENT_FOCUSED", "CAP_CONSCIOUS"];
const DIRECTIONS: TeamDirection[] = ["CONTEND", "COMPETE", "RETOOL", "REBUILD"];

const careerDay = (seasonYear: number, dateIndex: number): number => seasonYear * BALANCE_CONFIG.ai.careerDaysPerSeason + dateIndex;

export function createAiTeamProfiles(teamIds: string[], careerSeed: string, seasonYear: number): Record<string, AiTeamProfile> {
  return Object.fromEntries([...teamIds].sort().map((teamId) => {
    const hash = stableHash(careerSeed, teamId, "ai_gm_profile");
    const personality = PERSONALITIES[Number.parseInt(hash.slice(0, 4), 16) % PERSONALITIES.length];
    const direction = DIRECTIONS[Number.parseInt(hash.slice(4, 8), 16) % DIRECTIONS.length];
    return [teamId, {
      personality,
      direction,
      directionLockUntilCareerDay: careerDay(seasonYear, 0) + BALANCE_CONFIG.ai.directionLockDays,
      lastDirectionChangeSeasonId: `${seasonYear}-${String((seasonYear + 1) % 100).padStart(2, "0")}`,
    }];
  }));
}

export function targetDirection(state: GameState, teamId: string): TeamDirection {
  const record = state.standings[teamId];
  const games = (record?.wins ?? 0) + (record?.losses ?? 0);
  const winRate = games ? record.wins / games : 0.5;
  const thresholds = BALANCE_CONFIG.ai.directionWinRateThresholds;
  if (winRate >= thresholds.contend) return "CONTEND";
  if (winRate >= thresholds.compete) return "COMPETE";
  if (winRate >= thresholds.retool) return "RETOOL";
  return "REBUILD";
}

export function refreshAiDirection(state: GameState, teamId: string, dateIndex = state.calendar.currentDateIndex): TeamDirection {
  const profile = state.aiTeamProfiles[teamId];
  if (!profile) return targetDirection(state, teamId);
  const now = careerDay(state.league.seasonYear, dateIndex);
  const desired = targetDirection(state, teamId);
  if (desired !== profile.direction && now >= profile.directionLockUntilCareerDay) {
    profile.direction = desired;
    profile.directionLockUntilCareerDay = now + BALANCE_CONFIG.ai.directionLockDays;
    profile.lastDirectionChangeSeasonId = state.league.seasonId;
  }
  return profile.direction;
}
