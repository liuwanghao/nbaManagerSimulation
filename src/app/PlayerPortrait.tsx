import { useEffect, useState } from "react";
import type { Player } from "../game/state/types";
import { playerNameZh } from "./playerNameZh";
import { portraitSpriteMeta } from "./portraitSprite";

export function PlayerPortrait({ player, portraitPath, className = "" }: { player: Pick<Player, "id" | "name" | "position">; portraitPath?: string | null; className?: string }) {
  const portrait = portraitSpriteMeta(player.id, portraitPath);
  const [loadedSource, setLoadedSource] = useState<string | null>(null);
  useEffect(() => {
    if (!portrait) {
      setLoadedSource(null);
      return;
    }
    let cancelled = false;
    const image = new Image();
    image.onload = () => { if (!cancelled) setLoadedSource(portrait.source); };
    image.onerror = () => { if (!cancelled) setLoadedSource(null); };
    image.src = portrait.source;
    return () => { cancelled = true; };
  }, [portrait?.source]);
  const showPortrait = portrait && loadedSource === portrait.source;
  return <div className={`gemini-prospect-avatar${className ? ` ${className}` : ""}${showPortrait ? " has-portrait" : " portrait-fallback"}`} style={showPortrait ? portrait.style : undefined} role="img" aria-label={`${playerNameZh(player.name, player.id)}${showPortrait ? "头像" : "默认头像"}`} />;
}
