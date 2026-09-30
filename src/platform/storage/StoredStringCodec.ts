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
  const compressed = base64ToBytes(value.slice(3));
  const stream = new Blob([compressed.slice().buffer as ArrayBuffer]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}
