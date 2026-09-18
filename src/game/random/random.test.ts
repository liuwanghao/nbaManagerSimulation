import { describe, expect, it } from "vitest";
import { fnv1a64Utf8, stableHash } from "./hash";
import { createRng } from "./xoshiro";

describe("deterministic random contract", () => {
  it("implements the frozen FNV-1a 64 UTF-8 vector", () => {
    expect(fnv1a64Utf8("hello")).toBe("a430d84680aabd0b");
  });

  it("replays an identical local stream", () => {
    const first = createRng(stableHash("career", "game", "g-1"));
    const second = createRng(stableHash("career", "game", "g-1"));
    expect(Array.from({ length: 20 }, () => first.nextUint32())).toEqual(
      Array.from({ length: 20 }, () => second.nextUint32()),
    );
  });
});
