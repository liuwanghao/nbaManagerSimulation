import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeStoredStringCore, encodeStoredStringCore } from "./StoredStringCodec";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("compressed save error classification", () => {
  it.each(["gz:!!!!", "gz:H4sIAAAAAAAA"])("identifies malformed input as corruption: %s", async (value) => {
    await expect(decodeStoredStringCore(value)).rejects.toThrow(/^INVALID_COMPRESSED_SAVE:/);
  });

  it("identifies an incorrect gzip checksum as corruption", async () => {
    const encoded = await encodeStoredStringCore("basketball".repeat(200));
    const bytes = atob(encoded.slice(3)).split("").map((character) => character.charCodeAt(0));
    bytes[bytes.length - 8] ^= 1;
    await expect(decodeStoredStringCore(`gz:${btoa(String.fromCharCode(...bytes))}`)).rejects.toThrow(/^INVALID_COMPRESSED_SAVE:/);
  });

  it.each([
    new Error("Out of memory"),
    new TypeError("Out of memory"),
    new DOMException("The I/O read operation failed.", "NotReadableError"),
    new RangeError("Invalid string length"),
    new DOMException("The operation was aborted.", "AbortError"),
    new Error("Unknown runtime failure"),
  ])("does not call a valid payload corrupted when reading fails with %s", async (failure) => {
    const source = "basketball".repeat(200);
    const encoded = await encodeStoredStringCore(source);
    const read = vi.spyOn(Response.prototype, "text").mockImplementation(async function (this: Response) {
      await this.body?.cancel();
      throw failure;
    });
    await expect(decodeStoredStringCore(encoded)).rejects.toBe(failure);
    read.mockRestore();
    expect(await decodeStoredStringCore(encoded)).toBe(source);
  });

  it("does not call unsupported gzip corrupted when constructing the decoder fails", async () => {
    const failure = new TypeError("Unsupported compression format");
    vi.stubGlobal("DecompressionStream", class { constructor() { throw failure; } });
    await expect(decodeStoredStringCore("gz:H4sIAAAAAAAA")).rejects.toBe(failure);
  });
});
