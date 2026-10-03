import { performance } from "node:perf_hooks";
import { createCareer } from "../../src/game/season/career";
import { stableHash, stableSerialize } from "../../src/game/random/hash";
import { evaluateTradeOffer, generateTargetedTradeOffers, generateTradeOffers } from "../../src/game/trade/TradeService";

// Isolated in-memory fixture: never reads or writes a player's saved career.
const state = createCareer("trade-extra-audit");
state.league.currentPhase = "OFFSEASON_PRE_DRAFT";
state.league.seasonYear = 2027;
state.league.seasonId = "2027-28";
const roster = state.teams[state.userTeamId].playerIds;
const cases = [
  ...[1, 3, 6].map((count) => ({
    name: `asset-${count}`,
    generate: () => generateTradeOffers(state, { playerIds: roster.slice(5, 5 + count), pickIds: [] }, false),
  })),
  ...[1, 3].map((count) => ({
    name: `target-${count}`,
    generate: () => generateTargetedTradeOffers(state, state.teams.POR.playerIds.slice(5, 5 + count)),
  })),
];
const selected = process.argv.includes("--six-only") ? cases.filter(({ name }) => name === "asset-6") : cases;
const repeatIndex = process.argv.indexOf("--runs");
const runs = repeatIndex >= 0 ? Number(process.argv[repeatIndex + 1]) : 3;
if (!Number.isInteger(runs) || runs < 1) throw new Error("--runs must be a positive integer");
for (const scenario of selected) {
  const times: number[] = [];
  const hashes = new Set<string>();
  for (let run = 0; run < runs; run += 1) {
    const started = performance.now();
    const quoted = scenario.generate();
    times.push(Math.round((performance.now() - started) * 100) / 100);
    hashes.add(stableHash(stableSerialize({ tradeDesk: quoted.tradeDesk, tradeInquiryCount: quoted.tradeInquiryCount })));
    if (quoted.tradeDesk.offers.some((offer) => !evaluateTradeOffer(quoted, offer.offerId).legal)) throw new Error("Generated an illegal quote");
  }
  if (hashes.size !== 1) throw new Error("Non-deterministic inquiry");
  console.log(JSON.stringify({ scenario: scenario.name, runs, ms: times, medianMs: [...times].sort((a, b) => a - b)[Math.floor(times.length / 2)], resultHash: [...hashes][0] }));
}
