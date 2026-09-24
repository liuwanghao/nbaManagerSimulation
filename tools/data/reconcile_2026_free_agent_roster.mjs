#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import retiredPlayers from "../../src/data/nba-retired-players.json" with { type: "json" };

const rosterPath = new URL("../../src/data/nba-current-roster.json", import.meta.url);
const freeAgentsPath = new URL("../../src/data/nba-2026-free-agents.json", import.meta.url);
const retiredIds = new Set(retiredPlayers.players.map((player) => player.nbaPlayerId));

const signedPlayerIds = new Set([
  "1629022",
  "1629234",
  "1629618",
  "1630534",
  "1631127",
  "1631131",
  "1631132",
  "1641794",
  "1641869",
  "1642530",
  "1643016",
  "1629723", // John Konchar: NYK roster and 2026-27 NYK salary row
  "1631207", // Dalen Terry: GSW roster and 2026-27 GSW salary row
  "1641763", // Julian Phillips: HOU roster and 2026-27 HOU salary row
]);

const unsignedPlayerIds = new Set([
  "1628971",
  "1631105",
  "1631120",
]);

const roster = JSON.parse(await readFile(rosterPath, "utf8"));
const freeAgents = JSON.parse(await readFile(freeAgentsPath, "utf8"));
const overlap = roster.players.filter((player) => freeAgents.players.some((freeAgent) => freeAgent.nbaPlayerId === player.nbaPlayerId));
const overlapIds = new Set(overlap.map((player) => player.nbaPlayerId));

if ([...signedPlayerIds].some((id) => unsignedPlayerIds.has(id))
  || [...overlapIds].some((id) => !signedPlayerIds.has(id) && !unsignedPlayerIds.has(id))) {
  throw new Error(`Unreviewed NBA roster/free-agent overlap: ${[...overlapIds].filter((id) => !signedPlayerIds.has(id) && !unsignedPlayerIds.has(id)).join(", ")}`);
}

roster.players = roster.players.filter((player) => !unsignedPlayerIds.has(player.nbaPlayerId));
freeAgents.players = freeAgents.players.filter((player) => !signedPlayerIds.has(player.nbaPlayerId) && !retiredIds.has(player.nbaPlayerId));

const remainingOverlap = roster.players.filter((player) => freeAgents.players.some((freeAgent) => freeAgent.nbaPlayerId === player.nbaPlayerId));
if (remainingOverlap.length) throw new Error(`Roster/free-agent overlap remains: ${remainingOverlap.map((player) => player.fullName).join(", ")}`);

await writeFile(rosterPath, `${JSON.stringify(roster)}\n`);
await writeFile(freeAgentsPath, `${JSON.stringify(freeAgents, null, 2)}\n`);
console.log(`Roster: ${roster.players.length}; free agents: ${freeAgents.players.length}; overlap: ${remainingOverlap.length}`);
