import { useEffect, useRef, useState } from "react";
import { createExpansionCareerFromBundledDataset } from "../data/hupuRoster";
import { EXPANSION_BRAND_PRESETS } from "../data/expansionBrands";
import { createCareer, simulateNextGameDay } from "../game/season/career";
import { chooseRightsPackage, confirmExpansionSummary, createExpansionTeam, getSelectableExpansionPlayers, prepareExpansionTrade, resolveOptionPhase, selectExpansionPlayer, startExpansionDraft } from "../game/expansion/ExpansionService";
import { advanceRookieDraftAiPick, draftPlayer, getAvailableDraftProspects, prepareRookieDraft } from "../game/draft/DraftService";
import { enterFreeAgency } from "../game/freeAgency/FreeAgencyService";
import { rolloverLeagueYear } from "../game/contracts/ContractLifecycleService";
import { getRfaCapHoldAmount } from "../game/contracts/ContractRules";
import { applyInjuryEvents } from "../game/simulation/injuries";
import { prepareEmergencyRostersForDay } from "../game/injuries/EmergencyRosterService";
import { emptyPlayerSeasonStats, type GameState } from "../game/state/types";
import { unlockAchievement } from "../game/career/AchievementService";
import { enqueueEvent, resolveAllEvents } from "../game/events/EventService";
import { lockOpeningRoster } from "../game/roster/RosterService";
import App from "./App";
import { BasketballSeamLoader } from "./BasketballSeamLoader";
import { ExpansionCinematic } from "./ExpansionCinematic";
import { GameChrome } from "./GameChrome";
import { createBrowserPlatform } from "../platform/PlatformAdapter";
import { SaveService, type SaveSlotSummary } from "../storage/SaveService";
import { phaseLabel } from "./uiText";
import { formatBeijingSaveTime } from "./saveTime";
import { clearLeaderboardReturn, leaderboardReturnSlot } from "./leaderboardReturn";

const CAREER_SEED = "expansion-era-demo";
const launcherSaveService = typeof window === "undefined" ? null : new SaveService(createBrowserPlatform().storage);
type LauncherLoading = "latest" | "slots" | "creating" | `slot-${1 | 2 | 3}`;
const SAVE_SLOT_PREVIEW: SaveSlotSummary = {
  slotId: 1,
  teamName: "西雅图海潮",
  seasonId: "2026-27",
  currentDate: "2026-10-18",
  phase: "PRESEASON",
  wins: 0,
  losses: 0,
  updatedAt: "2026-09-28T00:05:59.000Z",
  revision: 3,
};

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
  if (mode === "expansion-summary") return visual;
  visual = confirmExpansionSummary(visual);
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
  if (mode === "qualifying-offer") {
    const player = Object.values(visual.players).find((candidate) => candidate.teamId === "FREE_AGENT" && candidate.contract.status === "UFA");
    if (player) {
      player.contract.status = "RFA";
      player.contract.qualifyingOfferDecision = "PENDING";
      player.birdTeamId = visual.userTeamId;
      player.birdYears = 4;
      visual.capState.capHolds = visual.capState.capHolds.filter((hold) => hold.playerId !== player.id);
      visual.capState.capHolds.push({ playerId: player.id, teamId: visual.userTeamId, amount: getRfaCapHoldAmount(player), type: "RFA" });
    }
    return visual;
  }
  return mode === "free-agency" ? enterFreeAgency(visual) : visual;
}

