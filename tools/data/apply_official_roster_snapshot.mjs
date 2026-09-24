#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";

const inputPath = process.argv[2] ?? "/tmp/nba-league-players.html";
const snapshotDate = process.argv[3] ?? "2026-09-23";
const rosterPath = new URL("../../src/data/nba-current-roster.json", import.meta.url);
const datasetPath = new URL("../../src/data/nba-player-dataset.json", import.meta.url);
const supplementalPath = new URL("../../src/data/nba-supplemental-player-projections.json", import.meta.url);

const html = await readFile(inputPath, "utf8");
const nextData = JSON.parse(html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/su)?.[1] ?? "");
const officialPlayers = nextData.props?.pageProps?.players;
if (!Array.isArray(officialPlayers) || officialPlayers.length < 500) {
  throw new Error(`NBA official roster snapshot is unexpectedly small: ${officialPlayers?.length ?? 0}`);
}

const rosterPlayers = officialPlayers.map((player) => ({
  nbaPlayerId: String(player.PERSON_ID),
  fullName: `${player.PLAYER_FIRST_NAME} ${player.PLAYER_LAST_NAME}`.trim(),
  teamAbbreviation: player.TEAM_ABBREVIATION,
  jerseyNumber: player.JERSEY_NUMBER ?? null,
  position: player.POSITION ?? null,
  height: player.HEIGHT ?? null,
  weight: player.WEIGHT == null ? null : Number(player.WEIGHT),
})).sort((left, right) => left.fullName.localeCompare(right.fullName));
const officialById = new Map(rosterPlayers.map((player) => [player.nbaPlayerId, player]));

const roster = {
  schemaVersion: 1,
  rosterVersion: `nba-official-2026-27-${snapshotDate}`,
  retrievedAt: `${snapshotDate}T00:00:00+08:00`,
  sourceId: "nba.com-official-players-directory",
  players: rosterPlayers,
};

function retainAndRefreshPlayers(data) {
  const players = data.players.filter((player) => officialById.has(String(player.nbaPlayerId)));
  for (const player of players) {
    const official = officialById.get(String(player.nbaPlayerId));
    player.teamAbbreviation = official.teamAbbreviation;
    player.jerseyNumber = official.jerseyNumber;
    player.position = official.position ?? player.position;
  }
  return players;
}

const dataset = JSON.parse(await readFile(datasetPath, "utf8"));
const supplemental = JSON.parse(await readFile(supplementalPath, "utf8"));
const retainedDataset = retainAndRefreshPlayers(dataset);
const retainedSupplemental = retainAndRefreshPlayers({ players: supplemental });
dataset.players = retainedDataset;
supplemental.splice(0, supplemental.length, ...retainedSupplemental);

await writeFile(rosterPath, `${JSON.stringify(roster)}\n`);
await writeFile(datasetPath, `${JSON.stringify(dataset)}\n`);
await writeFile(supplementalPath, `${JSON.stringify(supplemental)}\n`);

process.stdout.write(`${JSON.stringify({
  officialRosterPlayers: rosterPlayers.length,
  retainedDatasetPlayers: retainedDataset.length,
  retainedSupplementalPlayers: retainedSupplemental.length,
  removedDatasetPlayers: JSON.parse(await readFile(new URL("../../src/data/nba2k27-current-ratings.json", import.meta.url), "utf8")).players.length - retainedDataset.length,
})}\n`);
