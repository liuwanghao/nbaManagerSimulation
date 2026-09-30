export type LeaderboardSaveSlot = 1 | 2 | 3;

const SLOT_KEY = "basketball-manager-leaderboard-return-slot";

function parseSlot(value: string | null): LeaderboardSaveSlot | null {
  return value === "1" || value === "2" || value === "3" ? Number(value) as LeaderboardSaveSlot : null;
}

export function leaderboardReturnSlot(): LeaderboardSaveSlot | null {
  return parseSlot(new URLSearchParams(window.location.search).get("careerSlot"));
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
