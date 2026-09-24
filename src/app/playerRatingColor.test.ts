import { describe, expect, it } from "vitest";
import { PLAYER_RATING_COLORS, playerRatingColor, playerRatingStyle } from "./playerRatingColor";

describe("player rating colors", () => {
  it.each([
    [99, PLAYER_RATING_COLORS.elite],
    [90, PLAYER_RATING_COLORS.elite],
    [89, PLAYER_RATING_COLORS.excellent],
    [80, PLAYER_RATING_COLORS.excellent],
    [79, PLAYER_RATING_COLORS.good],
    [70, PLAYER_RATING_COLORS.good],
    [69, PLAYER_RATING_COLORS.average],
    [60, PLAYER_RATING_COLORS.average],
    [59, PLAYER_RATING_COLORS.weakHigh],
    [0, PLAYER_RATING_COLORS.weakLow],
  ])("maps %i to %s", (rating, color) => {
    expect(playerRatingColor(rating)).toBe(color);
  });

  it("smoothly cools weak ratings between ice blue and deep blue", () => {
    expect(playerRatingColor(30)).toBe("#1F81DB");
    expect(playerRatingColor(50)).toBe("#0AA2F4");
  });

  it("clamps out-of-range values and exposes the shared CSS variable", () => {
    expect(playerRatingColor(120)).toBe(PLAYER_RATING_COLORS.elite);
    expect(playerRatingColor(-10)).toBe(PLAYER_RATING_COLORS.weakLow);
    expect(playerRatingStyle(75)).toEqual({ "--player-rating-color": PLAYER_RATING_COLORS.good });
  });
});
