#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import retiredPlayers from "../../src/data/nba-retired-players.json" with { type: "json" };

export const TRACKER_URL = "https://www.nba.com/players/free-agent-tracker";
const retiredIds = new Set(retiredPlayers.players.map((player) => player.nbaPlayerId));

export function parseFreeAgentTracker(html) {
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/u);
  if (!match) throw new Error("NBA free-agent tracker data not found");
  const page = JSON.parse(match[1]).props?.pageProps;
  if (String(page?.season) !== "2026" || !Array.isArray(page.players) || page.players.length < 20) {
    throw new Error("Unexpected NBA free-agent tracker season or player list");
  }
  const seen = new Set();
  const players = page.players.filter((player) => player.availability === "U" && String(player.newTeamId) === "0" && !retiredIds.has(String(player.playerId)))
    .map((player) => {
      const nbaPlayerId = String(player.playerId);
      if (!/^\d+$/u.test(nbaPlayerId) || !player.playerDisplayName || !["ufa", "rfa"].includes(player.type) || seen.has(nbaPlayerId)) {
        throw new Error(`Invalid or duplicate NBA free agent: ${nbaPlayerId}`);
      }
      seen.add(nbaPlayerId);
      return {
        nbaPlayerId,
        fullName: player.playerDisplayName,
        status: player.type.toUpperCase(),
        previousNbaTeamId: String(player.oldTeamId ?? "0"),
        twoWay: Boolean(player.isTwoWayFreeAgent),
      };
    }).sort((left, right) => left.nbaPlayerId.localeCompare(right.nbaPlayerId));
  if (!players.length) throw new Error("NBA free-agent tracker returned no unsigned players");
  return { schemaVersion: 1, season: "2026", sourceId: "NBA_OFFICIAL_FREE_AGENT_TRACKER", retrievedAt: new Date().toISOString(), players };
}

if (process.argv[1]?.endsWith("sync_nba_free_agents.mjs")) {
  const inputIndex = process.argv.indexOf("--input");
  const html = inputIndex >= 0
    ? await readFile(process.argv[inputIndex + 1], "utf8")
    : await fetch(TRACKER_URL).then((response) => {
      if (!response.ok) throw new Error(`NBA tracker responded with ${response.status}`);
      return response.text();
    });
  const snapshot = parseFreeAgentTracker(html);
  await writeFile(new URL("../../src/data/nba-2026-free-agents.json", import.meta.url), `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`Saved ${snapshot.players.length} unsigned NBA free agents (${snapshot.retrievedAt})`);
}
