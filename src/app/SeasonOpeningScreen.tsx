interface SeasonOpeningScreenProps {
  seasonId: string;
  teamName: string;
  rosterCount: number;
  busy: boolean;
  onEnter: () => void;
}

export function SeasonOpeningScreen({ seasonId, teamName, rosterCount, busy, onEnter }: SeasonOpeningScreenProps) {
  return <main className="season-opening-screen" data-testid="season-opening-screen" aria-labelledby="season-opening-title">
    <div className="season-opening-photo" style={{ backgroundImage: 'url("./story/season-opening-portrait.png")' }} aria-hidden="true" />
    <div className="season-opening-shade" aria-hidden="true" />
    <section className="season-opening-content">
      <span className="season-opening-kicker">{seasonId} · 常规赛开幕</span>
      <h1 id="season-opening-title"><span>{teamName}</span><br />正式开赛</h1>
      <p>常规赛名单已锁定。带领球队开启新赛季征程。</p>
      <div className="season-opening-roster">常规赛名单 <strong>{rosterCount} 人</strong></div>
      <button type="button" data-testid="season-opening-enter" disabled={busy} onClick={onEnter}>进入常规赛 <span aria-hidden="true">→</span></button>
    </section>
  </main>;
}
