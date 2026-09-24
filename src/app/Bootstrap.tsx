import { useState } from "react";
import { createExpansionCareerFromBundledDataset } from "../data/hupuRoster";
import { EXPANSION_BRAND_PRESETS } from "../data/expansionBrands";
import { createCareer, simulateNextGameDay } from "../game/season/career";
import { chooseRightsPackage, createExpansionTeam, getSelectableExpansionPlayers, prepareExpansionTrade, resolveOptionPhase, selectExpansionPlayer, startExpansionDraft } from "../game/expansion/ExpansionService";
import { advanceRookieDraftAiPick, draftPlayer, getAvailableDraftProspects, prepareRookieDraft } from "../game/draft/DraftService";
import { enterFreeAgency } from "../game/freeAgency/FreeAgencyService";
import { rolloverLeagueYear } from "../game/contracts/ContractLifecycleService";
import { applyInjuryEvents } from "../game/simulation/injuries";
import { prepareEmergencyRostersForDay } from "../game/injuries/EmergencyRosterService";
import { emptyPlayerSeasonStats, type GameState } from "../game/state/types";
import { unlockAchievement } from "../game/career/AchievementService";
import { enqueueEvent, resolveAllEvents } from "../game/events/EventService";
import { lockOpeningRoster } from "../game/roster/RosterService";
import App from "./App";
import { ExpansionCinematic } from "./ExpansionCinematic";
import { createBrowserPlatform } from "../platform/PlatformAdapter";
import { SaveService, type SaveSlotSummary } from "../storage/SaveService";

const CAREER_SEED = "expansion-era-demo";
const launcherSaveService = typeof window === "undefined" ? null : new SaveService(createBrowserPlatform().storage);

const fixtureMode = (): string | null => new URLSearchParams(window.location.search).get("fixture");

function createStage4Fixture(mode: string): GameState {
  const brand = EXPANSION_BRAND_PRESETS.SEA[0];
  let visual = createExpansionTeam(createExpansionCareerFromBundledDataset(CAREER_SEED), {
    cityId: "SEA",
    presetId: brand.presetId,
    teamName: brand.teamName,
    primaryColor: brand.primaryColor,
    secondaryColor: brand.secondaryColor,
  });
  visual = prepareExpansionTrade(resolveOptionPhase(chooseRightsPackage(visual, "A")));
  visual = startExpansionDraft(visual);
  while (visual.league.currentPhase === "EXPANSION_DRAFT") {
    const prospect = getSelectableExpansionPlayers(visual)[0];
    if (!prospect || !visual.expansion) break;
    visual = selectExpansionPlayer(visual, prospect.id, visual.expansion.currentPickIndex + 1);
  }
  if (mode === "stage4-intro") return visual;
  visual = prepareRookieDraft(visual);
  if (mode === "rookie-draft") return visual;
  while (visual.league.currentPhase === "DRAFT") {
    const pick = visual.rookieDraft?.pickOrder[visual.rookieDraft.currentPickIndex];
    if (!pick) break;
    visual = pick.ownerTeamId === visual.userTeamId
      ? draftPlayer(visual, getAvailableDraftProspects(visual)[0].id, pick.pickNumber)
      : advanceRookieDraftAiPick(visual, pick.pickNumber);
  }
  return mode === "free-agency" ? enterFreeAgency(visual) : visual;
}

