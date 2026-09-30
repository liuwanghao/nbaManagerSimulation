import { useEffect, useState } from "react";
import type { Player } from "../game/state/types";
import { playerNameZh } from "./playerNameZh";
import { portraitSpriteMeta } from "./portraitSprite";
import { loadRetiredPortrait } from "./retiredPortraitLoader";

export function usePlayerPortrait(playerId: string, portraitPath?: string | null) {
  const portrait = portraitSpriteMeta(playerId, portraitPath);
  const requestKey = portrait?.source ?? portraitPath ?? null;
  const [loaded, setLoaded] = useState<{ key: string; source: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    let image: HTMLImageElement | null = null;
    const load = async () => {
      const source = portrait?.source ?? await loadRetiredPortrait(portraitPath);
      if (cancelled) return;
      if (!source || !requestKey) { setLoaded(null); return; }
      image = new Image();
      image.onload = () => { if (!cancelled) setLoaded({ key: requestKey, source }); };
      image.onerror = () => { if (!cancelled) setLoaded(null); };
      image.src = source;
    };
    void load();
    return () => {
      cancelled = true;
      if (image) { image.onload = null; image.onerror = null; }
    };
  }, [portrait?.source, portraitPath, requestKey]);
  const showPortrait = Boolean(requestKey && loaded?.key === requestKey);
  const style = portrait?.style ?? (loaded ? { backgroundImage: `url("${loaded.source}")`, backgroundPosition: "center", backgroundSize: "cover" } : undefined);
  return { showPortrait, style };
}

export function PlayerPortrait({ player, portraitPath, className = "" }: { player: Pick<Player, "id" | "name" | "position">; portraitPath?: string | null; className?: string }) {
  const { showPortrait, style } = usePlayerPortrait(player.id, portraitPath);
  return <div className={`gemini-prospect-avatar${className ? ` ${className}` : ""}${showPortrait ? " has-portrait" : " portrait-fallback"}`} style={showPortrait ? style : undefined} role="img" aria-label={`${playerNameZh(player.name, player.id)}${showPortrait ? "头像" : "默认头像"}`} />;
}
