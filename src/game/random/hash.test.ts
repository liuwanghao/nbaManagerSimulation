import { describe, expect, it } from "vitest";
import { hashSaveState } from "../../storage/SaveCodec";
import { createCareer } from "../season/career";
import { fnv1a64Utf8, hashSaveValue, stableHash, stableSerialize } from "./hash";

function serializationCases(): Array<[string, unknown]> {
  const sparse = new Array<unknown>(6);
  sparse[0] = undefined;
  sparse[2] = null;
  sparse[4] = ["nested", undefined];
  const inherited = new Array<unknown>(3);
  const prototype = Object.create(Array.prototype) as Record<number, unknown>;
  prototype[1] = "inherited";
  Object.setPrototypeOf(inherited, prototype);
  return [
    ["primitive values", [null, true, false, 0, -0, 1e30, NaN, Infinity, -Infinity, undefined, 123n, Symbol("test")]],
    ["nested objects and localeCompare keys", {
      z: [{ "é": true, "E": null, "中": "中文", "2": 2, "10": 10, a: { _first: false } }],
      omitted: undefined,
      a: { second: [undefined], first: "value" },
    }],
    ["sparse array holes", sparse],
    ["inherited sparse array entries", inherited],
    ["Unicode and isolated surrogates", "篮球经理🏀𐀀\u2028\u2029\ud800a\udc00\ud800"],
    ["Unicode object keys", { "🏀": "球员", "\ud800": undefined, "\udc00": "isolated" }],
    ["JSON escapes", `${String.fromCharCode(...Array.from({ length: 32 }, (_, index) => index))}\"\\/`],
    ["unsupported primitive fallbacks", [() => "function", Symbol(), 0n]],
    ["large individual string", "篮球🏀\n\"\\\ud800".repeat(4096)],
    ["empty collections", { array: [], object: {}, date: new Date("2026-10-02T00:00:00Z") }],
  ];
}

describe("save hash compatibility", () => {
  it("preserves the frozen double JSON string encoding", () => {
    const value = { z: [1, undefined, null], a: "\n\"\\" };
    expect(stableSerialize(value)).toBe('{"a":"\\n\\\"\\\\","z":[1,"undefined",null]}');
    expect(stableHash(stableSerialize(value))).toBe("b4dabd1d07eb9832");
    expect(fnv1a64Utf8(stableSerialize(value))).toBe("73e1efc7985d3ef0");
  });

  it.each(serializationCases())("uses the legacy save hash for %s", async (_name, value) => {
    expect(await hashSaveState(value)).toBe(stableHash(stableSerialize(value)));
  });

  it.each(serializationCases())("streams the legacy save hash for %s", (_name, value) => {
    expect(hashSaveValue(value)).toBe(stableHash(stableSerialize(value)));
  });

  it("matches UTF-8 across every UTF-16 code unit and supplementary boundaries", () => {
    const everyCodeUnit = Array.from({ length: 0x10000 }, (_, codeUnit) => `${String.fromCharCode(codeUnit)}|`).join("");
    const boundaries = String.fromCodePoint(0x7f, 0x80, 0x7ff, 0x800, 0xd7ff, 0xe000, 0xffff, 0x10000, 0x10ffff);
    const value = { everyCodeUnit, boundaries };
    expect(hashSaveValue(value)).toBe(stableHash(stableSerialize(value)));
  });

  it("uses the legacy save hash for a complete career state", async () => {
    const state = createCareer("streaming-save-hash-compatibility");
    expect(await hashSaveState(state)).toBe(stableHash(stableSerialize(state)));
    expect(hashSaveValue(state)).toBe(stableHash(stableSerialize(state)));
  });
});