function createFixturePreview(): GameState {
  if (import.meta.env.DEV && ["stage4-intro", "rookie-draft", "post-draft", "free-agency"].includes(fixtureMode() ?? "")) {
    return createStage4Fixture(fixtureMode() as string);
  }
  if (import.meta.env.DEV && fixtureMode() === "preseason") {
    const preseason = createCareer(CAREER_SEED);
    preseason.league.currentPhase = "PRESEASON";
    return preseason;
  }
  if (import.meta.env.DEV && fixtureMode() === "injury") {
    const injured = createCareer(CAREER_SEED);
    const playerId = injured.teams[injured.userTeamId].playerIds[0];
    injured.players[playerId].teamRole = "FRANCHISE_CORE";
    applyInjuryEvents(injured, [{
      injuryId: "visual-major-injury", playerId, teamId: injured.userTeamId, severity: "LONG", gamesOut: 28,
      gameId: "visual-injury-game", seasonId: injured.league.seasonId,
    }]);
    return injured;
  }
  if (import.meta.env.DEV && fixtureMode() === "emergency") {
    const emergency = createCareer(CAREER_SEED);
    const standardPlayers = emergency.teams[emergency.userTeamId].playerIds
      .map((id) => emergency.players[id])
      .filter((player) => player.contract.status === "STANDARD");
    standardPlayers.slice(0, Math.max(0, standardPlayers.length - 7)).forEach((player) => {
      player.available = false;
      player.rotationRole = "OUT";
    });
    prepareEmergencyRostersForDay(emergency, [emergency.userTeamId]);
    return emergency;
  }
  if (import.meta.env.DEV && fixtureMode() === "history") {
    const history = createCareer(CAREER_SEED);
    history.league.currentPhase = "OFFSEASON";
    history.standings[history.userTeamId].wins = 56;
    history.standings[history.userTeamId].losses = 26;
    history.history.champions.push({ seasonId: history.league.seasonId, teamId: history.userTeamId });
    const roster = history.teams[history.userTeamId].playerIds.map((id) => history.players[id]);
    history.history.seasonAwards.push({
      seasonId: history.league.seasonId,
      allStars: { WEST: roster.slice(0, 2).map((player) => player.id), EAST: [] },
      winners: { MVP: roster[0].id, DPOY: roster[1].id, ROY: roster[2].id, FINALS_MVP: roster[0].id },
    });
    roster[0].career = {
      seasonsPlayed: 14,
      totals: { ...emptyPlayerSeasonStats(), games: 1060, pts: 25_840, reb: 7_280, ast: 6_940 },
      peakOverall: 94.2,
      peakImpact: 97.1,
      unemployedGameDays: 0,
      unemployedLeagueYears: 0,
      careerInjuryGamesMissed: 64,
      honors: { allStar: 10, mvp: 2, dpoy: 0, roy: 1, mip: 0, sixthMan: 0, championships: 2, finalsMvp: 1 },
      hallOfFameEligibleData: true,
      retirementSeason: history.league.seasonId,
      hallOfFame: true,
      hallOfFameClass: 2040,
      hallOfFameScore: 96.4,
    };
    for (const id of ["EXPANSION_COMPLETE", "FIRST_WIN", "TEN_WINS", "FIRST_PLAYOFFS", "FIRST_SERIES_WIN", "FINALS_APPEARANCE", "FIRST_CHAMPIONSHIP"] as const) unlockAchievement(history, id);
    history.gmCareer = { ...history.gmCareer, seasons: 4, regularSeasonWins: 188, regularSeasonLosses: 140, playoffWins: 24, playoffLosses: 16, championships: 1, conferenceTitles: 1, dynastyScore: 2350 };
    return history;
  }
  if (import.meta.env.DEV && fixtureMode() === "event") {
    const event = createCareer(CAREER_SEED);
    enqueueEvent(event, "playoffs_champion_001");
    return event;
  }
  if (import.meta.env.DEV && fixtureMode() === "opening") {
    const event = createCareer(CAREER_SEED);
    event.league.currentPhase = "PRESEASON";
    return lockOpeningRoster(event, true);
  }
  if (import.meta.env.DEV && fixtureMode() === "game") {
    let game = simulateNextGameDay(createCareer(CAREER_SEED));
    game = resolveAllEvents(game);
    game.injuryState.pendingUserMajorInjury = undefined;
    return game;
  }
  if (import.meta.env.DEV && ["rights", "expansion-trade", "expansion-draft"].includes(fixtureMode() ?? "")) {
    const brand = EXPANSION_BRAND_PRESETS.SEA[0];
    let visual = createExpansionTeam(createExpansionCareerFromBundledDataset(CAREER_SEED), {
      cityId: "SEA",
      presetId: brand.presetId,
      teamName: brand.teamName,
      primaryColor: brand.primaryColor,
      secondaryColor: brand.secondaryColor,
    });
    if (fixtureMode() === "rights") return visual;
    if (!visual.expansion?.rightsDraw.resolved) visual = chooseRightsPackage(visual, "A");
    visual = prepareExpansionTrade(resolveOptionPhase(visual));
    if (fixtureMode() === "expansion-trade") return visual;
    return startExpansionDraft(visual);
  }
  const state = createExpansionCareerFromBundledDataset(CAREER_SEED);
  if (!import.meta.env.DEV || fixtureMode() !== "option") return state;
  state.league.currentPhase = "OFFSEASON";
  const player = state.players[state.teams.ATL.playerIds[0]];
  player.teamId = state.userTeamId;
  state.teams.ATL.playerIds = state.teams.ATL.playerIds.filter((id) => id !== player.id);
  state.teams[state.userTeamId].playerIds.push(player.id);
  player.birdTeamId = state.userTeamId;
  player.birdYears = 2;
  player.serviceRosterDays = 82;
  player.contract = {
    salary: 4_000_000, yearsRemaining: 2, guaranteedAmount: 4_000_000, status: "STANDARD",
    optionType: "TEAM", optionDecision: "NOT_APPLICABLE", contractId: "visual-option", contractType: "STANDARD",
    startSeason: 2026, endSeason: 2027, currentYearIndex: 0,
    salaryByYear: [4_000_000, 5_000_000], guaranteedByYear: [4_000_000, 0], optionByYear: ["NONE", "TEAM_OPTION"],
    signedTeamId: state.userTeamId, signedPhase: "VISUAL_FIXTURE",
  };
  return rolloverLeagueYear(state);
}

