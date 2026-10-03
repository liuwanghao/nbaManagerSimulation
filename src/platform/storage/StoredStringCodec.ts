const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (let start = 0; start < bytes.length; start += 32_768) binary += String.fromCharCode(...bytes.subarray(start, start + 32_768));
  return btoa(binary);
};

const base64ToBytes = (value: string): Uint8Array => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

// Keep the marker in the message: Worker responses serialize errors as text.
export const STORED_STRING_CORRUPTION_ERROR = "INVALID_COMPRESSED_SAVE";

function isStoredStringReadFailure(error: unknown): boolean {
  const description = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return /NotReadableError|AbortError|OutOfMemoryError|out of memory|(?:memory|buffer) allocation failed|I\/O read operation failed|invalid (?:string|arraybuffer|typed array) length/iu.test(description);
}

export function isStoredStringCorruptionError(error: unknown): boolean {
  // Older Workers/adapters may already have wrapped a resource failure with this marker.
  return error instanceof Error && error.message.startsWith(`${STORED_STRING_CORRUPTION_ERROR}:`)
    && !isStoredStringReadFailure(error);
}

function corruptedStoredString(error: unknown): Error {
  return new Error(`${STORED_STRING_CORRUPTION_ERROR}: ${error instanceof Error ? error.message || error.name : String(error)}`, { cause: error });
}

export async function encodeStoredStringCore(value: string): Promise<string> {
  if (value.length < 1_024 || typeof CompressionStream === "undefined") return `raw:${value}`;
  const stream = new Blob([value]).stream().pipeThrough(new CompressionStream("gzip"));
  const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
  return `gz:${bytesToBase64(compressed)}`;
}

export async function decodeStoredStringCore(value: string): Promise<string> {
  if (value.startsWith("raw:")) return value.slice(4);
  if (!value.startsWith("gz:")) return value;
  if (typeof DecompressionStream === "undefined") throw new Error("GZIP_STORAGE_UNSUPPORTED");
  let compressed: Uint8Array;
  try {
    compressed = base64ToBytes(value.slice(3));
  } catch (error) {
    if (!(error instanceof Error) || error.name !== "InvalidCharacterError") throw error;
    throw corruptedStoredString(error);
  }
  // Allocation and unsupported decoder errors do not establish corrupt input.
  const decoder = new DecompressionStream("gzip");
  const stream = new Blob([compressed.slice().buffer as ArrayBuffer]).stream().pipeThrough(decoder);
  try {
    return await new Response(stream).text();
  } catch (error) {
    // https://compression.spec.whatwg.org/#decompressionstream: invalid gzip errors the stream with TypeError.
    if (!(error instanceof TypeError) || isStoredStringReadFailure(error)) throw error;
    throw corruptedStoredString(error);
  }
}
