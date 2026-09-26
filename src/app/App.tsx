import { startTransition, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  createExpansionCareer,
  simulateLeagueDay,
  simulatePostseason,
  simulateRegularSeason,
  simulateToNextEvent,
  standingsForConference,
} from "../game/season/career";
import { executeExpansionCommand, type ExpansionCommand } from "../game/expansion/ExpansionService";
import { executeDraftCommand, type DraftCommand } from "../game/draft/DraftService";
import { executeFreeAgencyCommand, type FreeAgencyCommand } from "../game/freeAgency/FreeAgencyService";
import { executeTeamNotificationCommand, getTeamInboxItems } from "../game/notifications/TeamNotificationService";
import { stableHash } from "../game/random/hash";
import { executeTradeCommand, isTradePhaseAllowed, type TradeCommand } from "../game/trade/TradeService";
import { executeRosterCommand, type RosterCommand } from "../game/roster/RosterService";
import { executeContractLifecycleCommand, type ContractLifecycleCommand } from "../game/contracts/ContractLifecycleService";
import { executeEmergencyRosterCommand, type EmergencyRosterCommand } from "../game/injuries/EmergencyRosterService";
import { getGmLevelLabel } from "../game/career/AchievementService";
import { getGameMvpStat } from "../game/awards/AwardsService";
import { getCapSheet } from "../game/cap/CapSheetService";
import { blockingEvent, choicesForEvent, executeEventCommand, nextPendingEvent, type EventCommand } from "../game/events/EventService";
import type { GameResult, GameState, Player, PlayerBoxScore, Position, Team, TeamRotationPlan } from "../game/state/types";
import { createBrowserPlatform } from "../platform/PlatformAdapter";
import { SaveService, type SaveEnvelope, type SaveSlotSummary } from "../storage/SaveService";
import { ExpansionFlow } from "./ExpansionFlow";
import { Stage4Flow, TradeDesk } from "./Stage4Flow";
import { calculateTeamFit } from "../game/team/TeamFitService";
import { freeAgentAttraction } from "../game/team/TeamSystemService";
import { calculatePlayerOverall } from "../game/player/PlayerRatingService";
import { GameChrome, SeasonNavigation, type SeasonTab } from "./GameChrome";
import { localizePlayerNamesInText, playerNameZh } from "./playerNameZh";
import {
  awardLabel, conferenceLabel, eventCategoryLabel, humanizeUiText,
  moneyLabel, phaseLabel, positionLabel, positionPairLabel, slotLabel,
} from "./uiText";
import { ReferencePlayerCard } from "./ReferencePlayerCard";
import { TeamRosterPanel } from "./TeamRosterPanel";
import { StarterMatchupModal } from "./StarterMatchup";
import { StandingsPanel, type StandingsView } from "./StandingsPanel";
import { LeagueLeadersPanel } from "./LeagueLeadersPanel";
import { LeagueAwardsPanel } from "./LeagueAwardsPanel";
import { CareerPages, type CareerTab } from "./CareerPages";
import { LeagueSchedulePanel } from "./LeagueSchedulePanel";
import { RotationEditor } from "./RotationEditor";
import { ManagementOverview, ManagementContracts, ManagementDraftPicks } from "./ManagementPages";
import { RegularSeasonFreeAgents } from "./RegularSeasonFreeAgents";
import { MarketTradeRecords } from "./MarketTradeRecords";
import { PlayerPortrait } from "./PlayerPortrait";
import { LINEUP_POSITIONS, effectiveStarterAssignments, planPlayerRotationResponse, projectedRotationBench } from "../game/roster/RotationPlanService";
import { SeasonOpeningScreen } from "./SeasonOpeningScreen";
import { BALANCE_CONFIG } from "../config/balanceConfig";
import { EVENT_DEFINITION_BY_ID } from "../data/events";
import { LEAGUE_FINANCE_CONFIG } from "../config/leagueFinance";
import { calculateTeamOverall } from "../game/team/TeamRatingService";
import { playerRatingStyle } from "./playerRatingColor";
import { postgameStatLeaders, sortPostgameBoxRows } from "./postgameStats";

declare global {
  interface Window {
    render_game_to_text: () => string;
    advanceTime: (milliseconds: number) => Promise<void>;
  }
}

const browserPlatform = typeof window === "undefined" ? null : createBrowserPlatform();
const saveService = browserPlatform ? new SaveService(browserPlatform.storage) : null;
const cloudStorage = browserPlatform?.cloudStorage;

const formatRecord = (wins: number, losses: number): string => `${wins}-${losses}`;
const CAREER_TABS: CareerTab[] = ["overview", "achievements", "history", "milestones"];
const playerOverall = calculatePlayerOverall;
const shortMoney = moneyLabel;

function monthLabel(month: string): string {
  if (!month) return "赛程";
  const [year, value] = month.split("-");
  return `${year}年 ${Number(value)}月`;
}

