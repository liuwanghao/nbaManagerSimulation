import { describe, expect, it } from "vitest";
import { stableHash, stableSerialize } from "../random/hash";
import { createCareer } from "../season/career";
import type { GameState } from "../state/types";
import { evaluateTradeOffer, generateTargetedTradeOffers, generateTradeOffers } from "./TradeService";

const stateHash = (state: unknown): string => stableHash(stableSerialize(state));

function preDraftState(seed: string): GameState {
  const state = createCareer(seed);
  state.league.currentPhase = "OFFSEASON_PRE_DRAFT";
  state.league.seasonYear = 2027;
  state.league.seasonId = "2027-28";
  return state;
}

function ownPick(state: GameState, round: 1 | 2, year = 2027): string {
  const pick = Object.values(state.draftPicks).find((asset) =>
    asset.ownerTeamId === state.userTeamId && asset.round === round && asset.year === year);
  if (!pick) throw new Error(`Missing ${year} round ${round} fixture pick`);
  return pick.id;
}

function expectLegalQuotes(state: GameState): void {
  expect(state.tradeDesk.offers).toHaveLength(3);
  for (const offer of state.tradeDesk.offers) {
    expect(evaluateTradeOffer(state, offer.offerId).legal, offer.offerId).toBe(true);
  }
}

interface InquiryCase {
  name: string;
  seed: string;
  configure?: (state: GameState) => void;
  query: (state: GameState) => GameState;
  returnedStateHash: string;
  tradeDeskAndCountHash: string;
  verify?: (state: GameState) => void;
  timeout?: number;
}

// Golden results were captured before the inquiry-performance refactor on 2026-10-02.
// Both hashes cover complete structures, including quotation order, IDs, asset lists,
// value snapshots, selection state and inquiry counters; no result is recomputed as its oracle.
const inquiries: InquiryCase[] = [
  {
    name: "preserves the single-player asset inquiry",
    seed: "trade-determinism-asset-one",
    query: (state) => generateTradeOffers(state, state.teams[state.userTeamId].playerIds[5], false),
    returnedStateHash: "c0acc34db4135504",
    tradeDeskAndCountHash: "2f92f7c2b4f43156",
  },
  {
    name: "preserves the three-player asset inquiry",
    seed: "trade-determinism-asset-three",
    query: (state) => generateTradeOffers(state, { playerIds: state.teams[state.userTeamId].playerIds.slice(5, 8), pickIds: [] }, false),
    returnedStateHash: "3d9f60198652baa3",
    tradeDeskAndCountHash: "35d9c17367aef830",
  },
  {
    name: "preserves the six-player trade-extra-audit inquiry",
    seed: "trade-extra-audit",
    query: (state) => generateTradeOffers(state, { playerIds: state.teams[state.userTeamId].playerIds.slice(5, 11), pickIds: [] }, false),
    returnedStateHash: "2fa0bcc87542bca0",
    tradeDeskAndCountHash: "9850a20f57e17404",
    timeout: 30_000,
  },
  {
    name: "preserves the player and first-round pick inquiry",
    seed: "trade-determinism-mixed-first",
    query: (state) => generateTradeOffers(state, { playerIds: [state.teams[state.userTeamId].playerIds[5]], pickIds: [ownPick(state, 1)] }, false),
    returnedStateHash: "2044dcb1dbf44906",
    tradeDeskAndCountHash: "40f5b8ec93b002c6",
  },
  {
    name: "preserves the pick-only inquiry",
    seed: "trade-determinism-pick-only",
    query: (state) => generateTradeOffers(state, { playerIds: [], pickIds: [ownPick(state, 2)] }, false),
    returnedStateHash: "487f7facd5d2fdf0",
    tradeDeskAndCountHash: "9311789bae591046",
  },
  {
    name: "preserves the single-target inquiry",
    seed: "trade-determinism-target-one",
    query: (state) => generateTargetedTradeOffers(state, ["POR-P04"], false),
    returnedStateHash: "a4a4dad6e6ad6a72",
    tradeDeskAndCountHash: "cc49715bbe6defe1",
  },
  {
    name: "preserves the three-target inquiry",
    seed: "trade-determinism-target-three",
    query: (state) => generateTargetedTradeOffers(state, state.teams.MIA.playerIds.slice(5, 8), false),
    returnedStateHash: "c13837f448f5fdb5",
    tradeDeskAndCountHash: "616653ce91ec5617",
  },
  {
    name: "preserves restricted returns for a team above the second apron",
    seed: "trade-determinism-second-apron",
    configure: (state) => {
      for (const id of state.teams[state.userTeamId].playerIds) {
        const contract = state.players[id].contract;
        contract.salary = 20_000_000;
        contract.guaranteedAmount = 20_000_000;
        contract.guaranteedByYear = [20_000_000];
      }
    },
    query: (state) => generateTradeOffers(state, { playerIds: state.teams[state.userTeamId].playerIds.slice(5, 7), pickIds: [] }, false),
    returnedStateHash: "8c39e1402e5f61c0",
    tradeDeskAndCountHash: "81b9a82ad9750ae5",
    verify: (state) => {
      for (const offer of state.tradeDesk.offers) expect(offer.userIncomingPlayerIds).toHaveLength(1);
    },
  },
  {
    name: "preserves safe quotes when only five players are available and the target is injured",
    seed: "trade-black-screen-generated",
    configure: (state) => {
      state.teams[state.userTeamId].playerIds.forEach((id, index) => { state.players[id].available = index < 5; });
      state.players["POR-P04"].injury = {
        injuryId: "trade-test-injury", severity: "LONG", daysRemaining: 20, gamesRemaining: 10,
        occurredSeasonId: state.league.seasonId, occurredGameId: "trade-test-game",
        previousRotationRole: state.players["POR-P04"].rotationRole,
      };
    },
    query: (state) => generateTargetedTradeOffers(state, ["POR-P04"], false),
    returnedStateHash: "c84ac104ad5bdaf8",
    tradeDeskAndCountHash: "055161d10882f856",
    verify: (state) => {
      for (const offer of state.tradeDesk.offers) {
        const projectedIds = state.teams[state.userTeamId].playerIds
          .filter((id) => !offer.userOutgoingPlayerIds.includes(id)).concat(offer.userIncomingPlayerIds);
        expect(projectedIds.filter((id) => state.players[id].available && !state.players[id].injury)).toHaveLength(5);
      }
    },
  },
  {
    name: "preserves first-round returns needed to satisfy Stepien restrictions",
    seed: "trade-determinism-stepien",
    configure: (state) => { state.draftPicks[ownPick(state, 1, 2028)].ownerTeamId = "POR"; },
    query: (state) => generateTradeOffers(state, { playerIds: [], pickIds: [ownPick(state, 1)] }, false),
    returnedStateHash: "15f4d83a0790d06e",
    tradeDeskAndCountHash: "bd6d0acd22f6bfea",
    verify: (state) => {
      for (const offer of state.tradeDesk.offers) {
        expect(offer.userIncomingPickIds.some((id) => {
          const pick = state.draftPicks[id];
          return pick.round === 1 && (pick.year === 2027 || pick.year === 2028);
        })).toBe(true);
      }
    },
  },
];

