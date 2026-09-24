import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseFreeAgentTracker } from "./sync_nba_free_agents.mjs";

function page(players, season = 2026) {
  return `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { season, players } } })}</script>`;
}

const unsigned = { playerId: 1234, playerDisplayName: "Test Player", type: "ufa", oldTeamId: "1", newTeamId: "0", availability: "U" };

describe("NBA free-agent tracker import", () => {
  it("selects only unsigned players and preserves RFA status", () => {
    const players = Array.from({ length: 20 }, (_, index) => ({ ...unsigned, playerId: index + 1 }));
    players[1] = { ...players[1], type: "rfa" };
    players[2] = { ...players[2], newTeamId: "1", availability: "S" };
    const snapshot = parseFreeAgentTracker(page(players));
    assert.equal(snapshot.players.length, 19);
    assert.equal(snapshot.players.find((player) => player.nbaPlayerId === "2")?.status, "RFA");
    assert.ok(!snapshot.players.some((player) => player.nbaPlayerId === "3"));
  });

  it("rejects outdated seasons and duplicate identities", () => {
    const players = Array.from({ length: 20 }, (_, index) => ({ ...unsigned, playerId: index + 1 }));
    assert.throws(() => parseFreeAgentTracker(page(players, 2025)), /season/);
    players[1].playerId = 1;
    assert.throws(() => parseFreeAgentTracker(page(players)), /duplicate/);
  });

  it("keeps confirmed retirees out of future tracker imports", () => {
    const players = Array.from({ length: 20 }, (_, index) => ({ ...unsigned, playerId: index + 1 }));
    players[0] = { ...unsigned, playerId: 201566, playerDisplayName: "Russell Westbrook" };
    players[1] = { ...unsigned, playerId: 201587, playerDisplayName: "Nicolas Batum" };
    const snapshot = parseFreeAgentTracker(page(players));
    assert.equal(snapshot.players.length, 18);
    assert.ok(!snapshot.players.some((player) => player.nbaPlayerId === "201566"));
    assert.ok(!snapshot.players.some((player) => player.nbaPlayerId === "201587"));
  });
});