function calendarCells(month: string): Array<string | null> {
  if (!month) return [];
  const [year, value] = month.split("-").map(Number);
  const firstDay = new Date(year, value - 1, 1).getDay();
  const days = new Date(year, value, 0).getDate();
  return [...Array.from({ length: firstDay }, () => null), ...Array.from({ length: days }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`)];
}

interface FiveGameAnimation {
  frames: Array<{ date: string; game?: GameResult }>;
  completed: number;
  totalGames: number;
  label: string;
}

interface SaveConflictState {
  slotId: 1 | 2 | 3;
  local: SaveEnvelope;
  cloud: SaveEnvelope;
}

function calendarDateAtIndex(openingDate: string, dateIndex: number): string {
  const date = new Date(`${openingDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + dateIndex);
  return date.toISOString().slice(0, 10);
}

function App({ initialState = createExpansionCareer("expansion-era-demo"), initialActiveSlot = 1, openSaveOnStart = false, onExitToHome }: { initialState?: GameState; initialActiveSlot?: 1 | 2 | 3; openSaveOnStart?: boolean; onExitToHome?: () => void }) {
  const [state, setState] = useState<GameState>(() => initialState);
  const [openLoadDrawer, setOpenLoadDrawer] = useState(openSaveOnStart);
  const [standingsView, setStandingsView] = useState<StandingsView>("WEST");
  const [status, setStatus] = useState(() => ["REGULAR_SEASON", "REGULAR_PRE_DEADLINE", "REGULAR_POST_DEADLINE"].includes(initialState.league.currentPhase)
    ? "新赛季已开始 · 等待下一项经理决策"
    : `已进入${phaseLabel(initialState.league.currentPhase)}`);
  const [busy, setBusy] = useState(false);
  const [activeSlot, setActiveSlot] = useState<1 | 2 | 3>(initialActiveSlot);
  const [saveSlots, setSaveSlots] = useState<SaveSlotSummary[]>([]);
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [selectedCareerGame, setSelectedCareerGame] = useState<GameResult | null>(null);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [showStarterMatchup, setShowStarterMatchup] = useState(false);
  const [fiveGameAnimation, setFiveGameAnimation] = useState<FiveGameAnimation | null>(null);
  const fiveGameTimer = useRef<number | null>(null);
  const calendarStripRef = useRef<HTMLDivElement>(null);
  const [activeTab, setActiveTab] = useState<SeasonTab>("home");
  const [manageSubTab, setManageSubTab] = useState<"overview" | "roster" | "contracts" | "assets">("overview");
  const [marketSubTab, setMarketSubTab] = useState<"trade" | "free-agents" | "log">("trade");
  const [leagueSubTab, setLeagueSubTab] = useState<"standings" | "leaders" | "awards" | "schedule">("standings");
  const [careerSubTab, setCareerSubTab] = useState<CareerTab>("overview");
  const [calendarMonth, setCalendarMonth] = useState(() => calendarDateAtIndex(initialState.calendar.openingDate, initialState.calendar.currentDateIndex).slice(0, 7));
  const [selectedCalendarGameId, setSelectedCalendarGameId] = useState<string | null>(() => initialState.schedule.find((game) => game.status === "SCHEDULED" && (game.homeTeamId === initialState.userTeamId || game.awayTeamId === initialState.userTeamId))?.id ?? null);
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<string | null>(null);
  const [eventError, setEventError] = useState<string | null>(null);
  const [saveConflict, setSaveConflict] = useState<SaveConflictState | null>(null);
  const refreshSaveSlots = async () => setSaveSlots(await saveService?.listSlotSummaries() ?? []);
  useEffect(() => { void refreshSaveSlots(); }, []);
  const conferenceStandings = useMemo(() => ({
    EAST: standingsForConference(state, "EAST"),
    WEST: standingsForConference(state, "WEST"),
  }), [state]);
  const standings = conferenceStandings[standingsView === "DIVISION" ? "WEST" : standingsView];
  const myTeam = state.teams[state.userTeamId];
  const myRecord = state.standings[state.userTeamId];
  const myTeamFit = useMemo(() => calculateTeamFit(state, state.userTeamId), [state]);
  const myTeamOverall = useMemo(() => calculateTeamOverall(state, state.userTeamId), [state]);
  const myRoster = useMemo(() => myTeam.playerIds.map((id) => state.players[id]).filter(Boolean).sort((left, right) => playerOverall(right) - playerOverall(left) || left.id.localeCompare(right.id)), [state, myTeam.playerIds]);
  const capSheet = useMemo(() => getCapSheet(state, state.userTeamId), [state]);
  const myFreeAgentAttraction = freeAgentAttraction(state, myTeam);
  const playedGames = myRecord.wins + myRecord.losses;
  const nextGame = state.schedule.find((game) => game.status === "SCHEDULED" && (game.homeTeamId === state.userTeamId || game.awayTeamId === state.userTeamId));
  const latestUserGame = [...Object.values(state.userGameDetails)].at(-1);
  const recentUserGames = Object.values(state.userGameDetails).slice(-5).reverse();
  const userSchedule = useMemo(() => state.schedule.filter((game) => game.homeTeamId === state.userTeamId || game.awayTeamId === state.userTeamId), [state.schedule, state.userTeamId]);
  const currentCalendarDate = calendarDateAtIndex(state.calendar.openingDate, state.calendar.currentDateIndex);
  const scheduleMonths = useMemo(() => [...new Set([...userSchedule.map((game) => game.date.slice(0, 7)), currentCalendarDate.slice(0, 7)])].sort(), [userSchedule, currentCalendarDate]);
  const resolvedCalendarMonth = scheduleMonths.includes(calendarMonth) ? calendarMonth : (nextGame?.date.slice(0, 7) ?? scheduleMonths[0] ?? "");
  const monthGames = useMemo(() => new Map(userSchedule.filter((game) => game.date.startsWith(resolvedCalendarMonth)).map((game) => [game.date, game])), [userSchedule, resolvedCalendarMonth]);
  const calendarMonthIndex = Math.max(0, scheduleMonths.indexOf(resolvedCalendarMonth));
  const selectedCalendarGame = (selectedCalendarGameId ? userSchedule.find((game) => game.id === selectedCalendarGameId) : undefined) ?? nextGame ?? userSchedule[0];
  const selectedCalendarResult = selectedCalendarGame ? state.userGameDetails[selectedCalendarGame.id] : undefined;
  const nextOpponent = nextGame ? state.teams[nextGame.homeTeamId === state.userTeamId ? nextGame.awayTeamId : nextGame.homeTeamId] : undefined;
  const nextAwayTeam = nextGame ? state.teams[nextGame.awayTeamId] : undefined;
  const nextHomeTeam = nextGame ? state.teams[nextGame.homeTeamId] : undefined;
  const nextOpponentOverall = useMemo(() => nextOpponent ? calculateTeamOverall(state, nextOpponent.id) : null, [state, nextOpponent]);
  const currentInjuries = myRoster.filter((player) => !player.available || player.injury).slice(0, 2);
  const selectedCalendarDateIsReachable = Boolean(selectedCalendarDate && selectedCalendarDate >= currentCalendarDate);
  const selectedGame = selectedGameId ? state.userGameDetails[selectedGameId] : undefined;
  const selectedPlayer = selectedPlayerId ? state.players[selectedPlayerId] : undefined;
  const selectedTeam = selectedTeamId ? state.teams[selectedTeamId] : undefined;
  const latestAwards = state.history.seasonAwards.at(-1);
  const hallOfFamers = Object.values(state.players).filter((player) => player.career?.hallOfFame)
    .sort((left, right) => (right.career?.hallOfFameClass ?? 0) - (left.career?.hallOfFameClass ?? 0) || left.id.localeCompare(right.id));
  const usesHupuRoster = state.meta.dataVersion.startsWith("hupu.nba.live-roster");
  const queuedEvent = nextPendingEvent(state);
  const simulationBlockingEvent = blockingEvent(state);
  const unlockedAchievements = Object.entries(state.achievements).filter(([, achievement]) => achievement.unlocked);
  const gmLevel = getGmLevelLabel(state);

  useEffect(() => () => {
    if (fiveGameTimer.current !== null) window.clearTimeout(fiveGameTimer.current);
  }, []);

  useLayoutEffect(() => {
    if (activeTab !== "home") return;
    const visibleDate = fiveGameAnimation?.frames[Math.min(fiveGameAnimation.completed, Math.max(0, fiveGameAnimation.frames.length - 1))]?.date ?? currentCalendarDate;
    const strip = calendarStripRef.current;
    const currentButton = strip?.querySelector<HTMLButtonElement>(`[data-calendar-date="${visibleDate}"]`);
    if (!strip || !currentButton) return;
    const stripBounds = strip.getBoundingClientRect();
    const buttonBounds = currentButton.getBoundingClientRect();
    const targetLeft = strip.scrollLeft + buttonBounds.left - stripBounds.left - (strip.clientWidth - currentButton.clientWidth) / 2;
    strip.scrollTo({ left: Math.max(0, targetLeft), behavior: fiveGameAnimation && calendarMonth === visibleDate.slice(0, 7) ? "smooth" : "instant" });
  }, [activeTab, calendarMonth, currentCalendarDate, fiveGameAnimation?.completed, fiveGameAnimation?.frames, queuedEvent?.eventInstanceId]);

  useEffect(() => {
    const expansionFlow = ["TEAM_CREATION", "EXPANSION_RIGHTS", "OPTION_PHASE", "EXPANSION_TRADE", "EXPANSION_DRAFT"].includes(state.league.currentPhase)
      && !(state.league.currentPhase === "OPTION_PHASE" && state.contractLifecycle);
    const stage4Flow = ["ROOKIE_DRAFT_PENDING", "OPTION_PHASE", "OFFSEASON_PRE_DRAFT", "DRAFT", "OFFSEASON_POST_DRAFT", "PRESEASON"].includes(state.league.currentPhase);
    window.render_game_to_text = () => {
      const selectedPlayerId = document.querySelector<HTMLElement>("[data-player-id]")?.dataset.playerId;
      const selectedPlayer = selectedPlayerId ? state.players[selectedPlayerId] : undefined;
      return JSON.stringify(expansionFlow ? {
        screen: "expansion-flow",
        phase: state.league.currentPhase,
        userTeam: state.userTeamId,
        rightsWinner: state.expansion?.rightsDraw.winnerTeamId ?? null,
        rightsResolved: state.expansion?.rightsDraw.resolved ?? false,
        acceptedTrades: state.expansion?.commitments.filter((entry) => entry.expansionTeamId === state.userTeamId).length ?? 0,
        currentPick: state.expansion ? state.expansion.currentPickIndex + 1 : null,
        picksCompleted: state.expansion?.picks.length ?? 0,
        userRoster: state.teams[state.userTeamId].playerIds.length,
        aiRoster: state.expansion ? state.teams[state.expansion.aiTeamId].playerIds.length : 0,
        selectedPlayer: selectedPlayer ? {
          id: selectedPlayer.id,
          name: playerNameZh(selectedPlayer.name, selectedPlayer.id),
          position: selectedPlayer.position,
          secondaryPosition: selectedPlayer.secondaryPosition,
          age: selectedPlayer.age,
          heightCm: selectedPlayer.heightCm,
          weightKg: selectedPlayer.weightKg,
          overall: Math.round(calculatePlayerOverall(selectedPlayer)),
          attributes: selectedPlayer.attributes,
          salary: selectedPlayer.contract.salary,
          yearsRemaining: selectedPlayer.contract.yearsRemaining,
        } : null,
        notice: localizePlayerNamesInText(state.expansion?.lastNotice, Object.values(state.players)) || null,
      } : stage4Flow ? {
        screen: "stage4-manager-flow",
        phase: state.league.currentPhase,
        userTeam: state.userTeamId,
        draft: state.rookieDraft ? {
          currentPick: state.rookieDraft.currentPickIndex + 1,
          picksCompleted: state.rookieDraft.currentPickIndex,
          prospectsAvailable: state.rookieDraft.classPlayerIds.filter((id) => state.players[id].teamId === "FREE_AGENT").length,
          completed: state.rookieDraft.completed,
        } : null,
        freeAgency: state.freeAgency ? {
          day: state.freeAgency.currentDay,
          availablePlayers: Object.values(state.players).filter((player) => player.teamId === "FREE_AGENT").length,
          activeUserOffers: Object.values(state.freeAgency.offers).filter((offer) => offer.teamId === state.userTeamId && offer.status === "ACTIVE").length,
          pendingRfaDecision: state.freeAgency.pendingUserRfaDecision ?? null,
          recentTransactions: state.freeAgency.transactionLog.slice(0, 5).map((entry) => localizePlayerNamesInText(entry, Object.values(state.players))),
        } : null,
        contractLifecycle: state.contractLifecycle ? {
          season: state.contractLifecycle.rolloverSeasonId,
          pendingTeamOptions: state.contractLifecycle.pendingUserTeamOptionPlayerIds.length,
          completed: state.contractLifecycle.completed,
          recentTransactions: state.contractLifecycle.transactionLog.slice(-5).map((entry) => localizePlayerNamesInText(entry, Object.values(state.players))),
        } : null,
        playerLifecycle: state.playerLifecycle ? {
          season: state.playerLifecycle.processedSeasonId,
          developed: state.playerLifecycle.developedPlayerIds.length,
          regressed: state.playerLifecycle.regressedPlayerIds.length,
          retired: state.playerLifecycle.retirementOutflow,
          trained: state.playerLifecycle.trainedPlayerIds.length,
          activePlayers: state.playerLifecycle.activePlayerCount,
          freeAgents: state.playerLifecycle.freeAgentCount,
          averageOverallBefore: state.playerLifecycle.averageOverallBefore,
          averageOverallAfter: state.playerLifecycle.averageOverallAfter,
        } : null,
        trainingPlan: state.trainingPlan ? {
          season: state.trainingPlan.seasonId,
          assignments: state.trainingPlan.assignments,
        } : null,
        rosterSize: state.teams[state.userTeamId].playerIds.length,
      } : {
      screen: "season-dashboard",
      season: state.league.seasonId,
      phase: state.league.currentPhase,
      dateIndex: state.calendar.currentDateIndex,
      userTeam: state.userTeamId,
      activeSaveSlot: activeSlot,
      record: { wins: myRecord.wins, losses: myRecord.losses },
      nextGame: nextGame ? { date: nextGame.date, home: nextGame.homeTeamId, away: nextGame.awayTeamId } : null,
      latestResult: latestUserGame ? {
        home: latestUserGame.homeTeamId,
        away: latestUserGame.awayTeamId,
        homeScore: latestUserGame.homeScore,
        awayScore: latestUserGame.awayScore,
      } : null,
      injuries: {
        pendingMajor: state.injuryState.pendingUserMajorInjury ?? null,
        pendingEmergencyRoster: state.injuryState.pendingEmergencyRoster ?? null,
        recent: state.injuryState.recentEvents.slice(-5),
      },
      latestAwards: latestAwards ? { season: latestAwards.seasonId, winners: latestAwards.winners } : null,
      hallOfFameCount: hallOfFamers.length,
      gmCareer: { ...state.gmCareer, level: gmLevel },
      achievements: unlockedAchievements.map(([id, achievement]) => ({ id, season: achievement.seasonId })),
      teamCore: {
        marketRating: myTeam.marketRating,
        franchiseReputation: myTeam.franchiseReputation,
        fanSupport: myTeam.fanSupport,
        freeAgentAttraction: myFreeAgentAttraction,
      },
      teamFit: myTeamFit,
      teamOverall: myTeamOverall,
      rotation: myTeam.rotationPlan ? { starters: myTeam.rotationPlan.starters, targetMinutes: myTeam.rotationPlan.targetMinutes } : null,
      events: {
        pending: state.eventState.queue.filter((event) => event.status === "PENDING").map((event) => ({ id: event.eventInstanceId, definition: event.definitionId, priority: event.priority, pauses: event.effectivePause })),
        blocking: simulationBlockingEvent?.eventInstanceId ?? null,
      },
      fiveGameAnimation: fiveGameAnimation ? {
        completed: fiveGameAnimation.completed,
        totalDays: fiveGameAnimation.frames.length,
        totalGames: fiveGameAnimation.totalGames,
        currentDate: fiveGameAnimation.frames[Math.min(fiveGameAnimation.completed, fiveGameAnimation.frames.length - 1)]?.date ?? null,
        completedGames: fiveGameAnimation.frames.slice(0, fiveGameAnimation.completed).filter((frame) => frame.game).length,
      } : null,
        topStandings: standings.slice(0, 10).map((record) => ({ team: record.teamId, wins: record.wins, losses: record.losses })),
      });
    };
    window.advanceTime = async () => Promise.resolve();
  }, [state, standings, myRecord, myTeam, myTeamFit, myTeamOverall, myFreeAgentAttraction, nextGame, latestUserGame, latestAwards, hallOfFamers.length, gmLevel, unlockedAchievements.length, simulationBlockingEvent?.eventInstanceId, activeSlot, fiveGameAnimation]);

  const persistState = async (next: GameState, slot: 1 | 2 | 3): Promise<"LOCAL" | "SYNCED" | "CONFLICT"> => {
    if (!saveService) return "LOCAL";
    await saveService.save(slot, next);
    await refreshSaveSlots();
    if (!cloudStorage) return "LOCAL";
    try {
      const sync = await saveService.syncWithCloud(slot, cloudStorage);
      if (sync?.status === "SAVE_CONFLICT") {
        setSaveConflict({ slotId: slot, local: sync.local, cloud: sync.cloud });
        return "CONFLICT";
      }
      return "SYNCED";
    } catch {
      return "LOCAL";
    }
  };

  const changeActiveSlot = (slot: 1 | 2 | 3) => {
    if (!busy) setActiveSlot(slot);
  };

  const run = (label: string, operation: (current: GameState) => GameState) => {
    const targetSlot = activeSlot;
    setBusy(true);
    setStatus(label);
    window.setTimeout(() => {
      void (async () => {
        try {
          const next = operation(state);
          await persistState(next, targetSlot);
          startTransition(() => {
            setState(next);
            setStatus(`完成 · 已自动保存${slotLabel(targetSlot)}`);
          });
        } catch (error) {
          setStatus(error instanceof Error ? humanizeUiText(error.message) : "模拟失败，状态未改变");
        } finally {
          setBusy(false);
        }
      })();
    }, 0);
  };

  const focusCalendarAtCurrentDate = (next: GameState) => {
    const currentDate = calendarDateAtIndex(next.calendar.openingDate, next.calendar.currentDateIndex);
    setCalendarMonth(currentDate.slice(0, 7));
    setSelectedCalendarDate(null);
    const nextUserGame = next.schedule.find((game) => game.status === "SCHEDULED"
      && (game.homeTeamId === next.userTeamId || game.awayTeamId === next.userTeamId)
      && game.dateIndex >= next.calendar.currentDateIndex);
    setSelectedCalendarGameId(nextUserGame?.id ?? null);
    return currentDate;
  };

  const startCalendarAnimation = (label: string, stopWhen: (next: GameState, completedGames: number, simulatedDays: number) => boolean) => {
    if (busy || fiveGameAnimation) return;
    const targetSlot = activeSlot;
    let next = state;
    const frames: FiveGameAnimation["frames"] = [];
    let completedGames = 0;
    while (next.calendar.currentDateIndex < next.calendar.finalDateIndex && !next.injuryState.pendingUserMajorInjury && !next.injuryState.pendingEmergencyRoster && !blockingEvent(next)) {
      const dateIndex = next.calendar.currentDateIndex;
      const knownGames = new Set(Object.keys(next.userGameDetails));
      const day = simulateLeagueDay(next);
      if (day === next) break;
      const game = Object.values(day.userGameDetails).find((entry) => !knownGames.has(entry.gameId));
      frames.push({ date: calendarDateAtIndex(next.calendar.openingDate, dateIndex), game });
      if (game) completedGames += 1;
      next = day;
      if (stopWhen(next, completedGames, frames.length)) break;
    }
    if (!frames.length) {
      setStatus("没有可推进的日期，或有待处理的经理事件");
      return;
    }
    // Single-day feedback should feel immediate; a one-game jump keeps all calendar frames
    // visible while capping the whole hop to roughly one second.
    const frameDelay = label === "模拟 1 天"
      ? 160
      : label === "模拟 1 场"
        ? Math.max(90, Math.min(180, Math.floor(900 / frames.length)))
        : 260;
    const focusAnimationDate = (date: string) => {
      setCalendarMonth(date.slice(0, 7));
    };
    setBusy(true);
    setFiveGameAnimation({ frames, completed: 0, totalGames: completedGames, label });
    focusAnimationDate(frames[0].date);
    setStatus(`${label} · ${frames[0].date} · 0 / ${completedGames} 场`);
    const advance = (completed: number) => {
      if (completed < frames.length) {
        const current = frames[Math.min(completed, frames.length - 1)];
        const finishedGames = frames.slice(0, completed).filter((frame) => frame.game).length;
        setFiveGameAnimation({ frames, completed, totalGames: completedGames, label });
        focusAnimationDate(current.date);
        setStatus(`${label} · ${current.date} · ${finishedGames} / ${completedGames} 场`);
        fiveGameTimer.current = window.setTimeout(() => advance(completed + 1), frameDelay);
        return;
      }
      void (async () => {
        try {
          await persistState(next, targetSlot);
          focusCalendarAtCurrentDate(next);
          startTransition(() => {
            setState(next);
            setStatus(`完成 · ${label}，共 ${frames.length} 天 / ${completedGames} 场并自动保存${slotLabel(targetSlot)}`);
          });
        } catch (error) {
          setStatus(error instanceof Error ? humanizeUiText(error.message) : "赛程推进保存失败，状态未改变");
        } finally {
          setFiveGameAnimation(null);
          setBusy(false);
          fiveGameTimer.current = null;
        }
      })();
    };
    fiveGameTimer.current = window.setTimeout(() => advance(1), frameDelay);
  };

  const simulateNextDay = () => startCalendarAnimation("模拟 1 天", (_next, _games, simulatedDays) => simulatedDays >= 1);

  const simulateNextGame = () => startCalendarAnimation("模拟 1 场", (_next, completedGames) => completedGames >= 1);

  const simulateFive = () => startCalendarAnimation("快进 5 场", (_next, completedGames) => completedGames >= 5);

  const simulateToSelectedDate = () => {
    if (!selectedCalendarDate || !selectedCalendarDateIsReachable) return;
    startCalendarAnimation(`模拟至 ${selectedCalendarDate.slice(5).replace("-", "/")}`, (next) => calendarDateAtIndex(next.calendar.openingDate, next.calendar.currentDateIndex) > selectedCalendarDate);
  };

  const save = async (slot: 1 | 2 | 3 = activeSlot) => {
    if (busy) return;
    setBusy(true);
    setActiveSlot(slot);
    setStatus(`正在原子保存${slotLabel(slot)}…`);
    try {
      const destination = await persistState(state, slot);
      setStatus(destination === "SYNCED" ? `${slotLabel(slot)}已保存并同步` : destination === "CONFLICT" ? `${slotLabel(slot)}已保存 · 需要处理云端冲突` : `${slotLabel(slot)}已保存至本机`);
    } catch (error) {
      setStatus(error instanceof Error ? humanizeUiText(error.message) : `${slotLabel(slot)}保存失败`);
    } finally {
      setBusy(false);
    }
  };

  const readSlot = async (slot: 1 | 2 | 3): Promise<boolean> => {
    setActiveSlot(slot);
    const loaded = await saveService?.load(slot);
    if (loaded && initialState.meta.dataVersion.startsWith("hupu.nba.live-roster") && !loaded.meta.dataVersion.startsWith("hupu.nba.live-roster")) {
      setStatus("旧版虚构名单存档与真实阵容版本不兼容，请重新开局");
      return false;
    }
    if (loaded) {
      setOpenLoadDrawer(false);
      focusCalendarAtCurrentDate(loaded);
      setState(loaded);
    }
    setStatus(loaded ? `已载入${slotLabel(slot)}` : `${slotLabel(slot)}暂无存档`);
    return Boolean(loaded);
  };

  const load = async (slot: 1 | 2 | 3 = activeSlot) => {
    if (busy) return false;
    setBusy(true);
    try {
      return await readSlot(slot);
    } catch (error) {
      setStatus(error instanceof Error ? humanizeUiText(error.message) : `${slotLabel(slot)}读取失败`);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const loadLatest = async () => {
    if (busy) return false;
    setBusy(true);
    try {
      const latest = await saveService?.loadMostRecent();
      if (!latest) {
        setStatus("没有可继续的存档");
        return false;
      }
      return await readSlot(latest.slotId);
    } catch (error) {
      setStatus(error instanceof Error ? humanizeUiText(error.message) : "读取最近存档失败");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const runExpansionCommand = async (command: ExpansionCommand) => {
    if (!saveService) return false;
    const targetSlot = activeSlot;
    setBusy(true);
    setStatus("正在校验并原子提交…");
    try {
      if (command.type === "START_EXPANSION_DRAFT") await saveService.saveCheckpoint(targetSlot, "pre-expansion-draft", state);
      const next = executeExpansionCommand(state, command);
      await persistState(next, targetSlot);
      setState(next);
      setStatus(humanizeUiText(next.expansion?.lastNotice) || "操作完成 · 已自动保存");
      return true;
    } catch (error) {
      setStatus(error instanceof Error ? humanizeUiText(error.message) : "操作失败，状态未改变");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const runDraftCommand = async (command: DraftCommand) => {
    if (!saveService) return;
    const targetSlot = activeSlot;
    setBusy(true);
    setStatus("正在校验选秀事务并自动保存…");
    try {
      if (command.type === "PREPARE_ROOKIE_DRAFT") await saveService.saveCheckpoint(targetSlot, "pre-rookie-draft", state);
      const next = executeDraftCommand(state, command);
      await persistState(next, targetSlot);
      setState(next);
      const nextPick = next.rookieDraft?.pickOrder[next.rookieDraft.currentPickIndex];
      const completedPickNumber = "expectedPickNumber" in command.payload ? command.payload.expectedPickNumber : 0;
      setStatus(next.league.currentPhase === "OFFSEASON_POST_DRAFT"
        ? `新秀选秀完成 · ${next.rookieDraft?.pickOrder.filter((pick) => pick.playerId).length ?? 0} 份合同已结算`
        : nextPick?.ownerTeamId === next.userTeamId
          ? `第 #${nextPick.pickNumber} 顺位 · 轮到你的球队选择`
          : completedPickNumber > 0 ? `第 #${completedPickNumber} 顺位已结算 · 等待继续模拟` : "选秀大厅已就绪 · 开始模拟电脑签位");
    } catch (error) {
      setStatus(error instanceof Error ? humanizeUiText(error.message) : "选秀操作失败，状态未改变");
    } finally {
      setBusy(false);
    }
  };

  const runFreeAgencyCommand = async (command: FreeAgencyCommand) => {
    if (!saveService) return;
    const targetSlot = activeSlot;
    setBusy(true);
    setStatus("正在校验工资帽、报价与球员决策…");
    try {
      if (command.type === "ENTER_FREE_AGENCY") await saveService.saveCheckpoint(targetSlot, "pre-free-agency", state);
      const next = executeFreeAgencyCommand(state, command);
      await persistState(next, targetSlot);
      setState(next);
      setStatus(command.type === "ADVANCE_FA_DAY" ? `自由市场第 ${next.freeAgency?.currentDay} 天 · 今日结算完成` : "报价事务已原子提交并自动保存");
    } catch (error) {
      setStatus(error instanceof Error ? humanizeUiText(error.message) : "自由市场操作失败，状态未改变");
    } finally {
      setBusy(false);
    }
  };

  const markTeamNotificationsRead = async (ids: string[]) => {
    if (!saveService || busy || ids.length === 0) return;
    const targetSlot = activeSlot;
    setBusy(true);
    try {
      const next = executeTeamNotificationCommand(state, {
        commandId: `read-team-notifications-${stableHash(ids)}`,
        type: "MARK_TEAM_NOTIFICATIONS_READ",
        payload: { ids },
      });
      await persistState(next, targetSlot);
      setState(next);
    } catch (error) {
      setStatus(error instanceof Error ? humanizeUiText(error.message) : "通知状态保存失败");
    } finally {
      setBusy(false);
    }
  };

  const runManagerCommand = async (command: TradeCommand | RosterCommand) => {
    if (!saveService) return;
    const targetSlot = activeSlot;
    setBusy(true); setStatus(command.type === "SET_ROTATION_PLAN" ? "正在校验并保存首发与轮换…" : "正在校验交易、名单与工资帽…");
    try {
      const next = command.type === "GENERATE_TRADE_OFFERS" || command.type === "ACCEPT_TRADE_OFFER" ? executeTradeCommand(state, command) : executeRosterCommand(state, command);
      await persistState(next, targetSlot); setState(next); setStatus(command.type === "LOCK_OPENING_ROSTER" ? "开季名单已锁定 · 新赛季正式开始" : command.type === "GENERATE_TRADE_OFFERS" ? `已生成 ${next.tradeDesk.offers.length} 个动态报价 · 适配度变化已计算` : command.type === "ACCEPT_TRADE_OFFER" ? "交易已原子执行并自动保存" : command.type === "SET_ROTATION_PLAN" ? command.payload.plan.selectionMode === "AUTO" ? "已自动匹配并保存首发与轮换" : "已保存首发、替补顺位与目标分钟" : "经理事务已原子提交并自动保存");
    } catch (error) { setStatus(error instanceof Error ? humanizeUiText(error.message) : "操作失败，状态未改变"); } finally { setBusy(false); }
  };

  const runContractCommand = async (command: ContractLifecycleCommand) => {
    if (!saveService) return;
    const targetSlot = activeSlot;
    setBusy(true);
    setStatus("正在统一滚动合同、效力年限与伯德权…");
    try {
      if (command.type === "ROLLOVER_LEAGUE_YEAR") await saveService.saveCheckpoint(targetSlot, `pre-rollover-${state.league.seasonId}`, state);
      const next = executeContractLifecycleCommand(state, command);
      await persistState(next, targetSlot);
      setState(next);
      setStatus(next.league.currentPhase === "OFFSEASON_PRE_DRAFT" ? "合同年度结算完成 · 可以进入新秀选秀" : "合同选项已原子提交并自动保存");
    } catch (error) {
      setStatus(error instanceof Error ? humanizeUiText(error.message) : "合同年度结算失败，状态未改变");
    } finally {
      setBusy(false);
    }
  };

  const runEmergencyRosterCommand = async (command: EmergencyRosterCommand) => {
    if (!saveService) return;
    const targetSlot = activeSlot;
    setBusy(true);
    setStatus("正在生成合法紧急名单并核算按日底薪…");
    try {
      const next = executeEmergencyRosterCommand(state, command);
      await persistState(next, targetSlot);
      setState(next);
      setStatus(`紧急名单已补足至 ${LEAGUE_FINANCE_CONFIG.rosterLimits.emergencyTarget} 人 · 可继续模拟`);
    } catch (error) {
      setStatus(error instanceof Error ? humanizeUiText(error.message) : "紧急名单补员失败，状态未改变");
    } finally {
      setBusy(false);
    }
  };

  const runEventCommand = async (command: EventCommand) => {
    if (!saveService) return;
    const targetSlot = activeSlot;
    const enteringRegularSeason = state.eventState.queue.some((event) => event.eventInstanceId === command.payload.eventInstanceId
      && (event.definitionId === "franchise_season_opening_001"
        || event.definitionId === "expansion_complete_001" && playedGames === 0 && state.history.seasons.length === 0));
    setBusy(true);
    setEventError(null);
    try {
      const next = executeEventCommand(state, command);
      await persistState(next, targetSlot);
      setState(next);
      setStatus(enteringRegularSeason ? "常规赛已开启 · 赛程已公布" : nextPendingEvent(next) ? "事件已处理 · 队列还有待确认事件" : "事件队列已清空 · 可继续模拟");
    } catch (error) {
      const message = error instanceof Error ? humanizeUiText(error.message) : "事件处理失败，状态未改变";
      setEventError(message);
      setStatus(message);
    } finally {
      setBusy(false);
    }
  };

  const restoreExpansionCheckpoint = async () => {
    if (busy) return;
    const targetSlot = activeSlot;
    setBusy(true);
    try {
      const checkpoint = await saveService?.loadCheckpoint(targetSlot, "pre-expansion-draft");
      if (!checkpoint) {
        setStatus("暂无扩军选秀前检查点");
        return;
      }
      await persistState(checkpoint, targetSlot);
      setState(checkpoint);
      setStatus("已恢复扩军选秀前检查点");
    } catch (error) {
      setStatus(error instanceof Error ? humanizeUiText(error.message) : "检查点恢复失败，状态未改变");
    } finally {
      setBusy(false);
    }
  };

  const resolveSaveConflict = async (choice: "LOCAL" | "CLOUD") => {
    if (!saveService || !cloudStorage || !saveConflict) return;
    const conflictSlot = saveConflict.slotId;
    setBusy(true);
    try {
      await saveService.resolveConflict(conflictSlot, cloudStorage, choice);
      const resolved = await saveService.load(conflictSlot);
      if (resolved) setState(resolved);
      setActiveSlot(conflictSlot);
      setSaveConflict(null);
      setStatus(choice === "LOCAL" ? "已使用本机版本并创建新的云端版本" : "已保留本机冲突备份并切换到云端版本");
    } catch (error) {
      setStatus(error instanceof Error ? humanizeUiText(error.message) : "存档冲突处理失败");
    } finally {
      setBusy(false);
    }
  };

  const conflictModal = saveConflict ? <SaveConflictModal conflict={saveConflict} busy={busy} onResolve={resolveSaveConflict} /> : null;
  const eventModal = !saveConflict && queuedEvent && queuedEvent.definitionId !== "franchise_season_opening_001"
    ? <EventCard event={queuedEvent} state={state} pendingCount={state.eventState.queue.filter((event) => event.status === "PENDING").length} busy={busy} error={eventError} onResolve={(command) => void runEventCommand(command)} />
    : null;

  if (["TEAM_CREATION", "EXPANSION_RIGHTS", "OPTION_PHASE", "EXPANSION_TRADE", "EXPANSION_DRAFT"].includes(state.league.currentPhase)
    && !(state.league.currentPhase === "OPTION_PHASE" && state.contractLifecycle)) {
    return <><ExpansionFlow state={state} busy={busy} status={status} onCommand={runExpansionCommand} onSave={save} onLoad={load} onLoadLatest={loadLatest} saveSlots={saveSlots} onRestoreCheckpoint={restoreExpansionCheckpoint} activeSlot={activeSlot} onSlotChange={changeActiveSlot} onHome={onExitToHome} initialDrawerTab={openLoadDrawer ? "load" : undefined} />{eventModal}{conflictModal}</>;
  }

  if (["ROOKIE_DRAFT_PENDING", "OPTION_PHASE", "OFFSEASON_PRE_DRAFT", "DRAFT", "OFFSEASON_POST_DRAFT", "PRESEASON"].includes(state.league.currentPhase)) {
    return <><Stage4Flow state={state} busy={busy} status={status} onCommand={runDraftCommand} onContractCommand={runContractCommand} onFreeAgencyCommand={runFreeAgencyCommand} onTradeCommand={runManagerCommand} onRosterCommand={runManagerCommand} onSave={save} onLoad={load} onLoadLatest={loadLatest} saveSlots={saveSlots} activeSlot={activeSlot} onSlotChange={changeActiveSlot} onHome={onExitToHome} onMarkNotificationsRead={markTeamNotificationsRead} initialDrawerTab={openLoadDrawer ? "load" : undefined} />{eventModal}{conflictModal}</>;
  }

  const seasonOpeningEvent = queuedEvent && (
    queuedEvent.definitionId === "franchise_season_opening_001"
    || queuedEvent.definitionId === "expansion_complete_001" && playedGames === 0 && state.history.seasons.length === 0
  ) ? queuedEvent : null;
  if (seasonOpeningEvent) {
    return <><SeasonOpeningScreen seasonId={state.league.seasonId} teamName={myTeam.fullName} rosterCount={myTeam.playerIds.length} busy={busy} onEnter={() => void runEventCommand({
      commandId: `enter-regular-season-${seasonOpeningEvent.eventInstanceId}`,
      type: "RESOLVE_EVENT",
      payload: { eventInstanceId: seasonOpeningEvent.eventInstanceId, choiceId: seasonOpeningEvent.choices[0]?.id ?? "acknowledge" },
    })} />{conflictModal}</>;
  }

  const phaseDone = state.schedule.every((game) => game.status === "FINAL");
  const visibleRecord = fiveGameAnimation ? {
    wins: myRecord.wins + fiveGameAnimation.frames.slice(0, fiveGameAnimation.completed).flatMap((frame) => frame.game ? [frame.game] : []).filter((game) => game.winnerTeamId === state.userTeamId).length,
    losses: myRecord.losses + fiveGameAnimation.frames.slice(0, fiveGameAnimation.completed).flatMap((frame) => frame.game ? [frame.game] : []).filter((game) => game.winnerTeamId !== state.userTeamId).length,
  } : myRecord;
  const matchupRecord = (team: Team) => team.id === state.userTeamId ? visibleRecord : state.standings[team.id];
  const matchupOverall = (team: Team) => team.id === state.userTeamId ? myTeamOverall.overall : nextOpponentOverall?.overall ?? 0;
  const matchupRank = (team: Team) => conferenceStandings[team.conference].findIndex((record) => record.teamId === team.id) + 1;
  const animatedCalendarIndex = selectedCalendarGame ? fiveGameAnimation?.frames.findIndex((frame) => frame.game?.gameId === selectedCalendarGame.id) ?? -1 : -1;
  const animatedCalendarResult = animatedCalendarIndex >= 0 && fiveGameAnimation && animatedCalendarIndex < fiveGameAnimation.completed ? fiveGameAnimation.frames[animatedCalendarIndex].game : undefined;
  const animatedCalendarDate = fiveGameAnimation?.frames[Math.min(fiveGameAnimation.completed, (fiveGameAnimation.frames.length ?? 1) - 1)]?.date;
  const visibleCalendarDate = animatedCalendarDate ?? currentCalendarDate;
  const displayedCalendarResult = selectedCalendarResult ?? animatedCalendarResult;
  return (
    <main className="app-shell" style={{ "--team-color": myTeam.primaryColor } as React.CSSProperties}>
      <GameChrome phase={state.league.currentPhase} busy={busy} dataLabel="本地球员数据已载入" hidePhaseLabel={activeTab === "home"} onSave={save} onLoad={load} onLoadLatest={loadLatest} activeSlot={activeSlot} saveSlots={saveSlots} onSlotChange={changeActiveSlot} onHome={onExitToHome} initialDrawerTab={openLoadDrawer ? "load" : undefined} notifications={getTeamInboxItems(state)} players={Object.values(state.players)} onMarkNotificationsRead={markTeamNotificationsRead} onHandlePendingNotification={() => setActiveTab("home")} />
      <header id="season-home" className="prototype-team-summary regular-team-banner" hidden>
        <div>
          <div className="section-kicker">{state.league.seasonId} 常规赛</div>
          <h1>{myTeam.fullName}</h1>
          <p>{visibleRecord.wins}胜 - {visibleRecord.losses}负（{conferenceLabel(myTeam.conference)}第 {standingsForConference(state, myTeam.conference).findIndex((record) => record.teamId === state.userTeamId) + 1}）</p>
        </div>
        <LogoMark team={myTeam} />
      </header>

      <section className="status-strip regular-status-strip" aria-live="polite">
        <span className={busy ? "pulse-dot active" : "pulse-dot"} />
        {localizePlayerNamesInText(status, Object.values(state.players))}
      </section>

      {activeTab === "home" && <section className="season-command-center" aria-label="赛季中心">
        <article className="season-command-summary">
          <div><small>赛季概览</small><b>{state.league.seasonId} · {phaseLabel(state.league.currentPhase)}</b><span>{myTeam.fullName} · {visibleRecord.wins}胜{visibleRecord.losses}负 · {conferenceLabel(myTeam.conference)}第 {standingsForConference(state, myTeam.conference).findIndex((record) => record.teamId === state.userTeamId) + 1} · 第 {Math.min(playedGames + 1, userSchedule.length)} / {userSchedule.length} 场</span></div>
          <div className="season-command-ratings"><span><small>球队 OVR</small><strong className="player-rating-tone" style={playerRatingStyle(myTeamOverall.overall)}>{myTeamOverall.overall}</strong><em>总评</em></span></div>
        </article>

        <article className="season-command-calendar">
          <header><div><small>赛程日历</small><b>{monthLabel(resolvedCalendarMonth)}</b></div><span><button type="button" onClick={() => { setCalendarMonth(currentCalendarDate.slice(0, 7)); setSelectedCalendarDate(null); setSelectedCalendarGameId(nextGame?.id ?? null); }}>今天</button><button type="button" aria-label="上个月" disabled={calendarMonthIndex <= 0} onClick={() => setCalendarMonth(scheduleMonths[calendarMonthIndex - 1])}>‹</button><button type="button" aria-label="下个月" disabled={calendarMonthIndex >= scheduleMonths.length - 1} onClick={() => setCalendarMonth(scheduleMonths[calendarMonthIndex + 1])}>›</button></span></header>
          <div className="season-command-date-strip" ref={calendarStripRef} aria-label={`${monthLabel(resolvedCalendarMonth)}赛程`}>
            {calendarCells(resolvedCalendarMonth).filter(Boolean).map((date) => {
              const game = monthGames.get(date!);
              const animationIndex = game ? fiveGameAnimation?.frames.findIndex((frame) => frame.game?.gameId === game.id) ?? -1 : -1;
              const result = game ? state.userGameDetails[game.id] ?? (animationIndex >= 0 && animationIndex < (fiveGameAnimation?.completed ?? 0) ? fiveGameAnimation?.frames[animationIndex].game : undefined) : undefined;
              const isPast = date! < visibleCalendarDate;
              const isCurrent = date === visibleCalendarDate;
              const selected = date === selectedCalendarDate && date !== visibleCalendarDate && !fiveGameAnimation;
              const isAnimating = date === animatedCalendarDate;
              const opponent = game ? state.teams[game.homeTeamId === state.userTeamId ? game.awayTeamId : game.homeTeamId] : undefined;
              return <button type="button" data-calendar-date={date} key={date} className={`${isPast ? "past " : ""}${isCurrent ? "current " : ""}${selected ? "selected " : ""}${isAnimating ? "simulating " : ""}${result ? (result.winnerTeamId === state.userTeamId ? "win" : "loss") : ""}`} onClick={() => {
                if (fiveGameAnimation) return;
                setSelectedCalendarDate(date!);
                if (!game) return;
                setSelectedCalendarGameId(game.id);
                if (result) setSelectedGameId(game.id);
              }}><small>周{["日", "一", "二", "三", "四", "五", "六"][new Date(`${date}T00:00:00`).getDay()]}</small><b>{Number(date!.slice(-2))}</b><em>{result ? <><span>{opponent?.name}</span><i>{result.winnerTeamId === state.userTeamId ? "胜" : "负"}</i></> : isAnimating ? "模拟" : game ? opponent?.name : "休"}</em></button>;
            })}
          </div>
        </article>

        <article className="season-command-matchup">
          <header><div><small>下一场对阵</small><b>{nextGame ? `${nextGame.date} · ${nextGame.homeTeamId === state.userTeamId ? "主场" : "客场"}` : "常规赛已完成"}</b></div><span>第 {String(Math.min(playedGames + 1, userSchedule.length)).padStart(2, "0")} 场</span></header>
          {nextGame && nextAwayTeam && nextHomeTeam ? <>
            <div className="season-command-versus">
              <SeasonMatchupTeamButton team={nextAwayTeam} venue="away" record={matchupRecord(nextAwayTeam)} rank={matchupRank(nextAwayTeam)} overall={matchupOverall(nextAwayTeam)} onOpen={() => setSelectedTeamId(nextAwayTeam.id)} />
              <div><strong>VS</strong><small>客场 · 主场</small><button type="button" className="season-command-starters-trigger" onClick={() => setShowStarterMatchup(true)}>首发对位</button></div>
              <SeasonMatchupTeamButton team={nextHomeTeam} venue="home" record={matchupRecord(nextHomeTeam)} rank={matchupRank(nextHomeTeam)} overall={matchupOverall(nextHomeTeam)} onOpen={() => setSelectedTeamId(nextHomeTeam.id)} />
            </div>
            <button type="button" className="season-command-primary" data-testid="simulate-next-game" disabled={busy || Boolean(simulationBlockingEvent) || Boolean(state.injuryState.pendingUserMajorInjury) || Boolean(state.injuryState.pendingEmergencyRoster)} onClick={simulateNextGame}>模拟下一场比赛</button>
            <div className="season-command-secondary-actions"><button type="button" disabled={busy || Boolean(simulationBlockingEvent)} onClick={simulateNextDay}>推进 1 天</button><button type="button" data-testid="simulate-five" disabled={busy || Boolean(simulationBlockingEvent) || Boolean(fiveGameAnimation)} onClick={simulateFive}>连续模拟 5 场</button></div>
            {selectedCalendarDate && selectedCalendarDate > currentCalendarDate && <button type="button" className="season-command-date-action" disabled={busy || Boolean(simulationBlockingEvent) || !selectedCalendarDateIsReachable} onClick={simulateToSelectedDate}>模拟至 {selectedCalendarDate.slice(5, 7)}月{selectedCalendarDate.slice(8)}日</button>}
          </> : <div className="season-command-complete"><b>常规赛程已经完成</b><p>可以进入附加赛与季后赛结算。</p><button type="button" disabled={busy} onClick={() => run("正在结算附加赛与季后赛…", simulatePostseason)}>结算季后赛</button></div>}
        </article>

        {(recentUserGames.length > 0 || currentInjuries.length > 0) && <div className="season-command-support-grid">
          {recentUserGames.length > 0 && <article><header><b>近期赛果</b><span>最新 {Math.min(recentUserGames.length, 3)} 场</span></header>{recentUserGames.slice(0, 3).map((game) => { const won = game.winnerTeamId === state.userTeamId; const opponent = state.teams[game.homeTeamId === state.userTeamId ? game.awayTeamId : game.homeTeamId]; return <button type="button" key={game.gameId} onClick={() => setSelectedGameId(game.gameId)}><em className={won ? "win" : "loss"}>{won ? "胜" : "负"}</em><div><b>{opponent.name}</b><small>{Number(game.date.slice(5, 7))}月{Number(game.date.slice(8))}日 · {game.homeTeamId === state.userTeamId ? "主场" : "客场"}</small></div><span>{game.awayScore}–{game.homeScore}</span></button>; })}</article>}
          {currentInjuries.length > 0 && <article><header><b>伤病名单</b><span>{currentInjuries.length} 人</span></header>{currentInjuries.map((player) => <button type="button" key={player.id} onClick={() => setSelectedPlayerId(player.id)}><em>缺阵</em><b>{playerNameZh(player.name, player.id)}</b><span>{player.injury ? `剩余 ${player.injury.gamesRemaining} 场` : "暂不可出战"}</span></button>)}</article>}
        </div>}
      </section>}

      <section className="prototype-calendar-card" hidden>
        <header><b>▦ {monthLabel(resolvedCalendarMonth)} 赛程表</b><span><button disabled={calendarMonthIndex <= 0} onClick={() => setCalendarMonth(scheduleMonths[calendarMonthIndex - 1])}>‹</button><button disabled={calendarMonthIndex >= scheduleMonths.length - 1} onClick={() => setCalendarMonth(scheduleMonths[calendarMonthIndex + 1])}>›</button></span></header>
        <div className="calendar-week"><span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span></div>
        <div className="calendar-grid">{calendarCells(resolvedCalendarMonth).map((date, index) => {
          if (!date) return <span className="calendar-empty" key={`empty-${index}`} />;
          const game = monthGames.get(date);
          const animationIndex = game ? fiveGameAnimation?.frames.findIndex((frame) => frame.game?.gameId === game.id) ?? -1 : -1;
          const animating = date === animatedCalendarDate;
          const result = game ? state.userGameDetails[game.id] ?? (animationIndex >= 0 && animationIndex < (fiveGameAnimation?.completed ?? 0) ? fiveGameAnimation?.frames[animationIndex].game : undefined) : undefined;
          // While the five-game sequence is playing, the animation owns the sole calendar focus.
          // Leaving the manually selected game highlighted as well produces two competing boxes.
          const selected = !fiveGameAnimation && game?.id === selectedCalendarGame?.id;
          const won = result?.winnerTeamId === state.userTeamId;
          const opponent = game ? state.teams[game.homeTeamId === state.userTeamId ? game.awayTeamId : game.homeTeamId] : undefined;
          return <button type="button" className={`${selected ? "selected " : ""}${animating ? "simulating" : ""}`} key={date} onClick={() => game && setSelectedCalendarGameId(game.id)}><b>{Number(date.slice(-2))}</b>{game ? <small className={result ? (won ? "win" : "loss") : animating ? "simulating" : "upcoming"}>{result ? `${won ? "胜" : "负"} ${result.awayScore}-${result.homeScore}` : animating ? "模拟中" : `${game.homeTeamId === state.userTeamId ? "主" : "客"} 对 ${opponent?.name}`}</small> : animating && <small className="simulating">休息日</small>}</button>;
        })}</div>
      </section>

      {activeTab === "home" && selectedCalendarGame && <section className="prototype-game-day-card legacy-season-block">
        <header><b>比赛日：{selectedCalendarGame.date.slice(5).replace("-", "月")}日</b><span>{displayedCalendarResult ? "比赛已结束" : animatedCalendarIndex >= 0 ? "正在模拟" : "即将进行的赛事"}</span></header>
        <div className="prototype-matchup"><div><LogoMark team={state.teams[selectedCalendarGame.awayTeamId]} variant="compact" /><b>{state.teams[selectedCalendarGame.awayTeamId].name}</b><small>{formatRecord(state.standings[selectedCalendarGame.awayTeamId].wins, state.standings[selectedCalendarGame.awayTeamId].losses)}</small></div><strong>{displayedCalendarResult ? `${displayedCalendarResult.awayScore} - ${displayedCalendarResult.homeScore}` : "VS"}</strong><div><LogoMark team={state.teams[selectedCalendarGame.homeTeamId]} variant="compact" /><b>{state.teams[selectedCalendarGame.homeTeamId].name}</b><small>{formatRecord(state.standings[selectedCalendarGame.homeTeamId].wins, state.standings[selectedCalendarGame.homeTeamId].losses)}</small></div></div>
        <div className="prototype-game-actions">
          {state.league.currentPhase === "OFFSEASON" ? <button disabled={busy} onClick={() => runContractCommand({ commandId: `rollover-${state.league.seasonId}`, type: "ROLLOVER_LEAGUE_YEAR", payload: {} })}>进入下一联盟年度</button> : phaseDone ? <button disabled={busy} onClick={() => run("正在结算附加赛与季后赛…", simulatePostseason)}>结算季后赛</button> : <>{displayedCalendarResult ? <button onClick={() => setSelectedGameId(selectedCalendarGame.id)}>查看比赛详情</button> : <button disabled={busy || Boolean(state.injuryState.pendingUserMajorInjury) || Boolean(state.injuryState.pendingEmergencyRoster) || Boolean(simulationBlockingEvent)} onClick={simulateNextDay}>模拟下一日</button>}<button className="secondary" data-testid="simulate-five" disabled={busy || Boolean(state.injuryState.pendingUserMajorInjury) || Boolean(state.injuryState.pendingEmergencyRoster) || Boolean(simulationBlockingEvent)} onClick={simulateFive}>{fiveGameAnimation ? `逐日推进 · ${fiveGameAnimation.frames.slice(0, fiveGameAnimation.completed).filter((frame) => frame.game).length} / ${fiveGameAnimation.totalGames} 场` : "逐日推进 5 场赛程"}</button></>}
        </div>
        {!phaseDone && state.league.currentPhase !== "OFFSEASON" && <details className="prototype-more-actions"><summary>更多模拟选项</summary><div><button data-testid="simulate-next-event" disabled={busy || Boolean(state.injuryState.pendingUserMajorInjury) || Boolean(state.injuryState.pendingEmergencyRoster) || Boolean(simulationBlockingEvent)} onClick={() => run("正在模拟到下一经理事件…", simulateToNextEvent)}>模拟到下一事件</button><button disabled={busy || Boolean(state.injuryState.pendingUserMajorInjury) || Boolean(state.injuryState.pendingEmergencyRoster) || Boolean(simulationBlockingEvent)} onClick={() => run("正在结算完整常规赛…", simulateRegularSeason)}>模拟至季后赛</button></div></details>}
      </section>}

      {activeTab === "home" && recentUserGames.length > 0 && <section className="recent-games-card regular-recent-games legacy-season-block"><div className="section-heading"><div><span className="section-kicker">比赛归档</span><h2>最近赛果</h2></div><small>{Object.keys(state.userGameDetails).length} / {userSchedule.length}</small></div><div className="recent-game-list">{recentUserGames.map((game, index) => { const won = game.winnerTeamId === state.userTeamId; const opponent = game.homeTeamId === state.userTeamId ? game.awayTeamId : game.homeTeamId; return <button data-testid={index === 0 ? "latest-game-detail" : undefined} key={game.gameId} onClick={() => setSelectedGameId(game.gameId)}><span className={won ? "game-result win" : "game-result loss"}>{won ? "胜" : "负"}</span><b>{state.teams[opponent].name}</b><small>{game.homeTeamId === state.userTeamId ? "主场" : "客场"}</small><strong>{game.awayScore}–{game.homeScore}</strong></button>; })}</div></section>}

      <section className="next-card legacy-season-block" hidden={activeTab !== "home"}>
        <div className="section-kicker">下一项决策</div>
        {nextGame ? (
          <>
            <div className="matchup-date">{nextGame.date}</div>
            <div className="matchup">
              <TeamBadge id={nextGame.awayTeamId} state={state} />
              <div className="versus"><span>对阵</span><small>{nextGame.homeTeamId === state.userTeamId ? "主场" : "客场"}</small></div>
              <TeamBadge id={nextGame.homeTeamId} state={state} />
            </div>
          </>
        ) : (
          <div className="season-complete">常规赛已完成，可以结算附加赛与季后赛。</div>
        )}
        {latestUserGame && (
          <div className="latest-result">
            上一场 · {state.teams[latestUserGame.awayTeamId].name} {latestUserGame.awayScore} — {latestUserGame.homeScore} {state.teams[latestUserGame.homeTeamId].name}
          </div>
        )}
      </section>

      {state.injuryState.pendingEmergencyRoster && (() => {
        const emergency = state.injuryState.pendingEmergencyRoster;
        return <section className="injury-alert emergency-roster-alert prototype-alert-card" role="alert"><span className="prototype-alert-icon" aria-hidden="true">!</span><div><span className="section-kicker">模拟已暂停 · 紧急名单</span><h2>可用球员仅 {emergency.availableCount} 人</h2><p>比赛名单至少需要 {LEAGUE_FINANCE_CONFIG.rosterLimits.emergencyTarget} 名可用球员，系统将优先签下自由球员，不足时生成临时替补。</p><div className="prototype-alert-meta"><span>当前 <b>{emergency.availableCount}</b> 人</span><span>最低 <b>{LEAGUE_FINANCE_CONFIG.rosterLimits.emergencyTarget}</b> 人</span></div></div><button data-testid="fill-emergency-roster" disabled={busy} onClick={() => runEmergencyRosterCommand({ commandId: `fill-emergency-${state.league.seasonId}-${state.calendar.currentDateIndex}`, type: "FILL_EMERGENCY_ROSTER", payload: { teamId: state.userTeamId } })}>自动补齐至 {LEAGUE_FINANCE_CONFIG.rosterLimits.emergencyTarget} 人 →</button></section>;
      })()}

      <section id="season-manage" className="action-grid legacy-season-block" hidden={activeTab !== "home"}>
        {state.league.currentPhase === "OFFSEASON" ? (
          <button disabled={busy || Boolean(state.injuryState.pendingUserMajorInjury) || Boolean(state.injuryState.pendingEmergencyRoster) || Boolean(simulationBlockingEvent)} onClick={() => runContractCommand({ commandId: `rollover-${state.league.seasonId}`, type: "ROLLOVER_LEAGUE_YEAR", payload: {} })}>进入下一联盟年度</button>
        ) : !phaseDone ? (
          <>
            <button disabled={busy || Boolean(state.injuryState.pendingUserMajorInjury) || Boolean(state.injuryState.pendingEmergencyRoster) || Boolean(simulationBlockingEvent)} onClick={simulateNextDay}>模拟下一日</button>
            <button data-testid="simulate-five" disabled={busy || Boolean(state.injuryState.pendingUserMajorInjury) || Boolean(state.injuryState.pendingEmergencyRoster) || Boolean(simulationBlockingEvent)} className="secondary" onClick={simulateFive}>模拟 5 场</button>
            <button data-testid="simulate-next-event" disabled={busy || Boolean(state.injuryState.pendingUserMajorInjury) || Boolean(state.injuryState.pendingEmergencyRoster) || Boolean(simulationBlockingEvent)} className="ghost" onClick={() => run("正在模拟到下一经理事件…", simulateToNextEvent)}>模拟到下一事件</button>
            <button disabled={busy || Boolean(state.injuryState.pendingUserMajorInjury) || Boolean(state.injuryState.pendingEmergencyRoster) || Boolean(simulationBlockingEvent)} className="ghost" onClick={() => run("正在结算完整常规赛…", simulateRegularSeason)}>模拟至季后赛</button>
          </>
        ) : (
          <button disabled={busy} onClick={() => run("正在结算附加赛与季后赛…", simulatePostseason)}>结算季后赛</button>
        )}
      </section>

      {activeTab === "manage" && <div id="season-management" className="manage-hub">
        <div className="cyber-subnav manage-tabs" role="tablist" aria-label="球队管理">
          {(["overview", "roster", "contracts", "assets"] as const).map((tab) => <button
            type="button" role="tab" id={`manage-tab-${tab}`} aria-controls={`manage-panel-${tab}`}
            aria-selected={manageSubTab === tab} key={tab} className={manageSubTab === tab ? "selected" : ""}
            onClick={() => setManageSubTab(tab)}
          >{({ overview: "概览", roster: "阵容轮换", contracts: "合同薪资", assets: "选秀权" })[tab]}</button>)}
        </div>
        <section id="manage-panel-overview" role="tabpanel" aria-labelledby="manage-tab-overview" hidden={manageSubTab !== "overview"} data-testid="team-fit-card" className="manage-page">
          <ManagementOverview team={myTeam} players={myRoster} record={myRecord} rank={conferenceStandings[myTeam.conference].findIndex((record) => record.teamId === state.userTeamId) + 1} seasonId={state.league.seasonId} overall={myTeamOverall.overall} fit={myTeamFit} onOpenPlayer={setSelectedPlayerId} />
        </section>
        <section id="manage-panel-roster" role="tabpanel" aria-labelledby="manage-tab-roster" hidden={manageSubTab !== "roster"} data-testid="team-roster-card" className="manage-page cyber-manage-roster">
          <div id="season-roster">{myRoster.filter((player) => player.available && !player.injury).length * BALANCE_CONFIG.rotationPlan.regularSeasonMaximumMinutes >= BALANCE_CONFIG.rotationPlan.regulationMinutes
            ? <RotationEditor players={myRoster} plan={myTeam.rotationPlan} postseason={["POSTSEASON", "PLAY_IN", "PLAYOFFS"].includes(state.league.currentPhase)} busy={busy} onSave={(plan: TeamRotationPlan) => void runManagerCommand({ commandId: `rotation-${state.league.seasonId}-${state.calendar.currentDateIndex}-${Object.keys(state.commandReceipts).length}`, type: "SET_ROTATION_PLAN", payload: { plan } })} />
            : <div className="cyber-panel"><h2>可用球员不足</h2><p>目前无法组成完整的 240 分钟轮换。球队会先自动补齐紧急名单，再重新安排首发和轮换。</p></div>}
          </div>
        </section>
        <section id="manage-panel-contracts" role="tabpanel" aria-labelledby="manage-tab-contracts" hidden={manageSubTab !== "contracts"} className="manage-page">
          <ManagementContracts players={myRoster} sheet={capSheet} onOpenPlayer={setSelectedPlayerId} busy={busy} onWaive={["REGULAR_PRE_DEADLINE", "REGULAR_POST_DEADLINE"].includes(state.league.currentPhase) ? (playerId) => runManagerCommand({ commandId: `waive-${state.league.seasonId}-${playerId}-${Object.keys(state.commandReceipts).length}`, type: "WAIVE_PLAYER", payload: { playerId } }) : undefined} />
        </section>
        <section id="manage-panel-assets" role="tabpanel" aria-labelledby="manage-tab-assets" hidden={manageSubTab !== "assets"} className="manage-page">
          <ManagementDraftPicks picks={Object.values(state.draftPicks)} teams={state.teams} userTeamId={state.userTeamId} />
        </section>
      </div>}

      {activeTab === "market" && <div className="market-hub">
        <div className="cyber-subnav market-tabs" role="tablist" aria-label="球员市场">
          {(["trade", "free-agents", "log"] as const).map((tab) => <button key={tab} id={`market-tab-${tab}`} type="button" role="tab" aria-selected={marketSubTab === tab} aria-controls={`market-panel-${tab}`} className={marketSubTab === tab ? "selected" : ""} onClick={() => setMarketSubTab(tab)}>{({ trade: "交易", "free-agents": "自由球员", log: "交易记录" })[tab]}</button>)}
        </div>
        <section id="market-panel-trade" role="tabpanel" aria-labelledby="market-tab-trade" hidden={marketSubTab !== "trade"} className="market-page market-page-content">
          {isTradePhaseAllowed(state.league.currentPhase) ? <TradeDesk state={state} busy={busy} onTradeCommand={runManagerCommand} /> : <div className="manage-page-heading"><div><h2>交易控制台</h2><p>当前阶段交易窗口已关闭；窗口开放后可询价与成交。</p></div><span>已关闭</span></div>}
        </section>
        <section id="market-panel-free-agents" role="tabpanel" aria-labelledby="market-tab-free-agents" hidden={marketSubTab !== "free-agents"} className="market-page market-page-content"><RegularSeasonFreeAgents state={state} onOpenPlayer={setSelectedPlayerId} onCommand={runFreeAgencyCommand} busy={busy} /></section>
        <section id="market-panel-log" role="tabpanel" aria-labelledby="market-tab-log" hidden={marketSubTab !== "log"} className="market-page market-page-content">
          <MarketTradeRecords userTrades={state.gmCareer.tradeHistory} aiTrades={state.aiTradeState.transactionLog} players={state.players} />
        </section>
      </div>}

      {activeTab === "league" && <div id="season-league" className="league-hub">
        <div className="cyber-subnav league-tabs" role="tablist" aria-label="联盟信息">{(["standings", "leaders", "awards", "schedule"] as const).map((tab) => <button key={tab} id={`league-tab-${tab}`} type="button" role="tab" aria-selected={leagueSubTab === tab} aria-controls={`league-panel-${tab}`} className={leagueSubTab === tab ? "selected" : ""} onClick={() => setLeagueSubTab(tab)}>{({ standings: "联盟排名", leaders: "数据榜单", awards: "奖项竞争", schedule: "赛程赛果" })[tab]}</button>)}</div>

        <section id="league-panel-standings" role="tabpanel" aria-labelledby="league-tab-standings" className="league-page" hidden={leagueSubTab !== "standings"}>
          <LeaguePageHeading kicker={`${state.league.seasonId} · 联盟战绩`} title="联盟排名" description="查看东西部及各分区的完整战绩" aside={`${Object.keys(state.teams).length} 支球队`} />
          <div className="league-section-card league-standings-card">
            <div className="league-section-heading"><h3>{standingsView === "DIVISION" ? "分区排名" : `${conferenceLabel(standingsView)}排名`}</h3></div>
            <div className="league-rank-tabs" role="group" aria-label="选择排名范围">
              <button type="button" className={standingsView === "WEST" ? "selected" : ""} onClick={() => setStandingsView("WEST")}>西部</button>
              <button type="button" className={standingsView === "EAST" ? "selected" : ""} onClick={() => setStandingsView("EAST")}>东部</button>
              <button type="button" className={standingsView === "DIVISION" ? "selected" : ""} onClick={() => setStandingsView("DIVISION")}>分区</button>
            </div>
            <StandingsPanel state={state} view={standingsView} conferenceStandings={conferenceStandings} onOpenTeam={setSelectedTeamId} />
          </div>
        </section>

        <section id="league-panel-leaders" role="tabpanel" aria-labelledby="league-tab-leaders" className="league-page" hidden={leagueSubTab !== "leaders"}>
          <LeaguePageHeading kicker={`${state.league.seasonId} · 赛季数据`} title="数据榜单" description="本赛季场均表现最出色的球员" aside="场均领袖" />
          <div className="league-section-card"><div className="league-section-heading"><div><small>球员榜单</small><h3>五项数据前五名</h3></div><span>常规赛 · 场均</span></div>
            <LeagueLeadersPanel state={state} onOpenPlayer={setSelectedPlayerId} />
          </div>
        </section>

        <section id="league-panel-awards" role="tabpanel" aria-labelledby="league-tab-awards" className="league-page" hidden={leagueSubTab !== "awards"}>
          <LeaguePageHeading kicker={`${state.league.seasonId} · 赛季荣誉`} title="奖项竞争" description="五大奖项的赛季候选球员" aside="5 项奖项" />
          <div className="league-section-card"><div className="league-section-heading"><div><small>赛季荣誉</small><h3>奖项候选榜</h3></div><span>常规赛</span></div>
            <LeagueAwardsPanel state={state} conferenceStandings={conferenceStandings} onOpenPlayer={setSelectedPlayerId} />
          </div>
          <div className="league-award-note">候选排名随赛季战绩更新，正式奖项在赛季结束后结算。</div>
        </section>

        <section id="league-panel-schedule" role="tabpanel" aria-labelledby="league-tab-schedule" className="league-page" hidden={leagueSubTab !== "schedule"}>
          <LeaguePageHeading kicker={`${state.league.seasonId} · 联盟赛程`} title="赛程赛果" description="查看全联盟对阵与每日比赛结果" aside={`${state.lightweightResults.length} / ${state.schedule.length} 场`} />
          <div className="league-section-card league-schedule-card"><div className="league-section-heading"><div><small>常规赛</small><h3>每日赛程</h3></div></div>
            <LeagueSchedulePanel state={state} currentDate={currentCalendarDate} />
          </div>
        </section>
      </div>}

      {activeTab === "career" && <>
        <div className="cyber-subnav career-tabs" role="tablist" aria-label="生涯档案">
          {CAREER_TABS.map((tab) => <button key={tab} id={`career-tab-${tab}`} type="button" role="tab" aria-selected={careerSubTab === tab} aria-controls={`career-panel-${tab}`} tabIndex={careerSubTab === tab ? 0 : -1} className={careerSubTab === tab ? "selected" : ""} onClick={() => setCareerSubTab(tab)} onKeyDown={(event) => {
            const current = CAREER_TABS.indexOf(tab);
            const next = event.key === "ArrowRight" ? CAREER_TABS[(current + 1) % CAREER_TABS.length]
              : event.key === "ArrowLeft" ? CAREER_TABS[(current - 1 + CAREER_TABS.length) % CAREER_TABS.length]
                : event.key === "Home" ? CAREER_TABS[0] : event.key === "End" ? CAREER_TABS.at(-1) : undefined;
            if (!next) return;
            event.preventDefault();
            setCareerSubTab(next);
            document.getElementById(`career-tab-${next}`)?.focus();
          }}>{({ overview: "生涯总览", achievements: "成就系统", history: "球队历史", milestones: "里程碑" })[tab]}</button>)}
        </div>
        <CareerPages state={state} activeTab={careerSubTab} onOpenPlayer={setSelectedPlayerId} onOpenGame={setSelectedCareerGame} />
      </>}

      <SeasonNavigation activeTab={activeTab} onChange={setActiveTab} />
      {eventModal}
      {selectedGame && <GameDetailModal key={selectedGame.gameId} game={selectedGame} state={state} onClose={() => setSelectedGameId(null)} />}
      {selectedCareerGame && <GameDetailModal key={selectedCareerGame.gameId} game={selectedCareerGame} state={state} onClose={() => setSelectedCareerGame(null)} />}
      {showStarterMatchup && nextGame && <StarterMatchupModal awayTeam={state.teams[nextGame.awayTeamId]} homeTeam={state.teams[nextGame.homeTeamId]} players={state.players} onClose={() => setShowStarterMatchup(false)} />}
      {selectedTeam && <TeamRosterModal team={selectedTeam} players={selectedTeam.playerIds.map((id) => state.players[id]).filter(Boolean)} ownTeam={selectedTeam.id === state.userTeamId} onClose={() => setSelectedTeamId(null)} onOpenPlayer={setSelectedPlayerId} onManage={() => { setSelectedTeamId(null); setActiveTab("manage"); setManageSubTab("roster"); }} />}
      {selectedPlayer && <PlayerDetailModal player={selectedPlayer} teamName={state.teams[selectedPlayer.teamId]?.fullName ?? "自由球员"} fromRoster={Boolean(selectedTeam)} onClose={() => setSelectedPlayerId(null)} />}
      {conflictModal}
    </main>
  );
}

function TeamRosterModal({ team, players, ownTeam, onClose, onOpenPlayer, onManage }: { team: Team; players: Player[]; ownTeam: boolean; onClose: () => void; onOpenPlayer: (playerId: string) => void; onManage: () => void }) {
  const available = players.filter((player) => player.available && !player.injury);
  const ordered = [...available].sort((left, right) => playerOverall(right) - playerOverall(left) || left.id.localeCompare(right.id));
  const assignments = available.length >= 5 ? effectiveStarterAssignments(players, team.rotationPlan) : team.rotationPlan?.starters;
  const starterIds = new Set<string>();
  const starterPositions = new Map<string, Position>();
  LINEUP_POSITIONS.forEach((position) => {
    const requested = ordered.find((player) => player.id === assignments?.[position] && !starterIds.has(player.id));
    const player = requested ?? ordered.find((candidate) => !starterIds.has(candidate.id) && (candidate.position === position || candidate.secondaryPosition === position)) ?? ordered.find((candidate) => !starterIds.has(candidate.id));
    if (player) {
      starterIds.add(player.id);
      starterPositions.set(player.id, position);
    }
  });
  const reserveIds = new Set(projectedRotationBench(players, team.rotationPlan, starterIds).map((player) => player.id));
  const activeCount = starterIds.size + reserveIds.size;
  return <div className="team-roster-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="team-roster-modal" role="dialog" aria-modal="true" aria-label={`${team.fullName}阵容`}>
      <header><div><small>球队阵容 · 轮换 {activeCount} 人 / 全队 {players.length} 人</small><h2>{team.fullName}</h2></div><button type="button" aria-label="关闭球队阵容" onClick={onClose}>×</button></header>
      <div className="team-roster-modal-content">
        <TeamRosterPanel players={players} variant="preview" onOpenPlayer={onOpenPlayer} previewRotation={{ starterIds, starterPositions, reserveIds, targetMinutes: team.rotationPlan?.targetMinutes }} />
      </div>
      {ownTeam && <footer><button type="button" onClick={onManage}>前往阵容管理</button></footer>}
    </section>
  </div>;
}

function SaveConflictModal({ conflict, busy, onResolve }: { conflict: SaveConflictState; busy: boolean; onResolve: (choice: "LOCAL" | "CLOUD") => Promise<void> }) {
  const summary = (envelope: SaveEnvelope) => {
    const record = envelope.state.standings[envelope.state.userTeamId];
    return `${envelope.state.league.seasonId} · ${record?.wins ?? 0}-${record?.losses ?? 0}`;
  };
  return <div className="event-modal-backdrop"><section className="save-conflict-card" role="dialog" aria-modal="true" aria-label="存档冲突"><span className="prototype-sheet-grabber" aria-hidden="true" /><header className="prototype-sheet-heading"><span className="prototype-sheet-icon">!</span><div><span className="section-kicker">存档冲突 · {slotLabel(conflict.slotId)}</span><h2>请选择要保留的进度</h2></div></header><p>本机与云端都发生了修改，系统不会自动合并完整游戏状态。选择云端前会先保存一份可校验的本机冲突备份。</p><div className="prototype-section-bar"><b>版本对比</b><span>完整覆盖，不合并</span></div><div className="conflict-versions"><span><small>本机版本 {conflict.local.revision}</small><b>{summary(conflict.local)}</b><i>{conflict.local.updatedAt}</i><code>{conflict.local.stateHash.slice(0, 12)}</code></span><span><small>云端版本 {conflict.cloud.revision}</small><b>{summary(conflict.cloud)}</b><i>{conflict.cloud.updatedAt}</i><code>{conflict.cloud.stateHash.slice(0, 12)}</code></span></div><div className="conflict-actions"><button disabled={busy} onClick={() => void onResolve("LOCAL")}>保留本机版本</button><button disabled={busy} className="secondary" onClick={() => void onResolve("CLOUD")}>使用云端版本</button></div></section></div>;
}

function PlayerDetailModal({ player, teamName, fromRoster, onClose }: { player: Player; teamName: string; fromRoster: boolean; onClose: () => void }) {
  const displayName = playerNameZh(player.name, player.id);
  return <div className={`player-detail-backdrop${fromRoster ? " from-team-roster" : ""}`} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="reference-player-dialog" role="dialog" aria-modal="true" aria-label={`${displayName} 球员详情`}><button className="detail-close" onClick={onClose} aria-label="关闭">×</button><ReferencePlayerCard player={player} teamName={teamName} /></section></div>;
}

function PostgamePlayerName({ name }: { name: string }) {
  const nameRef = useRef<HTMLElement>(null);
  const [fontSize, setFontSize] = useState(12);

  useLayoutEffect(() => {
    const updateSize = () => {
      const nameElement = nameRef.current;
      const cell = nameElement?.parentElement;
      if (!nameElement || !cell) return;
      const badge = cell.querySelector<HTMLElement>(".postgame-position-badge");
      const availableWidth = cell.clientWidth - (badge?.offsetWidth ?? 0) - 18;
      const context = document.createElement("canvas").getContext("2d");
      if (!context || availableWidth <= 0) return;
      const style = window.getComputedStyle(nameElement);
      context.font = `${style.fontWeight} 12px ${style.fontFamily}`;
      const fullSizeWidth = context.measureText(name).width;
      const nextSize = fullSizeWidth > availableWidth
        ? Math.max(8, Math.floor((12 * availableWidth / fullSizeWidth) * 10) / 10)
        : 12;
      setFontSize((current) => current === nextSize ? current : nextSize);
    };

    updateSize();
    const cell = nameRef.current?.parentElement;
    const observer = cell ? new ResizeObserver(updateSize) : null;
    if (cell) observer?.observe(cell);
    return () => observer?.disconnect();
  }, [name]);

  return <b ref={nameRef} className="postgame-player-name" style={{ fontSize: `${fontSize}px` }}>{name}</b>;
}

function PostgameMvpName({ name }: { name: string }) {
  const nameRef = useRef<HTMLElement>(null);
  const [fontSize, setFontSize] = useState(15);

  useLayoutEffect(() => {
    const updateSize = () => {
      const nameElement = nameRef.current;
      const container = nameElement?.parentElement;
      if (!nameElement || !container) return;
      const availableWidth = container.clientWidth;
      const context = document.createElement("canvas").getContext("2d");
      if (!context || availableWidth <= 0) return;
      const style = window.getComputedStyle(nameElement);
      context.font = `${style.fontWeight} 15px ${style.fontFamily}`;
      const fullSizeWidth = context.measureText(name).width;
      const nextSize = fullSizeWidth > availableWidth
        ? Math.max(8, Math.floor((15 * availableWidth / fullSizeWidth) * 10) / 10)
        : 15;
      setFontSize((current) => current === nextSize ? current : nextSize);
    };

    updateSize();
    const container = nameRef.current?.parentElement;
    const observer = container ? new ResizeObserver(updateSize) : null;
    if (container) observer?.observe(container);
    return () => observer?.disconnect();
  }, [name]);

  return <b ref={nameRef} className="postgame-mvp-name" style={{ fontSize: `${fontSize}px` }} title={name}>{name}</b>;
}

export function GameDetailModal({ game, state, onClose }: { game: GameResult; state: GameState; onClose: () => void }) {
  const [activeTeamId, setActiveTeamId] = useState(game.awayTeamId);
  const activeTeam = state.teams[activeTeamId];
  const activeBox = activeTeamId === game.awayTeamId ? game.awayBoxScore : game.homeBoxScore;
  const statLeaders = activeBox ? postgameStatLeaders(activeBox.playerStats) : null;
  const best = getGameMvpStat(game);
  const periods = Math.max(game.homePeriodScores?.length ?? 0, game.awayPeriodScores?.length ?? 0);
  const displayedPeriods = Math.max(periods, 4);
  const teams = [state.teams[game.awayTeamId], state.teams[game.homeTeamId]];
  const fgPercent = (stat: PlayerBoxScore) => stat.fga ? `${Math.round(stat.fgm / stat.fga * 100)}%` : "—";
  const TeamBox = ({ team, score, venue }: { team: typeof teams[number]; score: number; venue: "away" | "home" }) => {
    const won = game.winnerTeamId === team.id;
    const scoreView = <strong className={won ? "score-win" : "score-lose"}>{score}</strong>;
    return <div className={`postgame-team-box ${venue}`}>
      {venue === "home" && scoreView}
      <div className="postgame-team-identity"><LogoMark team={team} variant="compact" /><b>{team.name}</b></div>
      {venue === "away" && scoreView}
    </div>;
  };
  const mvpName = best && (state.players[best.playerId] ? playerNameZh(state.players[best.playerId].name, state.players[best.playerId].id) : best.playerId);
  return <section className="postgame-page" aria-label="比赛详情">
    <header className="postgame-page-header postgame-modal-header">
      <div><span>比赛详情 · {game.date}</span><h2>赛后数据中心</h2></div>
      <button className="postgame-page-back" type="button" onClick={onClose} aria-label="返回赛季页">← 返回</button>
    </header>
    <div className="postgame-page-body postgame-modal-body" tabIndex={0}>
      <section className="postgame-score-banner">
        <TeamBox team={teams[0]} score={game.awayScore} venue="away" />
        <div className="postgame-status"><b>比赛结束</b><small>{game.overtimePeriods ? `${game.overtimePeriods} 个加时` : "常规时间"}</small></div>
        <TeamBox team={teams[1]} score={game.homeScore} venue="home" />
      </section>
      <section className="postgame-quarter-section">
        <header><b>分节比分</b><small>{periods ? (periods > 4 ? `${periods - 4} 个加时` : "常规时间") : "历史记录未保存"}</small></header>
        <div className="postgame-table-scroll"><table className="postgame-quarter-table">
          <thead><tr><th>球队</th>{Array.from({ length: displayedPeriods }, (_, index) => <th key={index}>{index < 4 ? `第${index + 1}节` : `加时${index - 3}`}</th>)}<th>总分</th></tr></thead>
          <tbody>{teams.map((team, teamIndex) => {
            const scores = teamIndex === 0 ? game.awayPeriodScores ?? [] : game.homePeriodScores ?? [];
            return <tr key={team.id}><td>{team.name}</td>{Array.from({ length: displayedPeriods }, (_, index) => <td className={scores[index] !== undefined && scores[index] === Math.max(...scores) ? "high" : ""} key={index}>{scores[index] ?? "—"}</td>)}<td>{teamIndex === 0 ? game.awayScore : game.homeScore}</td></tr>;
          })}</tbody>
        </table></div>
      </section>
      {best && <section className="postgame-mvp-card"><div><span>MVP</span><div className="postgame-mvp-copy"><small>本场最佳球员</small><PostgameMvpName name={mvpName!} /></div></div><strong>{best.pts}分 · {best.reb}篮板 · {best.ast}助攻</strong></section>}
      <section className="postgame-roster-section">
        <div className="postgame-roster-tabs" role="tablist" aria-label="按球队查看球员数据">
          {teams.map((team, index) => <button type="button" role="tab" id={`postgame-tab-${team.id}`} aria-controls="postgame-roster-panel" aria-selected={activeTeamId === team.id} tabIndex={activeTeamId === team.id ? 0 : -1} className={activeTeamId === team.id ? "active" : ""} style={{ "--postgame-team-color": team.primaryColor } as React.CSSProperties} key={team.id} onClick={() => setActiveTeamId(team.id)} onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            const nextIndex = (index + (event.key === "ArrowRight" ? 1 : -1) + teams.length) % teams.length;
            setActiveTeamId(teams[nextIndex].id);
            event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]?.focus();
          }}><i aria-hidden="true" />{index === 0 ? "客场" : "主场"} · {team.name}</button>)}
        </div>
        <article className="postgame-roster-card" id="postgame-roster-panel" role="tabpanel" aria-labelledby={`postgame-tab-${activeTeamId}`} style={{ "--postgame-team-color": activeTeam.primaryColor } as React.CSSProperties}>
          {activeBox ? <div className="postgame-table-scroll"><table className="postgame-box-table">
            <thead><tr><th>球员</th><th>时间</th><th>得分</th><th>篮板</th><th>助攻</th><th>抢断</th><th>盖帽</th><th>FG%</th><th>+/-</th></tr></thead>
            <tbody>{sortPostgameBoxRows(activeBox.playerStats).map((stat) => {
              const player = state.players[stat.playerId];
              const name = player ? playerNameZh(player.name, player.id) : stat.playerId;
              return <tr key={stat.playerId} data-player-id={stat.playerId}>
                <td><span className="postgame-position-badge">{player ? positionLabel(player.position) : "—"}</span><PostgamePlayerName name={name} /></td>
                <td>{Math.round(stat.seconds / 60)}′</td>
                <td className={statLeaders?.pts === stat.playerId ? "team-leader" : ""}>{stat.pts}</td>
                <td className={statLeaders?.reb === stat.playerId ? "team-leader" : ""}>{stat.reb}</td>
                <td className={statLeaders?.ast === stat.playerId ? "team-leader" : ""}>{stat.ast}</td>
                <td className={statLeaders?.stl === stat.playerId ? "team-leader" : ""}>{stat.stl}</td>
                <td className={statLeaders?.blk === stat.playerId ? "team-leader" : ""}>{stat.blk}</td>
                <td>{fgPercent(stat)}</td><td className="postgame-pm-neutral">—</td>
              </tr>;
            })}</tbody>
          </table></div> : <p className="postgame-roster-empty">该队本场球员数据未保存。</p>}
        </article>
      </section>
    </div>
  </section>;
}

function EventCard({ event, state, pendingCount, busy, error, onResolve }: {
  event: NonNullable<ReturnType<typeof nextPendingEvent>>;
  state: GameState;
  pendingCount: number;
  busy: boolean;
  error: string | null;
  onResolve: (command: EventCommand) => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const choices = choicesForEvent(event);
  const playerId = choices.flatMap((choice) => choice.effects).find((effect) => effect.type === "PLAYER_MORALE" || effect.type === "PLAYER_FORM")?.target;
  const player = playerId ? state.players[playerId] : undefined;
  const categoryLabel = eventCategoryLabel(event.category);
  const conversation = player && choices.length > 1;
  const description = conversation ? EVENT_DEFINITION_BY_ID[event.definitionId]?.content.description ?? event.description : event.description;
  const teamPlayers = state.teams[state.userTeamId].playerIds.map((id) => state.players[id]).filter(Boolean);
  const rotationPreview = player ? planPlayerRotationResponse(teamPlayers, state.teams[state.userTeamId].rotationPlan,
    player.id, event.definitionId === "role_starter_claim_001") : null;
  const currentMinutes = player ? state.teams[state.userTeamId].rotationPlan?.targetMinutes[player.id] ?? 0 : 0;
  const plannedMinutes = player ? rotationPreview?.targetMinutes[player.id] ?? currentMinutes : 0;
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.querySelector<HTMLButtonElement>(".event-dialog-choice")?.focus();
    return () => { if (previousFocus?.isConnected) previousFocus.focus(); };
  }, [event.eventInstanceId]);
  const impactText = (choice: typeof choices[number]): string => {
    const impact = choice.effects.map((effect) => {
      if (effect.type === "LEAGUE_LOG") return "记录至联盟动态";
      if (typeof effect.value !== "number") return "";
      const change = `${effect.value > 0 ? "+" : ""}${effect.value}`;
      if (effect.type === "TEAM_FAN_SUPPORT") return `球迷支持 ${change}`;
      if (effect.type === "TEAM_REPUTATION") return `球队声望 ${change}`;
      if (effect.type === "PLAYER_MORALE") return `球员士气 ${change}`;
      if (effect.type === "PLAYER_ROTATION") return rotationPreview
        ? `目标时间 ${currentMinutes}→${plannedMinutes} 分钟${event.definitionId === "role_starter_claim_001" && player?.rotationRole !== "STARTER" ? " · 调整首发" : ""}`
        : "当前阵容无法增加出场时间";
      return `竞技状态 ${change}`;
    }).filter(Boolean);
    return impact.join(" · ") || "确认后继续赛程";
  };
  return createPortal(<div className="event-modal-backdrop event-dialog-backdrop" role="presentation">
    <section ref={dialogRef} data-testid="event-card" data-category={event.category} className="event-dialog" role="dialog" aria-modal="true" aria-labelledby="event-dialog-title" aria-describedby="event-dialog-description" aria-busy={busy} onKeyDown={(keyEvent) => {
      if (keyEvent.key === "Escape") keyEvent.preventDefault();
      if (keyEvent.key !== "Tab") return;
      const buttons = [...(dialogRef.current?.querySelectorAll<HTMLButtonElement>(".event-dialog-choice:not(:disabled)") ?? [])];
      if (!buttons.length) return;
      if (keyEvent.shiftKey && document.activeElement === buttons[0]) { keyEvent.preventDefault(); buttons.at(-1)?.focus(); }
      else if (!keyEvent.shiftKey && document.activeElement === buttons.at(-1)) { keyEvent.preventDefault(); buttons[0].focus(); }
    }}>
      <header className="event-dialog-top"><span className="event-dialog-context"><span>赛季事件</span><b>{categoryLabel}</b></span><small>{pendingCount > 1 ? `待处理 ${pendingCount} 则` : "待你处理"}</small></header>
      <div className="event-dialog-hero"><h2 id="event-dialog-title">{localizePlayerNamesInText(event.title, Object.values(state.players))}</h2></div>
      {conversation ? <div className="event-dialog-conversation"><div><strong>{playerNameZh(player.name, player.id)}</strong><span>对你说</span></div><blockquote id="event-dialog-description">“{localizePlayerNamesInText(humanizeUiText(description), Object.values(state.players))}”</blockquote></div>
        : <p id="event-dialog-description" className="event-dialog-description">{localizePlayerNamesInText(humanizeUiText(description), Object.values(state.players))}</p>}
      <div className="event-dialog-action-heading"><b>{choices.length > 1 ? "你的决定" : "事件影响"}</b><span>选择后立即生效</span></div>
      <div className="event-dialog-choices">{choices.map((choice) => <button key={choice.id} type="button" className={`event-dialog-choice${choice.effects.some((effect) => typeof effect.value === "number" && effect.value < 0) ? " is-negative" : ""}`} disabled={busy} onClick={() => onResolve({ commandId: `event-${event.eventInstanceId}-${choice.id}`, type: "RESOLVE_EVENT", payload: { eventInstanceId: event.eventInstanceId, choiceId: choice.id } })}><span><b>{choice.id === "acknowledge" ? "确认并继续" : choice.label}</b><small>{impactText(choice)}</small></span><i aria-hidden="true">→</i></button>)}</div>
      {error && <p className="event-dialog-error" role="alert">{error}</p>}
      {pendingCount > 1 && <p className="event-dialog-next">处理后将展示下一则事件</p>}
    </section>
  </div>, document.body);
}

function TeamBadge({ id, state }: { id: string; state: GameState }) {
  const team = state.teams[id];
  return (
    <div className="team-badge">
      <LogoMark team={team} />
      <b>{team.city}</b>
      <span>{team.name}</span>
    </div>
  );
}

function SeasonMatchupTeamButton({ team, venue, record, rank, overall, onOpen }: { team: Team; venue: "away" | "home"; record: { wins: number; losses: number }; rank: number; overall: number; onOpen: () => void }) {
  return <button type="button" data-venue={venue} data-team-id={team.id} onClick={onOpen} aria-label={`查看${team.fullName}阵容`}>
    <LogoMark team={team} /><b>{team.name}</b><small>{formatRecord(record.wins, record.losses)} · {conferenceLabel(team.conference)}第{rank}</small><strong className="player-rating-tone" style={playerRatingStyle(overall)}>{overall}</strong>
  </button>;
}

function LogoMark({ team, variant = "large" }: { team: GameState["teams"][string]; variant?: "large" | "compact" }) {
  const [imageFailed, setImageFailed] = useState(false);
  const className = `${variant === "compact" ? "mini-logo" : "logo-disc"}${team.id === "SEA" || team.id === "LVG" ? " expansion-team-logo" : ""}`;
  const background = `linear-gradient(145deg, ${team.primaryColor}, ${team.secondaryColor})`;
  return (
    <span className={className} style={{ background }} aria-label={`${team.fullName} 队徽`}>
      {team.logoUrl && !imageFailed ? (
        <img src={team.logoUrl} alt="" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} />
      ) : (
        <span className="logo-fallback" aria-hidden="true">{team.name.slice(0, 2)}</span>
      )}
    </span>
  );
}

function LeaguePageHeading({ kicker, title, description, aside }: { kicker: string; title: string; description: string; aside: string }) {
  return <header className="league-page-heading"><div><small>{kicker}</small><h2>{title}</h2><p>{description}</p></div><strong>{aside}</strong></header>;
}

export default App;
