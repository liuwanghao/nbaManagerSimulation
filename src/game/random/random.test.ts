import { describe, expect, it } from "vitest";
import { fnv1a64Utf8, stableHash } from "./hash";
import { createRng } from "./xoshiro";

describe("deterministic random contract", () => {
  it("implements the frozen FNV-1a 64 UTF-8 vector", () => {
    expect(fnv1a64Utf8("hello")).toBe("a430d84680aabd0b");
    expect(fnv1a64Utf8("")).toBe("cbf29ce484222325");
    expect(fnv1a64Utf8("篮球经理🏀")).toBe("30aac522af00b1f1");
    expect(fnv1a64Utf8("x".repeat(1024))).toBe("51bfc41078b37325");
    expect(fnv1a64Utf8("\u0000\u001f")).toBe("08326907b4eb3b40");
  });

  it("matches the original 64-bit arithmetic across byte boundaries", () => {
    const reference = (value: string): string => {
      let hash = 0xcbf29ce484222325n;
      for (const byte of new TextEncoder().encode(value)) {
        hash = ((hash ^ BigInt(byte)) * 0x100000001b3n) & 0xffffffffffffffffn;
      }
      return hash.toString(16).padStart(16, "0");
    };
    const bytes = String.fromCharCode(...Array.from({ length: 256 }, (_, index) => index));
    for (const length of [1, 2, 3, 7, 31, 64, 127, 255, 256, 257, 1023]) {
      const value = `${bytes.repeat(Math.ceil(length / bytes.length)).slice(0, length)}🏀`;
      expect(fnv1a64Utf8(value)).toBe(reference(value));
    }
  });

  it("replays an identical local stream", () => {
    const first = createRng(stableHash("career", "game", "g-1"));
    const second = createRng(stableHash("career", "game", "g-1"));
    expect(Array.from({ length: 20 }, () => first.nextUint32())).toEqual(
      Array.from({ length: 20 }, () => second.nextUint32()),
    );
  });
});
