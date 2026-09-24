import { createHash } from "node:crypto";

// The NBA CDN responds with HTTP 200 for unavailable headshots. This PNG is
// the shared gray silhouette, not a player photograph.
const NBA_UNAVAILABLE_HEADSHOT_SHA256 = "b3ebe78bfd1cecb8880e51e6a48c9093c5cfb7065f981826d12fb4c01a1b0965";

export function isUnavailableNbaHeadshot(bytes) {
  return createHash("sha256").update(bytes).digest("hex") === NBA_UNAVAILABLE_HEADSHOT_SHA256;
}
