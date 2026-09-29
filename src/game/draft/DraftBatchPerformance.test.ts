import { describe, expect, it } from "vitest";
import { createCareer } from "../season/career";
import { stableHash, stableSerialize } from "../random/hash";
import {
  advanceRookieDraftAiPick,
  draftPlayer,
  executeDraftCommand,
  fastForwardRookieDraft,
  getAvailableDraftProspects,
  prepareRookieDraft,
} from "./DraftService";

describe("headless rookie draft batching", () => {
  it("produces the same complete draft as individual AI picks", () => {
    let state = createCareer("draft-batch-equivalence");
    state.league.currentPhase = "OFFSEASON_PRE_DRAFT";
    state.league.seasonYear = 2027;
    state.league.seasonId = "2027-28";
    state.seeds.seasonSeed = stableHash(state.seeds.careerSeed, "season", state.league.seasonId);
    const prepared = executeDraftCommand(prepareRookieDraft(state), {
      commandId: "ack", type: "ACKNOWLEDGE_DRAFT_LOTTERY", payload: {},
    });
    const finish = (batch: boolean) => {
      let next = prepared;
      while (next.league.currentPhase === "DRAFT") {
        const pick = next.rookieDraft?.pickOrder[next.rookieDraft.currentPickIndex];
        if (!pick) throw new Error("Missing draft pick");
        next = pick.ownerTeamId === next.userTeamId
          ? draftPlayer(next, getAvailableDraftProspects(next)[0].id, pick.pickNumber)
          : batch
            ? fastForwardRookieDraft(next, pick.pickNumber)
            : advanceRookieDraftAiPick(next, pick.pickNumber);
      }
      return next;
    };
    expect(stableSerialize(finish(true))).toBe(stableSerialize(finish(false)));
  });
});
