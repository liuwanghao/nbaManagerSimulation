import assert from "node:assert/strict";
import test from "node:test";
import { buildPeakRatings } from "./sync_retired_legend_2k.mjs";
import { NBA2K_ATTRIBUTE_FIELDS } from "./player_data_pipeline.mjs";

test("chooses the highest historical 2K roster rating and reports missing legends", () => {
  const templates = [
    { sourcePlayerId: "nba:893", sourceName: "Michael Jordan" },
    { sourcePlayerId: "nba:977", sourceName: "Kobe Bryant" },
  ];
  const rows = [
    { name: "Michael Jordan", overall: 88, teamType: "class", team: "1985 Bulls" },
    { name: "Michael Jordan", overall: 99, teamType: "allt", team: "All-Time Bulls", positions: ["SG", "SF"] },
    { name: "Michael Jordan", overall: 98, teamType: "curr", team: "Current Bulls" },
  ];
  const result = buildPeakRatings(templates, rows, {});
  assert.equal(result.players.length, 1);
  assert.equal(result.players[0].peakOverall, 99);
  assert.equal(result.players[0].teamType, "allt");
  assert.equal(result.players[0].peakAttributes, null);
  assert.deepEqual(result.players[0].positions, ["SG", "SF"]);
  assert.deepEqual(result.unmatched, [{ sourcePlayerId: "nba:977", sourceName: "Kobe Bryant" }]);
});

test("keeps only valid NBA positions from the API response", () => {
  const { players } = buildPeakRatings(
    [{ sourcePlayerId: "nba:893", sourceName: "Michael Jordan" }],
    [{ name: "Michael Jordan", overall: 99, teamType: "allt", positions: ["SG", "N", "SG"] }],
    {},
  );
  assert.deepEqual(players[0].positions, ["SG"]);
});

test("maps a complete historical 2K profile to the game's eight abilities", () => {
  const attributes = Object.fromEntries(Object.values(NBA2K_ATTRIBUTE_FIELDS).map((key) => [key, 80]));
  const mapping = {
    perimeterDefense: { "Perimeter Defense": 1 },
    interiorDefense: { "Interior Defense": 1 },
    basketballIq: { "Shot IQ": 1 },
  };
  const { players } = buildPeakRatings(
    [{ sourcePlayerId: "nba:893", sourceName: "Michael Jordan" }],
    [{ name: "Michael Jordan", overall: 99, teamType: "allt", team: "All-Time Bulls", attributes }],
    mapping,
  );
  assert.deepEqual(Object.values(players[0].peakAttributes), Array(8).fill(80));
});

test("keeps the higher rating when an archived edition exceeds the current edition", () => {
  const { players } = buildPeakRatings(
    [{ sourcePlayerId: "nba:893", sourceName: "Michael Jordan" }],
    [
      { name: "Michael Jordan", overall: 98, gameVersion: "2K27", teamType: "allt" },
      { name: "Michael Jordan", overall: 99, gameVersion: "2K26", teamType: "class" },
    ],
    {},
  );
  assert.equal(players[0].peakOverall, 99);
  assert.equal(players[0].gameVersion, "2K26");
});
