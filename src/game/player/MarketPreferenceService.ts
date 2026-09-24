import { BALANCE_CONFIG } from "../../config/balanceConfig";
import type { PlayerPersonality } from "../state/types";

const clamp = (value: number): number => Math.max(0, Math.min(100, value));

/** Stable player trait: preference for the exposure of a larger city market. */
export function calculateMarketPreference(personality: PlayerPersonality, ageAtSnapshot: number): number {
  const model = BALANCE_CONFIG.freeAgency.marketPreferenceModel;
  const ageBias = ageAtSnapshot <= model.youngMaximumAge ? model.youngBonus
    : ageAtSnapshot >= model.veteranMinimumAge ? model.veteranPenalty : 0;
  return Math.round(clamp(model.baseline + model.personalityBias[personality] + ageBias));
}

/** 50 is neutral; high preference rewards high market ratings and vice versa. */
export function marketFitScore(marketPreference: number, marketRating: number): number {
  const { baseline, scale } = BALANCE_CONFIG.freeAgency.marketFit;
  return clamp(baseline + (marketPreference - baseline) * (marketRating - baseline) / scale);
}

type OfferFactor = keyof typeof BALANCE_CONFIG.freeAgency.weights;

export function personalityOfferWeights(personality: PlayerPersonality): Record<OfferFactor, number> {
  const { weights, personalityWeightShifts } = BALANCE_CONFIG.freeAgency;
  const shifts: Partial<Record<OfferFactor, number>> = personalityWeightShifts[personality];
  return Object.fromEntries((Object.keys(weights) as OfferFactor[]).map((key) =>
    [key, weights[key] + (shifts[key] ?? 0)])) as Record<OfferFactor, number>;
}
