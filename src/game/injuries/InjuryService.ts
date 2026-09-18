import { stableHash } from "../random/hash";
import type { GameState } from "../state/types";

export type InjuryCommand = {
  commandId: string;
  type: "ACKNOWLEDGE_MAJOR_INJURY";
  payload: { injuryId: string };
};

export function acknowledgeMajorInjury(input: GameState, injuryId: string): GameState {
  const pending = input.injuryState.pendingUserMajorInjury;
  if (!pending || pending.injuryId !== injuryId) throw new Error("MAJOR_INJURY_NOT_PENDING");
  const state = structuredClone(input);
  state.injuryState.pendingUserMajorInjury = undefined;
  return state;
}

export function executeInjuryCommand(state: GameState, command: InjuryCommand): GameState {
  const payloadHash = stableHash(command.type, command.payload);
  const receipt = state.commandReceipts[command.commandId];
  if (receipt) {
    if (receipt.payloadHash !== payloadHash) throw new Error("Command ID 已被不同 Payload 使用");
    return state;
  }
  const next = acknowledgeMajorInjury(state, command.payload.injuryId);
  next.commandReceipts[command.commandId] = { payloadHash };
  return next;
}