export default function Bootstrap() {
  const qaFixture = fixtureMode() !== null;
  const introFixture = import.meta.env.DEV && fixtureMode() === "intro";
  const [screen, setScreen] = useState<"home" | "intro" | "game">(introFixture ? "intro" : qaFixture ? "game" : "home");
  const [initialState, setInitialState] = useState<GameState>(() => createFixturePreview());
  const [openLoadOnStart, setOpenLoadOnStart] = useState(false);
  const [sessionKey, setSessionKey] = useState(0);
  const [initialActiveSlot, setInitialActiveSlot] = useState<1 | 2 | 3>(1);
  const [launcherNotice, setLauncherNotice] = useState<string | null>(null);
  const [loadMenuOpen, setLoadMenuOpen] = useState(false);
  const [newGameMenuOpen, setNewGameMenuOpen] = useState(false);
  const [pendingOverwriteSlot, setPendingOverwriteSlot] = useState<1 | 2 | 3 | null>(null);
  const [homeSaveSlots, setHomeSaveSlots] = useState<SaveSlotSummary[]>([]);

  const launchLatest = async () => {
    const latest = await launcherSaveService?.loadMostRecent();
    if (!latest) {
      setLauncherNotice("暂无可继续的存档，请先开始新游戏或读取已有槽位。");
      return;
    }
    setInitialState(latest.state);
    setInitialActiveSlot(latest.slotId);
    setOpenLoadOnStart(false);
    setLauncherNotice(null);
    setSessionKey((value) => value + 1);
    setScreen("game");
  };

  const openLoadMenu = async () => {
    setHomeSaveSlots(await launcherSaveService?.listSlotSummaries() ?? []);
    setLauncherNotice(null);
    setLoadMenuOpen(true);
  };

  const openNewGameMenu = async () => {
    setHomeSaveSlots(await launcherSaveService?.listSlotSummaries() ?? []);
    setLauncherNotice(null);
    setPendingOverwriteSlot(null);
    setNewGameMenuOpen(true);
  };

  const loadFromHome = async (slotId: 1 | 2 | 3) => {
    const loaded = await launcherSaveService?.load(slotId);
    if (!loaded) {
      setLauncherNotice(`槽位 0${slotId} 暂无可读取的存档。`);
      return;
    }
    setInitialState(loaded);
    setInitialActiveSlot(slotId);
    setOpenLoadOnStart(false);
    setLoadMenuOpen(false);
    setSessionKey((value) => value + 1);
    setScreen("game");
  };

  const startNewGame = (slotId: 1 | 2 | 3) => {
    setInitialState(createFixturePreview());
    setInitialActiveSlot(slotId);
    setOpenLoadOnStart(false);
    setPendingOverwriteSlot(null);
    setNewGameMenuOpen(false);
    setSessionKey((value) => value + 1);
    setScreen("intro");
  };

  if (screen === "home") {
    return <main className="launcher-shell home-screen" style={{ backgroundImage: 'linear-gradient(180deg, rgba(2, 6, 16, .28) 0%, rgba(2, 6, 16, .7) 47%, rgba(2, 6, 16, .96) 100%), url("./story/opening-arena.jpg")' }}>
      <section className="launcher-center">
        <div className="launcher-mark"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4h8v4a4 4 0 0 1-8 0V4Z"/><path d="M8 6H4v1a4 4 0 0 0 4 4M16 6h4v1a4 4 0 0 1-4 4M12 12v5M8 21h8M10 17h4v4"/></svg></div>
        <h1>篮球经理：联盟扩军时代</h1>
        <p>管理扩军新星，改写职业篮球历史版图</p>
      </section>
      <section className="launcher-guide" aria-label="游戏说明">
        <b>游戏简介</b>
        <p>这是一个以扩军球队为起点的篮球经营模拟。你将从组建阵容开始，经历选秀、交易、自由市场与完整赛季，在不断变化的联盟中打造属于自己的球队历史。</p>
        <small>每个决定都会影响薪资空间、球队适配度与未来竞争力。</small>
      </section>
      <section className="launcher-actions">
        <button className="launcher-primary" data-testid="start-new-game" onClick={() => void openNewGameMenu()}><i className="launcher-play-icon" aria-hidden="true" /><span>开始新游戏</span></button>
        <button onClick={() => void openLoadMenu()}><i className="launcher-folder-icon" aria-hidden="true" /><span>读取存档</span></button>
        <button className="launcher-dark" onClick={() => void launchLatest()}><i className="launcher-rotate-icon" aria-hidden="true">↻</i><span>继续上次进度</span></button>
      </section>
      {launcherNotice && <p className="launcher-notice" role="status">{launcherNotice}</p>}
      {loadMenuOpen && <div className="home-load-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setLoadMenuOpen(false); }}>
        <section className="home-load-menu" role="dialog" aria-modal="true" aria-label="读取存档">
          <header><div><b>读取存档</b><small>选择一个生涯继续游戏</small></div><button onClick={() => setLoadMenuOpen(false)} aria-label="关闭读取存档">×</button></header>
          <div className="home-load-slots">
            {([1, 2, 3] as const).map((slotId) => {
              const summary = homeSaveSlots.find((slot) => slot.slotId === slotId);
              return <article key={slotId} className={summary ? "has-save" : "empty-save"}>
                <b>槽位 0{slotId} · {summary?.teamName ?? "空存档"}</b>
                <small>{summary ? `${summary.seasonId} · ${summary.currentDate} · ${summary.wins}胜${summary.losses}负 · ${summary.phase}` : "尚未保存任何生涯"}</small>
                <button disabled={!summary} onClick={() => void loadFromHome(slotId)}>{summary ? "读取并继续" : "暂无存档"}</button>
              </article>;
            })}
          </div>
        </section>
      </div>}
      {newGameMenuOpen && <div className="home-load-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) { setNewGameMenuOpen(false); setPendingOverwriteSlot(null); } }}>
        <section className="home-load-menu" role="dialog" aria-modal="true" aria-label="选择新生涯槽位">
          <header><div><b>选择新生涯槽位</b><small>选定后将作为后续自动保存与手动保存的位置</small></div><button onClick={() => { setNewGameMenuOpen(false); setPendingOverwriteSlot(null); }} aria-label="关闭选择槽位">×</button></header>
          <div className="home-load-slots">
            {([1, 2, 3] as const).map((slotId) => {
              const summary = homeSaveSlots.find((slot) => slot.slotId === slotId);
              const needsConfirm = Boolean(summary) && pendingOverwriteSlot === slotId;
              return <article key={slotId} className={`${summary ? "has-save" : "empty-save"}${needsConfirm ? " pending-overwrite" : ""}`}>
                <b>槽位 0{slotId} · {summary?.teamName ?? "空存档"}</b>
                <small className={needsConfirm ? "home-load-warning" : undefined}>{needsConfirm ? `将覆盖「${summary?.teamName}」的现有进度，确认后无法恢复。` : summary ? `${summary.seasonId} · ${summary.currentDate} · ${summary.wins}胜${summary.losses}负 · ${summary.phase}` : "在此位置创建新的扩军生涯"}</small>
                {needsConfirm ? <div className="home-load-confirm-actions"><button className="home-load-cancel" onClick={() => setPendingOverwriteSlot(null)}>取消</button><button onClick={() => startNewGame(slotId)}>确认覆盖</button></div> : <button onClick={() => summary ? setPendingOverwriteSlot(slotId) : startNewGame(slotId)}>{summary ? "覆盖并开始" : "使用此槽位"}</button>}
              </article>;
            })}
          </div>
        </section>
      </div>}
      <small className="launcher-version">版本 2.0.0｜扩军纪念版</small>
    </main>;
  }

  if (screen === "intro") return <ExpansionCinematic state={initialState} onComplete={() => setScreen("game")} />;

  return <App key={sessionKey} initialState={initialState} initialActiveSlot={initialActiveSlot} openSaveOnStart={openLoadOnStart} onExitToHome={() => setScreen("home")} />;
}