function createFixturePreview(): GameState {
  if (import.meta.env.DEV && fixtureMode() === "lottery") {
    const future = createCareer(CAREER_SEED);
    future.league.currentPhase = "OFFSEASON_PRE_DRAFT";
    future.league.seasonYear = 2027;
    future.league.seasonId = "2027-28";
    return prepareRookieDraft(future);
  }
  if (import.meta.env.DEV && ["expansion-summary", "stage4-intro", "rookie-draft", "post-draft", "qualifying-offer", "free-agency"].includes(fixtureMode() ?? "")) {
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
  if (import.meta.env.DEV && fixtureMode() === "event-choices") {
    const event = createCareer(CAREER_SEED);
    const player = event.players[event.teams[event.userTeamId].playerIds[0]];
    enqueueEvent(event, "role_veteran_reduced_001", { player_id: player.id, player_name: player.name });
    enqueueEvent(event, "streak_winning_003");
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

function LauncherAnnouncementBody() {
  return <div className="launcher-announcement-body">
    <p><strong>致各位玩家：</strong></p>
    <p>感谢大家自上线以来的体验与反馈，也很抱歉目前游戏中还存在一些影响体验的问题。大家提出的每一条建议我都会认真查看，并积极修复和优化。我会继续努力完善游戏，希望给大家带来更好的游戏体验。</p>
    <p>针对近期玩家反馈，我对游戏体验进行了集中优化：</p>
    <ul>
      <li><strong>伤病与轮换：</strong>伤病后自动调整轮换，仅在可用人数不足时触发紧急补员，减少比赛中断。</li>
      <li><strong>补员机制：</strong>优化紧急补员与开幕补员逻辑，避免补入过强球员影响阵容平衡。</li>
      <li><strong>体能系统：</strong>提高休息日体能恢复效果，减少频繁调整轮换的情况。</li>
      <li><strong>合同与续约：</strong>新增球员提前续约功能，可在合同到期前向本队球员提交续约报价。</li>
      <li><strong>选秀与交易：</strong>修复选秀前交易中心部分情况下出现黑屏的问题。</li>
      <li><strong>生涯与通知：</strong>减少里程碑及历史成就的重复通知，修复老存档相关问题。</li>
    </ul>
    <p><strong>感谢大家的反馈，我会继续根据实际体验持续调整和优化。</strong></p>
  </div>;
}

export default function Bootstrap() {
  const loadingFixture = import.meta.env.DEV && fixtureMode() === "loading";
  const saveSlotsFixture = import.meta.env.DEV && fixtureMode() === "save-slots";
  const qaFixture = import.meta.env.DEV && fixtureMode() !== null && !loadingFixture && !saveSlotsFixture;
  const introFixture = import.meta.env.DEV && fixtureMode() === "intro";
  const [returnSlot] = useState(leaderboardReturnSlot);
  const [screen, setScreen] = useState<"home" | "intro" | "game" | "restoring">(introFixture ? "intro" : qaFixture ? "game" : returnSlot ? "restoring" : "home");
  const [initialState, setInitialState] = useState<GameState>(() => createFixturePreview());
  const [openLoadOnStart, setOpenLoadOnStart] = useState(false);
  const [sessionKey, setSessionKey] = useState(0);
  const [initialActiveSlot, setInitialActiveSlot] = useState<1 | 2 | 3>(1);
  const [restoredFromLeaderboard, setRestoredFromLeaderboard] = useState(false);
  const [launcherNotice, setLauncherNotice] = useState<string | null>(null);
  const [announcementOpen, setAnnouncementOpen] = useState(false);
  const [loadMenuOpen, setLoadMenuOpen] = useState(false);
  const [newGameMenuOpen, setNewGameMenuOpen] = useState(false);
  const [pendingOverwriteSlot, setPendingOverwriteSlot] = useState<1 | 2 | 3 | null>(null);
  const [homeSaveSlots, setHomeSaveSlots] = useState<SaveSlotSummary[]>([]);
  const [launcherLoading, setLauncherLoading] = useState<LauncherLoading | null>(loadingFixture ? "latest" : null);
  const launcherLoadInFlight = useRef(false);
  const restoreStarted = useRef(false);

  useEffect(() => {
    if (screen !== "restoring" || !returnSlot || restoreStarted.current) return;
    restoreStarted.current = true;
    void (async () => {
      try {
        const loaded = await launcherSaveService?.load(returnSlot);
        if (!loaded) throw new Error(`槽位 0${returnSlot} 暂无可读取的存档。`);
        setInitialState(loaded);
        setInitialActiveSlot(returnSlot);
        setRestoredFromLeaderboard(true);
        setSessionKey((value) => value + 1);
        setScreen("game");
      } catch (error) {
        clearLeaderboardReturn();
        setLauncherNotice(error instanceof Error ? `恢复生涯失败：${error.message}` : "恢复生涯失败，请手动读取存档。");
        setScreen("home");
      }
    })();
  }, [returnSlot, screen]);

  useEffect(() => {
    if (!announcementOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAnnouncementOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [announcementOpen]);

  const runLauncherLoad = async (kind: LauncherLoading, action: () => Promise<void>) => {
    if (launcherLoadInFlight.current) return;
    launcherLoadInFlight.current = true;
    setLauncherLoading(kind);
    setLauncherNotice(null);
    try {
      // Let the loading state paint before parsing and migrating a large save.
      await new Promise<void>((resolve) => window.setTimeout(resolve, 32));
      await action();
    } catch (error) {
      setLauncherNotice(error instanceof Error ? `${kind === "creating" ? "新生涯保存" : "读取"}失败：${error.message}` : "存档操作失败，请重试。");
    } finally {
      launcherLoadInFlight.current = false;
      setLauncherLoading(null);
    }
  };

  const launchLatest = () => runLauncherLoad("latest", async () => {
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
  });

  const openLoadMenu = () => runLauncherLoad("slots", async () => {
    setHomeSaveSlots(await launcherSaveService?.listSlotSummaries() ?? []);
    setLoadMenuOpen(true);
  });

  const openNewGameMenu = () => runLauncherLoad("slots", async () => {
    setHomeSaveSlots(await launcherSaveService?.listSlotSummaries() ?? []);
    setPendingOverwriteSlot(null);
    setNewGameMenuOpen(true);
  });

  const loadFromHome = (slotId: 1 | 2 | 3) => runLauncherLoad(`slot-${slotId}`, async () => {
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
  });

  const startNewGame = (slotId: 1 | 2 | 3) => runLauncherLoad("creating", async () => {
    const next = createFixturePreview();
    const summary = homeSaveSlots.find((slot) => slot.slotId === slotId);
    await launcherSaveService?.save(slotId, next, { rebuildCorrupted: summary?.status === "CORRUPTED" });
    setInitialState(next);
    setInitialActiveSlot(slotId);
    setOpenLoadOnStart(false);
    setPendingOverwriteSlot(null);
    setNewGameMenuOpen(false);
    setSessionKey((value) => value + 1);
    setScreen("intro");
  });

  if (saveSlotsFixture) {
    return <main className="app-shell"><GameChrome phase="PRESEASON" initialDrawerTab="load" activeSlot={1} saveSlots={[SAVE_SLOT_PREVIEW]} onHome={() => undefined} /></main>;
  }

  if (screen === "home") {
    const loadingLabel = launcherLoading === "latest" ? "正在继续上次进度…"
      : launcherLoading === "creating" ? "正在保存新生涯…" : launcherLoading === "slots" ? "正在读取存档列表…"
        : launcherLoading ? `正在读取槽位 0${launcherLoading.slice(-1)}…` : "";
    return <main className="launcher-shell home-screen" style={{ backgroundImage: 'linear-gradient(180deg, rgba(2, 6, 16, .28) 0%, rgba(2, 6, 16, .7) 47%, rgba(2, 6, 16, .96) 100%), url("./story/opening-arena.jpg")' }}>
      <section className="launcher-center">
        <div className="launcher-mark"><img src="./branding/home-logo-display.webp" alt="" width={660} height={660} fetchPriority="high" decoding="async" /></div>
        <h1>篮球经理：联盟扩军时代</h1>
        <p>管理扩军新星，改写职业篮球历史版图</p>
      </section>
      <section className="launcher-guide" aria-label="游戏说明">
        <b>游戏简介</b>
        <p>这是一个以扩军球队为起点的篮球经营模拟。你将从组建阵容开始，经历选秀、交易、自由市场与完整赛季，在不断变化的联盟中打造属于自己的球队历史。</p>
        <small>每个决定都会影响薪资空间、球队适配度与未来竞争力。</small>
      </section>
      <section className="launcher-actions">
        <button className="launcher-primary" data-testid="start-new-game" disabled={Boolean(launcherLoading)} onClick={() => void openNewGameMenu()}><svg className="launcher-action-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false"><rect x="2" y="3" width="20" height="18" rx="4" stroke="currentColor" strokeWidth="2" /><polygon points="10,8 16,12 10,16" fill="currentColor" /></svg><span>开始新游戏</span></button>
        <button disabled={Boolean(launcherLoading)} onClick={() => void openLoadMenu()}><svg className="launcher-action-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false"><path d="M3 7C3 5.89543 3.89543 5 5 5H9.58579C10.1162 5 10.625 5.21071 11 5.58579L12.4142 7H19C20.1046 7 21 7.89543 21 9V17C21 18.1046 20.1046 19 19 19H5C3.89543 19 3 18.1046 3 17V7Z" stroke="currentColor" strokeWidth="2" /><path d="M12 10V15M12 15L9.5 12.5M12 15L14.5 12.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg><span>读取存档</span></button>
        <button className="launcher-dark" disabled={Boolean(launcherLoading)} onClick={() => void launchLatest()}><svg className="launcher-action-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false"><path d="M 12 4 A 8 8 0 1 1 5.5 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><path d="M 4 4 L 5.5 8 L 9.5 6.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><polygon points="10.5,10 14.5,12 10.5,14" fill="currentColor" /></svg><span>继续上次进度</span></button>
      </section>
      <section className="launcher-announcement" aria-label="更新公告">
        <div className="launcher-announcement-summary"><span><b>更新公告 · 2026年10月2日</b><small>本次游戏优化和修复内容</small></span><button type="button" onClick={() => setAnnouncementOpen(true)}>查看详情</button></div>
      </section>
      {launcherNotice && !loadMenuOpen && !newGameMenuOpen && <p className="launcher-notice" role="status">{launcherNotice}</p>}
      {announcementOpen && <div className="launcher-announcement-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setAnnouncementOpen(false); }}>
        <section className="launcher-announcement-dialog" role="dialog" aria-modal="true" aria-labelledby="launcher-announcement-title">
          <header><div><b id="launcher-announcement-title">更新公告</b><small>2026年10月2日 · 本次游戏优化和修复内容</small></div><button type="button" onClick={() => setAnnouncementOpen(false)} aria-label="关闭更新公告">×</button></header>
          <LauncherAnnouncementBody />
        </section>
      </div>}
      {loadMenuOpen && <div className="home-load-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !launcherLoading) setLoadMenuOpen(false); }}>
        <section className="home-load-menu" role="dialog" aria-modal="true" aria-label="读取存档">
          <header><div><b>读取存档</b><small>选择一个生涯继续游戏</small></div><button disabled={Boolean(launcherLoading)} onClick={() => setLoadMenuOpen(false)} aria-label="关闭读取存档">×</button></header>
          {launcherNotice && <p className="home-load-error" role="alert">{launcherNotice}</p>}
          <div className="home-load-slots">
            {([1, 2, 3] as const).map((slotId) => {
              const summary = homeSaveSlots.find((slot) => slot.slotId === slotId);
              return <article key={slotId} className={summary ? "has-save" : "empty-save"}>
                <b>槽位 0{slotId} · {summary?.status === "UNAVAILABLE" ? "暂时无法读取" : summary?.status === "CORRUPTED" ? "存档损坏" : summary?.teamName ?? "空存档"}</b>
                <small>{summary?.status === "UNAVAILABLE" ? "存储暂时不可用，请重试读取" : summary?.status === "CORRUPTED" ? "自动恢复失败，请重试读取，或在新游戏菜单确认重建" : summary ? `${summary.seasonId} · ${summary.currentDate} · ${summary.wins}胜${summary.losses}负 · ${phaseLabel(summary.phase)}` : "尚未保存任何生涯"}</small>
                {summary && !summary.status && <time className="save-slot-time" dateTime={summary.updatedAt}>最后保存：{formatBeijingSaveTime(summary.updatedAt)}（北京时间）</time>}
                <button disabled={!summary || Boolean(launcherLoading)} onClick={() => void loadFromHome(slotId)}>{summary?.status ? "重试读取" : summary ? "读取并继续" : "暂无存档"}</button>
              </article>;
            })}
          </div>
        </section>
      </div>}
      {newGameMenuOpen && <div className="home-load-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !launcherLoading) { setNewGameMenuOpen(false); setPendingOverwriteSlot(null); } }}>
        <section className="home-load-menu" role="dialog" aria-modal="true" aria-label="选择新生涯槽位">
          <header><div><b>选择新生涯槽位</b><small>选定后将作为后续自动保存与手动保存的位置</small></div><button disabled={Boolean(launcherLoading)} onClick={() => { setNewGameMenuOpen(false); setPendingOverwriteSlot(null); }} aria-label="关闭选择槽位">×</button></header>
          {launcherNotice && <p className="home-load-error" role="alert">{launcherNotice}</p>}
          <div className="home-load-slots">
            {([1, 2, 3] as const).map((slotId) => {
              const summary = homeSaveSlots.find((slot) => slot.slotId === slotId);
              const needsConfirm = Boolean(summary) && pendingOverwriteSlot === slotId;
              const corrupted = summary?.status === "CORRUPTED";
              const unavailable = summary?.status === "UNAVAILABLE";
              return <article key={slotId} className={`${summary ? "has-save" : "empty-save"}${needsConfirm ? " pending-overwrite" : ""}`}>
                <b>槽位 0{slotId} · {summary?.status === "UNAVAILABLE" ? "暂时无法读取" : summary?.status === "CORRUPTED" ? "存档损坏" : summary?.teamName ?? "空存档"}</b>
                <small className={needsConfirm ? "home-load-warning" : undefined}>{needsConfirm ? corrupted ? "将重建此损坏槽位，原有进度将被覆盖，确认后无法恢复。" : `将覆盖「${summary?.teamName}」的现有进度，确认后无法恢复。` : unavailable ? "存储暂时不可用，请重试读取后再创建新生涯" : corrupted ? "存档无法自动恢复，可确认重建新的生涯" : summary ? `${summary.seasonId} · ${summary.currentDate} · ${summary.wins}胜${summary.losses}负 · ${phaseLabel(summary.phase)}` : "在此位置创建新的扩军生涯"}</small>
                {summary && !summary.status && !needsConfirm && <time className="save-slot-time" dateTime={summary.updatedAt}>最后保存：{formatBeijingSaveTime(summary.updatedAt)}（北京时间）</time>}
                {needsConfirm ? <div className="home-load-confirm-actions"><button className="home-load-cancel" disabled={Boolean(launcherLoading)} onClick={() => setPendingOverwriteSlot(null)}>取消</button><button disabled={Boolean(launcherLoading)} onClick={() => void startNewGame(slotId)}>{corrupted ? "确认重建" : "确认覆盖"}</button></div> : <button disabled={unavailable || Boolean(launcherLoading)} onClick={() => summary ? setPendingOverwriteSlot(slotId) : void startNewGame(slotId)}>{unavailable ? "读取不可用" : corrupted ? "重建并开始" : summary ? "覆盖并开始" : "使用此槽位"}</button>}
              </article>;
            })}
          </div>
        </section>
      </div>}
      {launcherLoading && <div className="launcher-loading-backdrop" role="status" aria-live="polite"><div className="launcher-loading-card"><BasketballSeamLoader /><b>{loadingLabel}</b><small>{launcherLoading === "slots" ? "正在检查可用存档，请稍候" : launcherLoading === "creating" ? "正在将新生涯写入选定槽位，请稍候" : "正在校验并恢复游戏进度，请稍候"}</small></div></div>}
      <small className="launcher-version">从扩军开始，打造你的王朝</small>
    </main>;
  }

  if (screen === "intro") return <ExpansionCinematic state={initialState} onComplete={() => setScreen("game")} />;

  if (screen === "restoring") return <main className="launcher-shell home-screen" role="status" aria-live="polite"><div className="launcher-loading-backdrop"><div className="launcher-loading-card"><BasketballSeamLoader /><b>正在返回生涯总览…</b><small>正在恢复刚才的存档</small></div></div></main>;

  return <App key={sessionKey} initialState={initialState} initialActiveSlot={initialActiveSlot} initialActiveTab={restoredFromLeaderboard ? "career" : "home"} openSaveOnStart={openLoadOnStart} onExitToHome={() => { clearLeaderboardReturn(); setRestoredFromLeaderboard(false); setScreen("home"); }} />;
}
