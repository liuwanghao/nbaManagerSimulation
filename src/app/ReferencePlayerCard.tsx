import { useEffect, useState } from "react";
import type { Player } from "../game/state/types";
import { calculatePlayerOverall } from "../game/player/PlayerRatingService";
import { playerNameZh } from "./playerNameZh";
import { portraitSpriteMeta } from "./portraitSprite";
import { measurementLabel, moneyLabel } from "./uiText";

const ATTRIBUTE_LABELS: Array<[keyof Player["attributes"], string]> = [
  ["finishing", "终结"],
  ["shooting", "投射"],
  ["playmaking", "组织"],
  ["perimeterDefense", "外防"],
  ["interiorDefense", "内防"],
  ["rebounding", "篮板"],
  ["athleticism", "运动"],
  ["basketballIq", "球商"],
];

const PERSONALITY_LABELS: Record<Player["personality"], string> = {
  COMPETITIVE: "竞争型",
  MONEY_FOCUSED: "薪资优先",
  LOYAL: "忠诚型",
  ROLE_FOCUSED: "角色优先",
  MARKET_FOCUSED: "曝光优先",
  BALANCED: "均衡型",
};

function ratingClass(value: number): "high" | "mid" | "low" {
  if (value >= 80) return "high";
  if (value >= 70) return "mid";
  return "low";
}

export function ReferencePlayerCard({ player, teamName }: { player: Player; teamName: string }) {
  const displayName = playerNameZh(player.name, player.id);
  const portrait = portraitSpriteMeta(player.id, player.portraitPath);
  const [portraitUnavailable, setPortraitUnavailable] = useState(!portrait);
  useEffect(() => {
    if (!portrait) {
      setPortraitUnavailable(true);
      return;
    }
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (!cancelled) setPortraitUnavailable(false);
    };
    image.onerror = () => { if (!cancelled) setPortraitUnavailable(true); };
    image.src = portrait.source;
    return () => { cancelled = true; };
  }, [portrait?.index, portrait?.source]);
  return (
    <article className="reference-player-card" data-player-id={player.id}>
      <header className="reference-player-header">
        <div className={`reference-player-portrait ${portraitUnavailable ? "portrait-fallback" : "portrait-sprite"}`} aria-hidden="true" style={portraitUnavailable ? undefined : portrait?.style} />
        <div>
          <h2 className="reference-player-name">{displayName}</h2>
          <div className="reference-player-team">
            <span>{teamName}</span><i>·</i><b>{player.position}</b>
            {player.secondaryPosition && player.secondaryPosition !== player.position && <b>{player.secondaryPosition}</b>}
          </div>
        </div>
        <div className="reference-ovr-badge">
          <div className="reference-ovr-value">{calculatePlayerOverall(player).toFixed(0)}</div>
          <div className="reference-ovr-label">OVR</div>
        </div>
      </header>

      <div className="reference-basic-stats">
        <div className="reference-stat-item"><b>{player.age}</b><span>年龄</span></div>
        <div className="reference-stat-item"><b>{measurementLabel(player.heightCm, "cm")}</b><span>身高</span></div>
        <div className="reference-stat-item"><b>{measurementLabel(player.weightKg, "kg")}</b><span>体重</span></div>
        <div className="reference-stat-item"><b>{player.serviceYears}年</b><span>{player.serviceYearsSource === "AGE_ESTIMATE" ? "球龄（估）" : "球龄"}</span></div>
      </div>

      <div className="reference-contract-bar">
        <span>年薪：<b>{moneyLabel(player.contract.salary)}</b></span>
        <span>剩余：<b>{player.contract.yearsRemaining}年</b></span>
        <span>保障：<b>{moneyLabel(player.contract.guaranteedAmount)}</b></span>
      </div>

      <div className="reference-attributes-grid">
        {ATTRIBUTE_LABELS.map(([key, label]) => {
          const value = player.attributes[key];
          const tone = ratingClass(value);
          return <div className="reference-attr-row" key={key}>
            <span className="reference-attr-name">{label}</span>
            <i className="reference-progress-bg"><em className={tone} style={{ width: `${value}%` }} /></i>
            <b className={`reference-attr-num ${tone}-text`}>{value.toFixed(0)}</b>
          </div>;
        })}
      </div>

      <footer className="reference-card-footer">
        <span>性格 <b>{PERSONALITY_LABELS[player.personality]}</b></span>
        <span>耐伤 <b>{player.injuryRating}</b></span>
        <span>大市场偏好 <b>{player.marketPreference}</b></span>
      </footer>
    </article>
  );
}
