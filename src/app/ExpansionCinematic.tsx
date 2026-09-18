import { useEffect, useState } from "react";
import type { GameState } from "../game/state/types";

const SCENES = [
  {
    eyebrow: "2026 · 联盟特别公告",
    title: "版图，即将改写",
    copy: "NBA 正式批准新一轮扩军。三十支球队的时代落幕，联盟将迈入三十二队的新纪元。",
    metric: "30 → 32",
  },
  {
    eyebrow: "联盟重新划分",
    title: "森林狼，转入东部",
    copy: "为维持东西部各十六支球队的平衡，明尼苏达森林狼告别西部，正式加入东部联盟。",
    metric: "西部 → 东部",
  },
  {
    eyebrow: "西部扩军计划",
    title: "两座城市，等待新王",
    copy: "西雅图迎回职业篮球，拉斯维加斯首次加入联盟。两支新军全部落位西部，新的竞争格局就此形成。",
    metric: "西雅图 + 拉斯维加斯",
  },
  {
    eyebrow: "扩军时代 · 现在开始",
    title: "其中一支，由你掌舵",
    copy: "选择城市、建立品牌、争取扩军权益，再从全联盟的未保护名单中组建你的第一套阵容。",
    metric: "你的球队 · 你的时代",
  },
] as const;

export function ExpansionCinematic({ state, onComplete }: { state: GameState; onComplete: () => void }) {
  const [sceneIndex, setSceneIndex] = useState(0);
  const scene = SCENES[sceneIndex];
  const isFinal = sceneIndex === SCENES.length - 1;

  useEffect(() => {
    window.render_game_to_text = () => JSON.stringify({
      screen: "expansion-cinematic",
      scene: sceneIndex + 1,
      scenes: SCENES.length,
      title: scene.title,
      alignment: { MIN: "EAST", SEA: "WEST", LVG: "WEST" },
    });
    window.advanceTime = async () => undefined;
  }, [scene.title, sceneIndex]);

  useEffect(() => {
    if (isFinal) return;
    const timer = window.setTimeout(() => setSceneIndex((value) => Math.min(value + 1, SCENES.length - 1)), 5_200);
    return () => window.clearTimeout(timer);
  }, [isFinal, sceneIndex]);

  const next = () => {
    if (isFinal) onComplete();
    else setSceneIndex((value) => value + 1);
  };

  return (
    <main className={`cinematic-shell cinematic-scene-${sceneIndex + 1}`} data-testid="cinematic-intro">
      <div className="cinematic-backdrop" style={{ backgroundImage: 'linear-gradient(180deg, rgba(2,6,12,.1), rgba(2,6,12,.46) 44%, rgba(2,6,12,.96) 82%), url("./story/opening-arena.jpg")' }} aria-hidden="true" />
      <div className="cinematic-grain" aria-hidden="true" />
      <div className="cinematic-letterbox cinematic-letterbox-top" aria-hidden="true" />
      <div className="cinematic-letterbox cinematic-letterbox-bottom" aria-hidden="true" />

      <button className="cinematic-skip" data-testid="cinematic-skip" onClick={onComplete}>跳过序章</button>

      <section className="cinematic-frame" key={sceneIndex}>
        {sceneIndex === 0 && <div className="cinematic-league-mark" aria-hidden="true"><span>NBA</span><b>30</b><i>→</i><strong>32</strong></div>}
        {sceneIndex === 1 && <div className="cinematic-team-shift" aria-label="明尼苏达森林狼从西部转入东部">
          <span className="cinematic-conference">西部</span>
          <div className="cinematic-logo-disc">{state.teams.MIN.logoUrl ? <img src={state.teams.MIN.logoUrl} alt="明尼苏达森林狼队徽" /> : "MIN"}</div>
          <i>→</i><span className="cinematic-conference active">东部</span>
        </div>}
        {sceneIndex === 2 && <div className="cinematic-expansion-pair" aria-label="西雅图和拉斯维加斯加入西部">
          <span><img src="./expansion-logos/seattle-default.png" alt="西雅图扩军队队徽" /><b>西雅图</b><small>西部联盟</small></span>
          <i>+</i>
          <span><img src="./expansion-logos/las-vegas-default.png" alt="拉斯维加斯扩军队队徽" /><b>拉斯维加斯</b><small>西部联盟</small></span>
        </div>}
        {sceneIndex === 3 && <div className="cinematic-gm-mark" aria-hidden="true"><span>GM</span><i /><b>EXPANSION ERA</b></div>}

        <div className="cinematic-copy">
          <span>{scene.eyebrow}</span>
          <h1>{scene.title}</h1>
          <p>{scene.copy}</p>
          <strong>{scene.metric}</strong>
        </div>
      </section>

      <nav className="cinematic-controls" aria-label="序章进度">
        <div>{SCENES.map((_, index) => <button key={index} className={index === sceneIndex ? "active" : index < sceneIndex ? "viewed" : ""} aria-label={`第 ${index + 1} 幕`} onClick={() => setSceneIndex(index)}><span /></button>)}</div>
        <button className="cinematic-next" data-testid="cinematic-next" onClick={next}>{isFinal ? "开始建立球队" : "继续"}<span>→</span></button>
      </nav>
    </main>
  );
}
