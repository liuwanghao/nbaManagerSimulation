import type { CSSProperties } from "react";

export const PLAYER_RATING_COLORS = {
  elite: "#FF3D00",
  excellent: "#FF9100",
  good: "#FFD600",
  average: "#00E676",
  weakHigh: "#00B0FF",
  weakLow: "#3F51B5",
} as const;

type PlayerRatingStyle = CSSProperties & { "--player-rating-color": string };

const clampRating = (value: number): number => Math.max(0, Math.min(99, Number.isFinite(value) ? value : 0));

const hexChannel = (value: number): string => Math.round(value).toString(16).padStart(2, "0").toUpperCase();

function interpolateWeakRating(value: number): string {
  const ratio = (59 - value) / 59;
  const start = [0, 176, 255];
  const end = [63, 81, 181];
  return `#${start.map((channel, index) => hexChannel(channel + (end[index] - channel) * ratio)).join("")}`;
}

export function playerRatingColor(value: number): string {
  const rating = clampRating(value);
  if (rating >= 90) return PLAYER_RATING_COLORS.elite;
  if (rating >= 80) return PLAYER_RATING_COLORS.excellent;
  if (rating >= 70) return PLAYER_RATING_COLORS.good;
  if (rating >= 60) return PLAYER_RATING_COLORS.average;
  return interpolateWeakRating(rating);
}

export function playerRatingStyle(value: number): PlayerRatingStyle {
  return { "--player-rating-color": playerRatingColor(value) };
}
