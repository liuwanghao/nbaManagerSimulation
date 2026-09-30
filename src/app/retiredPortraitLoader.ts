import { BUNDLED_RETIRED_PORTRAIT_IDS } from "../data/retiredLegendPortraitIds";

const approvedIds = new Set<string>(BUNDLED_RETIRED_PORTRAIT_IDS);
type PortraitWindow = Window & { RETIRED_PORTRAIT_DATA?: Record<string, unknown> };
let pendingData: Promise<void> | null = null;

export function retiredPortraitId(path?: string | null): string | null {
  const id = path?.match(/^\.\/retired-portraits\/nba-(\d+)\.webp$/u)?.[1];
  return id && approvedIds.has(id) ? id : null;
}

function loadedData(): Record<string, unknown> | undefined {
  return typeof window === "undefined" ? undefined : (window as PortraitWindow).RETIRED_PORTRAIT_DATA;
}

function ensureData(): Promise<void> {
  if (loadedData() || typeof document === "undefined" || typeof window === "undefined") return Promise.resolve();
  if (pendingData) return pendingData;
  // A classic local script works in the packaged file:// page and in Vite dev.
  // Keep the data separate from the initial game bundle and share concurrent requests.
  pendingData = new Promise<void>((resolve) => {
    const script = document.createElement("script");
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      script.onload = null;
      script.onerror = null;
      script.remove();
      resolve();
    };
    const timeout = setTimeout(finish, 10000);
    script.async = true;
    script.src = `${import.meta.env.BASE_URL}retired-portraits/data.js`;
    script.onload = finish;
    script.onerror = finish;
    try { document.head.appendChild(script); } catch { finish(); }
  }).finally(() => { pendingData = null; });
  return pendingData;
}

/** Only allow approved, locally generated inline WebP; the standalone files are not shipped. */
export async function loadRetiredPortrait(path?: string | null): Promise<string | null> {
  const id = retiredPortraitId(path);
  if (!id) return null;
  await ensureData();
  const source = loadedData()?.[id];
  return typeof source === "string" && /^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/u.test(source) ? source : null;
}
