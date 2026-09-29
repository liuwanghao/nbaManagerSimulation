export type LeaderboardSaveSlot = 1 | 2 | 3;

const SLOT_KEY = "basketball-manager-leaderboard-return-slot";

function parseSlot(value: string | null): LeaderboardSaveSlot | null {
  return value === "1" || value === "2" || value === "3" ? Number(value) as LeaderboardSaveSlot : null;
}

export function leaderboardReturnSlot(): LeaderboardSaveSlot | null {
  const fromUrl = parseSlot(new URLSearchParams(window.location.search).get("careerSlot"));
  if (fromUrl) return fromUrl;
  try { return parseSlot(sessionStorage.getItem(SLOT_KEY)); } catch { return null; }
}

export function rememberLeaderboardReturn(slot: LeaderboardSaveSlot): void {
  try { sessionStorage.setItem(SLOT_KEY, String(slot)); } catch { /* URL is the fallback. */ }
  try {
    const url = new URL(window.location.href);
    url.searchParams.set("careerSlot", String(slot));
    window.history.replaceState(window.history.state, "", url.href);
  } catch { /* Session storage remains available if this browser rejects file URL history updates. */ }
}

export function clearLeaderboardReturn(): void {
  try { sessionStorage.removeItem(SLOT_KEY); } catch { /* URL still carries the route. */ }
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("careerSlot")) return;
    url.searchParams.delete("careerSlot");
    window.history.replaceState(window.history.state, "", url.href);
  } catch { /* Clearing session storage still prevents a stale return route. */ }
}