describe("Trade inquiry determinism", () => {
  for (const inquiry of inquiries) {
    it(inquiry.name, () => {
      const input = preDraftState(inquiry.seed);
      inquiry.configure?.(input);
      const before = stateHash(input);
      const quoted = inquiry.query(input);
      expect(stateHash(input)).toBe(before);
      expect(stateHash(quoted)).toBe(inquiry.returnedStateHash);
      expect(stateHash({ tradeDesk: quoted.tradeDesk, tradeInquiryCount: quoted.tradeInquiryCount })).toBe(inquiry.tradeDeskAndCountHash);
      expectLegalQuotes(quoted);
      inquiry.verify?.(quoted);
    }, inquiry.timeout ?? 10_000);
  }

  it("preserves quote refresh behavior and increments only the refreshed inquiry", () => {
    const input = preDraftState("trade-determinism-refresh");
    const selectedId = input.teams[input.userTeamId].playerIds[5];
    const before = stateHash(input);
    const first = generateTradeOffers(input, selectedId, false);
    expect(stateHash(first)).toBe("68720767c2c64f7c");
    const repeat = generateTradeOffers(first, selectedId, false);
    const refreshed = generateTradeOffers(first, selectedId, true);
    expect(stateHash(input)).toBe(before);
    expect(stateHash(first)).toBe("68720767c2c64f7c");
    expect(stateHash(repeat)).toBe("68720767c2c64f7c");
    expect(stateHash(refreshed)).toBe("8f69e0527082930d");
    expect(stateHash({ tradeDesk: refreshed.tradeDesk, tradeInquiryCount: refreshed.tradeInquiryCount })).toBe("74b4bad185144bd2");
    expect(refreshed.tradeInquiryCount).toEqual({ "8335938e95286cb2": 1 });
    for (const quoted of [first, repeat, refreshed]) expectLegalQuotes(quoted);
  });

  it("rejects a reserved first-round pick without changing the state or refresh counter", () => {
    const input = preDraftState("trade-determinism-reserved");
    const pickId = ownPick(input, 1);
    input.draftPicks[pickId].reservedByCommitmentId = "deterministic-obligation";
    const before = stateHash(input);
    expect(() => generateTradeOffers(input, { playerIds: [], pickIds: [pickId] }, true)).toThrow("DRAFT_PICK_RESERVED");
    expect(stateHash(input)).toBe(before);
    expect(input.tradeInquiryCount).toEqual({});
  });
});
