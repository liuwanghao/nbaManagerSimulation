import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { enqueueEvent, settleInformationalEvents } from "../game/events/EventService";
import { createCareer } from "../game/season/career";
import App from "./App";

describe("season opening screen", () => {
  it("shows only for the expansion team's first regular season", () => {
    const first = createCareer("opening-screen-once");
    first.expansion = { finalized: true } as NonNullable<typeof first.expansion>;
    enqueueEvent(first, "franchise_season_opening_001");
    expect(renderToStaticMarkup(createElement(App, { initialState: first }))).toContain('data-testid="season-opening-screen"');

    const later = structuredClone(first);
    later.league.seasonYear = 2027;
    later.league.seasonId = "2027-28";
    settleInformationalEvents(later);
    expect(later.eventState.queue).toEqual([]);
    expect(renderToStaticMarkup(createElement(App, { initialState: later }))).not.toContain('data-testid="season-opening-screen"');
  });
});
