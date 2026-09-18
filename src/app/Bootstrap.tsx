import { useState } from "react";
import { createExpansionCareerFromBundledDataset } from "../data/hupuRoster";
import { EXPANSION_BRAND_PRESETS } from "../data/expansionBrands";
import { createCareer, simulateNextGameDay } from "../game/season/career";
import { chooseRightsPackage, createExpansionTeam, getSelectableExpansionPlayers, prepareExpansionTrade, resolveOptionPhase, selectExpansionPlayer, startExpansionDraft } from "../game/expansion/ExpansionService";
import { draftPlayer, getAvailableDraftProspects, prepareRookieDraft } from "../game/draft/DraftService";
import { enterFreeAgency } from "../game/freeAgency/FreeAgencyService";
import { rolloverLeagueYear } from "../game/contracts/ContractLifecycleService";
import { applyInjuryEvents } from "../game/simulation/injuries";
import { prepareEmergencyRostersForDay } from "../game/injuries/EmergencyRosterService";
import { emptyPlayerSeasonStats, type GameState } from "../game/state/types";
import { unlockAchievement } from "../game/career/AchievementService";
import { enqueueEvent, resolveAllEvents } from "../game/events/EventService";
import App from "./App";
import { ExpansionCinematic } from "./ExpansionCinematic";

const CAREER_SEED = "expansion-era-demo";

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
    const prospect = getAvailableDraftProspects(visual)[0];
    const pick = visual.rookieDraft?.pickOrder[visual.rookieDraft.currentPickIndex];
    if (!prospect || !pick) break;
    visual = draftPlayer(visual, prospect.id, pick.pickNumber);
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
    enqueueEvent(event, "expansion_complete_001");
    return event;
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

  const launch = (load = false) => {
    setInitialState(createFixturePreview());
    setOpenLoadOnStart(load);
    setSessionKey((value) => value + 1);
    setScreen("game");
  };

  const startNewGame = () => {
    setInitialState(createFixturePreview());
    setOpenLoadOnStart(false);
    setSessionKey((value) => value + 1);
    setScreen("intro");
  };

  if (screen === "home") {
    return <main className="launcher-shell home-screen" style={{ backgroundImage: 'linear-gradient(180deg, rgba(2, 6, 16, .28) 0%, rgba(2, 6, 16, .7) 47%, rgba(2, 6, 16, .96) 100%), url("./story/opening-arena.jpg")' }}>
      <section className="launcher-center">
        <div className="launcher-mark"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4h8v4a4 4 0 0 1-8 0V4Z"/><path d="M8 6H4v1a4 4 0 0 0 4 4M16 6h4v1a4 4 0 0 1-4 4M12 12v5M8 21h8M10 17h4v4"/></svg></div>
        <h1>篮球经理：扩军时代</h1>
        <p>管理扩军新星，改写职业篮球历史版图</p>
      </section>
      <section className="launcher-actions">
        <button className="launcher-primary" data-testid="start-new-game" onClick={startNewGame}><i className="launcher-play-icon" aria-hidden="true" /><span>开始新游戏</span></button>
        <button onClick={() => launch(true)}><i className="launcher-folder-icon" aria-hidden="true" /><span>读取存档</span></button>
        <button className="launcher-dark" onClick={() => launch(false)}><i className="launcher-rotate-icon" aria-hidden="true">↻</i><span>继续上次进度</span></button>
      </section>
      <small className="launcher-version">版本 2.0.0｜扩军纪念版</small>
    </main>;
  }

  if (screen === "intro") return <ExpansionCinematic state={initialState} onComplete={() => setScreen("game")} />;

  return <App key={sessionKey} initialState={initialState} openSaveOnStart={openLoadOnStart} onExitToHome={() => setScreen("home")} />;
}
