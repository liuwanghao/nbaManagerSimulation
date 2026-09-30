import { useEffect, useState } from "react";
import type { Player } from "../game/state/types";
import { playerNameZh } from "./playerNameZh";
import { portraitSpriteMeta } from "./portraitSprite";

export function PlayerPortrait({ player, portraitPath, className = "" }: { player: Pick<Player, "id" | "name" | "position">; portraitPath?: string | null; className?: string }) {
  const portrait = portraitSpriteMeta(player.id, portraitPath);
  const retiredId = portraitPath?.match(/^\.\/retired-portraits\/nba-(\d+)\.webp$/u)?.[1];
  const bundledRetiredPortrait = retiredId && typeof window !== "undefined"
    ? (window as Window & { RETIRED_PORTRAIT_DATA?: Record<string, string> }).RETIRED_PORTRAIT_DATA?.[retiredId]
    : null;
  const standaloneSource = retiredId ? bundledRetiredPortrait ?? portraitPath : null;
  const source = portrait?.source ?? standaloneSource;
  const [loadedSource, setLoadedSource] = useState<string | null>(null);
  useEffect(() => {
    if (!source) {
      setLoadedSource(null);
      return;
    }
    let cancelled = false;
    const image = new Image();
    image.onload = () => { if (!cancelled) setLoadedSource(source); };
    image.onerror = () => { if (!cancelled) setLoadedSource(null); };
    image.src = source;
    return () => { cancelled = true; };
  }, [source]);
  const showPortrait = Boolean(source && loadedSource === source);
  const style = portrait?.style ?? (standaloneSource ? { backgroundImage: `url("${standaloneSource}")`, backgroundPosition: "center", backgroundSize: "cover" } : undefined);
  return <div className={`gemini-prospect-avatar${className ? ` ${className}` : ""}${showPortrait ? " has-portrait" : " portrait-fallback"}`} style={showPortrait ? style : undefined} role="img" aria-label={`${playerNameZh(player.name, player.id)}${showPortrait ? "头像" : "默认头像"}`} />;
}
