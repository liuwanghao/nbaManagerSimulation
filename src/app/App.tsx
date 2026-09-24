import { startTransition, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { executeInjuryCommand, type InjuryCommand } from "../game/injuries/InjuryService";
import { executeEmergencyRosterCommand, type EmergencyRosterCommand } from "../game/injuries/EmergencyRosterService";
import { ACHIEVEMENT_LABELS, getGmLevelLabel } from "../game/career/AchievementService";
import { getAwardRace, getGameMvpStat, getLeagueLeaders } from "../game/awards/AwardsService";
import { getCapSheet } from "../game/cap/CapSheetService";
import { blockingEvent, choicesForEvent, executeEventCommand, nextPendingEvent, type EventCommand } from "../game/events/EventService";
import type { GameResult, GameState, Player, PlayerBoxScore, TeamRole } from "../game/state/types";
import { createBrowserPlatform } from "../platform/PlatformAdapter";
import { SaveService, type SaveEnvelope, type SaveSlotSummary } from "../storage/SaveService";
import { ExpansionFlow } from "./ExpansionFlow";
import { Stage4Flow, TradeDesk } from "./Stage4Flow";
import { calculateTeamFit, fitGrade } from "../game/team/TeamFitService";
import { freeAgentAttraction } from "../game/team/TeamSystemService";
import { calculatePlayerOverall } from "../game/player/PlayerRatingService";
import { GameChrome, SeasonNavigation, type SeasonTab } from "./GameChrome";
import { playerNameZh } from "./playerNameZh";
import {
  awardLabel, conferenceLabel, divisionLabel, eventCategoryLabel, humanizeUiText, injurySeverityLabel,
  moneyLabel, phaseLabel, positionLabel, slotLabel, teamRoleLabel,
} from "./uiText";
import { ReferencePlayerCard } from "./ReferencePlayerCard";
import { TeamRosterPanel } from "./TeamRosterPanel";
import { SeasonOpeningScreen } from "./SeasonOpeningScreen";
import { BALANCE_CONFIG } from "../config/balanceConfig";
import { LEAGUE_FINANCE_CONFIG } from "../config/leagueFinance";

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

interface SimulationSummary {
  games: number;
  wins: number;
  losses: number;
  rankBefore: number;
  rankAfter: number;
  topPlayer?: { name: string; points: number; rebounds: number; assists: number };
  injuries: number;
  queuedEvents: number;
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

function buildSimulationSummary(before: GameState, after: GameState): SimulationSummary | null {
  const beforeIds = new Set(Object.keys(before.userGameDetails));
  const games = Object.values(after.userGameDetails).filter((game) => !beforeIds.has(game.gameId));
  if (!games.length) return null;
  const conference = after.teams[after.userTeamId].conference;
  const rankBefore = standingsForConference(before, conference).findIndex((record) => record.teamId === before.userTeamId) + 1;
  const rankAfter = standingsForConference(after, conference).findIndex((record) => record.teamId === after.userTeamId) + 1;
  const totals = new Map<string, { points: number; rebounds: number; assists: number }>();
  for (const game of games) {
    const box = game.homeTeamId === after.userTeamId ? game.homeBoxScore : game.awayBoxScore;
    for (const stat of box?.playerStats ?? []) {
      const total = totals.get(stat.playerId) ?? { points: 0, rebounds: 0, assists: 0 };
      total.points += stat.pts;
      total.rebounds += stat.reb;
      total.assists += stat.ast;
      totals.set(stat.playerId, total);
    }
  }
  const top = [...totals.entries()].sort((left, right) => right[1].points - left[1].points || left[0].localeCompare(right[0]))[0];
  const previousUserInjuries = new Set(before.injuryState.recentEvents.filter((event) => event.teamId === before.userTeamId).map((event) => event.injuryId));
  return {
    games: games.length,
    wins: games.filter((game) => game.winnerTeamId === after.userTeamId).length,
    losses: games.filter((game) => game.winnerTeamId !== after.userTeamId).length,
    rankBefore,
    rankAfter,
    topPlayer: top ? { name: after.players[top[0]]?.name ?? top[0], ...top[1] } : undefined,
    injuries: after.injuryState.recentEvents.filter((event) => event.teamId === after.userTeamId && !previousUserInjuries.has(event.injuryId)).length,
    queuedEvents: after.eventState.queue.filter((event) => event.status === "PENDING").length,
  };
}

function App({ initialState = createExpansionCareer("expansion-era-demo"), initialActiveSlot = 1, openSaveOnStart = false, onExitToHome }: { initialState?: GameState; initialActiveSlot?: 1 | 2 | 3; openSaveOnStart?: boolean; onExitToHome?: () => void }) {
  const [state, setState] = useState<GameState>(() => initialState);
  const [openLoadDrawer, setOpenLoadDrawer] = useState(openSaveOnStart);
  const [conference, setConference] = useState<"WEST" | "EAST">("WEST");
  const [status, setStatus] = useState(() => ["REGULAR_SEASON", "REGULAR_PRE_DEADLINE", "REGULAR_POST_DEADLINE"].includes(initialState.league.currentPhase)
    ? "新赛季已开始 · 等待下一项经理决策"
    : `已进入${phaseLabel(initialState.league.currentPhase)}`);
  const [busy, setBusy] = useState(false);
  const [activeSlot, setActiveSlot] = useState<1 | 2 | 3>(initialActiveSlot);
  const [saveSlots, setSaveSlots] = useState<SaveSlotSummary[]>([]);
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [simulationSummary, setSimulationSummary] = useState<SimulationSummary | null>(null);
  const [fiveGameAnimation, setFiveGameAnimation] = useState<FiveGameAnimation | null>(null);
  const fiveGameTimer = useRef<number | null>(null);
  const calendarStripRef = useRef<HTMLDivElement>(null);
  const [activeTab, setActiveTab] = useState<SeasonTab>("home");
  const [manageSubTab, setManageSubTab] = useState<"overview" | "roster" | "contracts" | "training" | "assets">("overview");
  const [marketSubTab, setMarketSubTab] = useState<"trade" | "free-agents" | "offers" | "log">("trade");
  const [leagueSubTab, setLeagueSubTab] = useState<"standings" | "leaders" | "awards" | "history">("standings");
  const [careerSubTab, setCareerSubTab] = useState<"overview" | "achievements" | "history" | "milestones">("overview");
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const firstUserGame = initialState.schedule.find((game) => game.homeTeamId === initialState.userTeamId || game.awayTeamId === initialState.userTeamId);
    return firstUserGame?.date.slice(0, 7) ?? "";
  });
  const [selectedCalendarGameId, setSelectedCalendarGameId] = useState<string | null>(() => initialState.schedule.find((game) => game.status === "SCHEDULED" && (game.homeTeamId === initialState.userTeamId || game.awayTeamId === initialState.userTeamId))?.id ?? null);
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<string | null>(null);
  const [saveConflict, setSaveConflict] = useState<SaveConflictState | null>(null);
  const refreshSaveSlots = async () => setSaveSlots(await saveService?.listSlotSummaries() ?? []);
  useEffect(() => { void refreshSaveSlots(); }, []);
  const standings = useMemo(() => standingsForConference(state, conference), [state, conference]);
  const myTeam = state.teams[state.userTeamId];
  const myRecord = state.standings[state.userTeamId];
  const myTeamFit = useMemo(() => calculateTeamFit(state, state.userTeamId), [state]);
  const myRoster = useMemo(() => myTeam.playerIds.map((id) => state.players[id]).filter(Boolean).sort((left, right) => playerOverall(right) - playerOverall(left) || left.id.localeCompare(right.id)), [state, myTeam.playerIds]);
  const capSheet = useMemo(() => getCapSheet(state, state.userTeamId), [state]);
  const myFreeAgentAttraction = freeAgentAttraction(state, myTeam);
  const playedGames = myRecord.wins + myRecord.losses;
  const nextGame = state.schedule.find((game) => game.status === "SCHEDULED" && (game.homeTeamId === state.userTeamId || game.awayTeamId === state.userTeamId));
  const latestUserGame = [...Object.values(state.userGameDetails)].at(-1);
  const recentUserGames = Object.values(state.userGameDetails).slice(-5).reverse();
  const userSchedule = useMemo(() => state.schedule.filter((game) => game.homeTeamId === state.userTeamId || game.awayTeamId === state.userTeamId), [state.schedule, state.userTeamId]);
  const scheduleMonths = useMemo(() => [...new Set(userSchedule.map((game) => game.date.slice(0, 7)))], [userSchedule]);
  const resolvedCalendarMonth = scheduleMonths.includes(calendarMonth) ? calendarMonth : (nextGame?.date.slice(0, 7) ?? scheduleMonths[0] ?? "");
  const monthGames = useMemo(() => new Map(userSchedule.filter((game) => game.date.startsWith(resolvedCalendarMonth)).map((game) => [game.date, game])), [userSchedule, resolvedCalendarMonth]);
  const calendarMonthIndex = Math.max(0, scheduleMonths.indexOf(resolvedCalendarMonth));
  const selectedCalendarGame = (selectedCalendarGameId ? userSchedule.find((game) => game.id === selectedCalendarGameId) : undefined) ?? nextGame ?? userSchedule[0];
  const selectedCalendarResult = selectedCalendarGame ? state.userGameDetails[selectedCalendarGame.id] : undefined;
  const nextOpponent = nextGame ? state.teams[nextGame.homeTeamId === state.userTeamId ? nextGame.awayTeamId : nextGame.homeTeamId] : undefined;
  const nextOpponentRoster = nextOpponent?.playerIds.map((id) => state.players[id]).filter(Boolean).sort((left, right) => playerOverall(right) - playerOverall(left) || left.id.localeCompare(right.id)) ?? [];
  const featuredPlayer = myRoster[0];
  const featuredOpponent = nextOpponentRoster[0];
  const currentInjuries = myRoster.filter((player) => !player.available || player.injury).slice(0, 2);
  const currentCalendarDate = calendarDateAtIndex(state.calendar.openingDate, state.calendar.currentDateIndex);
  const selectedCalendarDateIsReachable = Boolean(selectedCalendarDate && selectedCalendarDate >= currentCalendarDate);
  const leagueLeaders = useMemo(() => getLeagueLeaders(state), [state]);
  const awardsRace = useMemo(() => getAwardRace(state), [state]);
  const selectedGame = selectedGameId ? state.userGameDetails[selectedGameId] : undefined;
  const selectedPlayer = selectedPlayerId ? state.players[selectedPlayerId] : undefined;
  const latestChampion = state.history.champions.at(-1);
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

  useEffect(() => {
    if (activeTab !== "home") return;
    const visibleDate = fiveGameAnimation?.frames[Math.min(fiveGameAnimation.completed, Math.max(0, fiveGameAnimation.frames.length - 1))]?.date ?? currentCalendarDate;
    const currentButton = calendarStripRef.current?.querySelector<HTMLButtonElement>(`[data-calendar-date="${visibleDate}"]`);
    currentButton?.scrollIntoView({ block: "nearest", inline: "center", behavior: fiveGameAnimation ? "smooth" : "auto" });
  }, [activeTab, calendarMonth, currentCalendarDate, fiveGameAnimation?.completed, fiveGameAnimation?.frames]);

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
          name: selectedPlayer.name,
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
        notice: state.expansion?.lastNotice ?? null,
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
          recentTransactions: state.freeAgency.transactionLog.slice(0, 5),
        } : null,
        contractLifecycle: state.contractLifecycle ? {
          season: state.contractLifecycle.rolloverSeasonId,
          pendingTeamOptions: state.contractLifecycle.pendingUserTeamOptionPlayerIds.length,
          completed: state.contractLifecycle.completed,
          recentTransactions: state.contractLifecycle.transactionLog.slice(-5),
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
  }, [state, standings, myRecord, myTeam, myTeamFit, myFreeAgentAttraction, nextGame, latestUserGame, latestAwards, hallOfFamers.length, gmLevel, unlockedAchievements.length, simulationBlockingEvent?.eventInstanceId, activeSlot, fiveGameAnimation]);

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
            setSimulationSummary(buildSimulationSummary(state, next));
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
            setSimulationSummary(buildSimulationSummary(state, next));
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
    setBusy(true); setStatus("正在校验交易、名单与工资帽…");
    try {
      const next = command.type === "GENERATE_TRADE_OFFERS" || command.type === "ACCEPT_TRADE_OFFER" ? executeTradeCommand(state, command) : executeRosterCommand(state, command);
      await persistState(next, targetSlot); setState(next); setStatus(command.type === "LOCK_OPENING_ROSTER" ? "开季名单已锁定 · 新赛季正式开始" : command.type === "GENERATE_TRADE_OFFERS" ? `已生成 ${BALANCE_CONFIG.trade.generatedOfferCount} 个动态报价 · 适配度变化已计算` : command.type === "ACCEPT_TRADE_OFFER" ? "交易已原子执行并自动保存" : "经理事务已原子提交并自动保存");
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

  const runInjuryCommand = async (command: InjuryCommand) => {
    if (!saveService) return;
    const targetSlot = activeSlot;
    setBusy(true);
    try {
      const next = executeInjuryCommand(state, command);
      await persistState(next, targetSlot);
      setState(next);
      setStatus("重大伤病已确认 · 可继续模拟");
    } catch (error) {
      setStatus(error instanceof Error ? humanizeUiText(error.message) : "伤病确认失败，状态未改变");
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
    try {
      const next = executeEventCommand(state, command);
      await persistState(next, targetSlot);
      setState(next);
      setStatus(enteringRegularSeason ? "常规赛已开启 · 赛程已公布" : nextPendingEvent(next) ? "事件已处理 · 队列还有待确认事件" : "事件队列已清空 · 可继续模拟");
    } catch (error) {
      setStatus(error instanceof Error ? humanizeUiText(error.message) : "事件处理失败，状态未改变");
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

  if (["TEAM_CREATION", "EXPANSION_RIGHTS", "OPTION_PHASE", "EXPANSION_TRADE", "EXPANSION_DRAFT"].includes(state.league.currentPhase)
    && !(state.league.currentPhase === "OPTION_PHASE" && state.contractLifecycle)) {
    return <><ExpansionFlow state={state} busy={busy} status={status} onCommand={runExpansionCommand} onSave={save} onLoad={load} onLoadLatest={loadLatest} saveSlots={saveSlots} onRestoreCheckpoint={restoreExpansionCheckpoint} activeSlot={activeSlot} onSlotChange={changeActiveSlot} onHome={onExitToHome} initialDrawerTab={openLoadDrawer ? "load" : undefined} />{conflictModal}</>;
  }

  if (["ROOKIE_DRAFT_PENDING", "OPTION_PHASE", "OFFSEASON_PRE_DRAFT", "DRAFT", "OFFSEASON_POST_DRAFT", "PRESEASON"].includes(state.league.currentPhase)) {
    return <><Stage4Flow state={state} busy={busy} status={status} onCommand={runDraftCommand} onContractCommand={runContractCommand} onFreeAgencyCommand={runFreeAgencyCommand} onTradeCommand={runManagerCommand} onRosterCommand={runManagerCommand} onSave={save} onLoad={load} onLoadLatest={loadLatest} saveSlots={saveSlots} activeSlot={activeSlot} onSlotChange={changeActiveSlot} onHome={onExitToHome} onMarkNotificationsRead={markTeamNotificationsRead} initialDrawerTab={openLoadDrawer ? "load" : undefined} />{conflictModal}</>;
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
  const animatedCalendarIndex = selectedCalendarGame ? fiveGameAnimation?.frames.findIndex((frame) => frame.game?.gameId === selectedCalendarGame.id) ?? -1 : -1;
  const animatedCalendarResult = animatedCalendarIndex >= 0 && fiveGameAnimation && animatedCalendarIndex < fiveGameAnimation.completed ? fiveGameAnimation.frames[animatedCalendarIndex].game : undefined;
  const animatedCalendarDate = fiveGameAnimation?.frames[Math.min(fiveGameAnimation.completed, (fiveGameAnimation.frames.length ?? 1) - 1)]?.date;
  const visibleCalendarDate = animatedCalendarDate ?? currentCalendarDate;
  const displayedCalendarResult = selectedCalendarResult ?? animatedCalendarResult;
  return (
    <main className="app-shell" style={{ "--team-color": myTeam.primaryColor } as React.CSSProperties}>
      <GameChrome phase={state.league.currentPhase} busy={busy} dataLabel="本地球员数据已载入" seasonProfile={activeTab === "home" ? { teamName: myTeam.fullName, record: `${visibleRecord.wins}胜 - ${visibleRecord.losses}负`, rank: `${conferenceLabel(myTeam.conference)}第 ${standingsForConference(state, myTeam.conference).findIndex((record) => record.teamId === state.userTeamId) + 1}` } : undefined} onSave={save} onLoad={load} onLoadLatest={loadLatest} activeSlot={activeSlot} saveSlots={saveSlots} onSlotChange={changeActiveSlot} onHome={onExitToHome} initialDrawerTab={openLoadDrawer ? "load" : undefined} notifications={getTeamInboxItems(state)} onMarkNotificationsRead={markTeamNotificationsRead} onHandlePendingNotification={() => setActiveTab("home")} />
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
        {status}
      </section>

      {activeTab === "home" && <section className="season-demo-home" aria-label="赛季中心">
        <article className="season-demo-summary clip-corner">
          <div className="season-demo-summary-head">
            <div><small>CURRENT SEASON TIMELINE</small><b>{state.league.seasonId} {phaseLabel(state.league.currentPhase)} · 第 {Math.min(playedGames + 1, userSchedule.length)} / {userSchedule.length} 场</b></div>
            <div><small>球队综合战力</small><strong>OVR {myTeamFit.score.toFixed(0)} · {conferenceLabel(myTeam.conference)}第 {standingsForConference(state, myTeam.conference).findIndex((record) => record.teamId === state.userTeamId) + 1}</strong></div>
          </div>
          <div className="season-demo-ticker"><em>快讯</em><span>{simulationBlockingEvent?.title ?? status}</span></div>
        </article>

        <article className="season-demo-card season-demo-schedule">
          <header><b>▦ {monthLabel(resolvedCalendarMonth)} 赛程</b><span><button type="button" onClick={() => { setCalendarMonth(currentCalendarDate.slice(0, 7)); setSelectedCalendarDate(null); setSelectedCalendarGameId(nextGame?.id ?? null); }}>今天</button><button type="button" aria-label="上个月" disabled={calendarMonthIndex <= 0} onClick={() => setCalendarMonth(scheduleMonths[calendarMonthIndex - 1])}>‹</button><button type="button" aria-label="下个月" disabled={calendarMonthIndex >= scheduleMonths.length - 1} onClick={() => setCalendarMonth(scheduleMonths[calendarMonthIndex + 1])}>›</button></span></header>
          <div className="season-demo-date-strip" ref={calendarStripRef} aria-label={`${monthLabel(resolvedCalendarMonth)}赛程`}>
            {calendarCells(resolvedCalendarMonth).filter(Boolean).map((date) => {
              const game = monthGames.get(date!);
              const animationIndex = game ? fiveGameAnimation?.frames.findIndex((frame) => frame.game?.gameId === game.id) ?? -1 : -1;
              const result = game ? state.userGameDetails[game.id] ?? (animationIndex >= 0 && animationIndex < (fiveGameAnimation?.completed ?? 0) ? fiveGameAnimation?.frames[animationIndex].game : undefined) : undefined;
              const isPast = date! < visibleCalendarDate;
              const isCurrent = date === visibleCalendarDate;
              const selected = date === selectedCalendarDate && date !== visibleCalendarDate && !fiveGameAnimation;
              const isAnimating = date === animatedCalendarDate;
              const opponent = game ? state.teams[game.homeTeamId === state.userTeamId ? game.awayTeamId : game.homeTeamId] : undefined;
              const resultLabel = result ? `${result.winnerTeamId === state.userTeamId ? "胜" : "负"} · 查看战报` : "";
              return <button type="button" data-calendar-date={date} key={date} className={`${isPast ? "past " : ""}${isCurrent ? "current " : ""}${selected ? "selected " : ""}${isAnimating ? "simulating " : ""}${result ? (result.winnerTeamId === state.userTeamId ? "win" : "loss") : ""}`} aria-label={`${date}${resultLabel ? ` · ${resultLabel}` : ""}`} onClick={() => {
                if (fiveGameAnimation) return;
                setSelectedCalendarDate(date!);
                if (!game) return;
                setSelectedCalendarGameId(game.id);
                if (result) setSelectedGameId(game.id);
              }}>
                <small>周{["日", "一", "二", "三", "四", "五", "六"][new Date(`${date}T00:00:00`).getDay()]}</small><b>{Number(date!.slice(-2))}</b><em>{result ? (result.winnerTeamId === state.userTeamId ? "胜" : "负") : isAnimating ? "模拟" : game ? opponent?.name.slice(0, 2) : "休"}</em>
              </button>;
            })}
          </div>
          <div className="season-demo-sim-actions">
            <button type="button" aria-label="模拟度过一天" disabled={busy || Boolean(simulationBlockingEvent)} onClick={simulateNextDay}>› 1 天</button>
            <button type="button" className="primary" aria-label="模拟下一场比赛" disabled={busy || Boolean(simulationBlockingEvent)} onClick={simulateNextGame}>ϟ 1 场</button>
            <button type="button" aria-label="快进五场比赛" disabled={busy || Boolean(simulationBlockingEvent) || Boolean(fiveGameAnimation)} onClick={simulateFive}>⏭ 5 场</button>
            <button type="button" aria-label="模拟至日历选中的日期" disabled={busy || Boolean(simulationBlockingEvent) || !selectedCalendarDateIsReachable} data-testid="simulate-next-event" onClick={simulateToSelectedDate}>{selectedCalendarDateIsReachable ? `⚑ 至 ${selectedCalendarDate!.slice(5).replace("-", "/")}` : "⚑ 至节点"}</button>
          </div>
        </article>

        <article className="season-demo-card season-demo-tactic disabled-feature" aria-disabled="true"><span>♞</span><div><b>本场战术预设</b><small>战术系统尚未接入；当前由球队适配度自动参与模拟。</small></div><button type="button" disabled>平衡攻防</button></article>

        <article className="season-demo-card season-demo-matchup clip-corner">
          <header><b>♨ MATCHUP #{playedGames + 1}</b><span>{nextGame ? `${nextGame.date} · ${nextGame.homeTeamId === state.userTeamId ? "主场" : "客场"}` : "常规赛赛程已结束"}</span></header>
          {nextGame && nextOpponent ? <><div className="season-demo-versus"><div><LogoMark team={myTeam} variant="compact" /><b>{myTeam.name}</b><small>{formatRecord(visibleRecord.wins, visibleRecord.losses)} · {myTeamFit.score.toFixed(0)}</small></div><strong>VS</strong><div><LogoMark team={nextOpponent} variant="compact" /><b>{nextOpponent.name}</b><small>{formatRecord(state.standings[nextOpponent.id].wins, state.standings[nextOpponent.id].losses)} · {calculateTeamFit(state, nextOpponent.id).score.toFixed(0)}</small></div></div><div className="season-demo-matchup-meta"><span>阵容适配 <b>{myTeamFit.score.toFixed(0)}</b></span><span>胜率预测 <b>功能未开放</b></span></div></> : <p className="season-demo-empty">常规赛已结束，等待进入下一阶段。</p>}
        </article>

        <article className="season-demo-card season-demo-key-matchup">
          <header><b>♙ 双方焦点球星</b></header>
          <div className="season-demo-player-duel"><div><b>{featuredPlayer ? `${playerNameZh(featuredPlayer.name, featuredPlayer.id)} (${featuredPlayer.position})` : "暂无"}</b><small>{featuredPlayer?.seasonStats.games ? `场均 ${(featuredPlayer.seasonStats.pts / featuredPlayer.seasonStats.games).toFixed(1)} 分 ${(featuredPlayer.seasonStats.ast / featuredPlayer.seasonStats.games).toFixed(1)} 助攻` : "赛季数据尚未产生"}</small><em>状态：{featuredPlayer?.form && featuredPlayer.form >= 72 ? "火热" : "正常"}</em></div><div><b>{featuredOpponent ? `${playerNameZh(featuredOpponent.name, featuredOpponent.id)} (${featuredOpponent.position})` : "等待对手"}</b><small>{featuredOpponent?.seasonStats.games ? `场均 ${(featuredOpponent.seasonStats.pts / featuredOpponent.seasonStats.games).toFixed(1)} 分 ${(featuredOpponent.seasonStats.reb / featuredOpponent.seasonStats.games).toFixed(1)} 篮板` : "赛季数据尚未产生"}</small><em>状态：{featuredOpponent?.form && featuredOpponent.form >= 72 ? "火热" : "正常"}</em></div></div>
        </article>

        <div className="season-demo-bottom-grid">
          <article className="season-demo-card season-demo-results"><header><b>↶ 近期赛果</b><button type="button" disabled={!recentUserGames[0]} onClick={() => recentUserGames[0] && setSelectedGameId(recentUserGames[0].gameId)}>查看战报</button></header><div>{recentUserGames.length ? recentUserGames.slice(0, 3).map((game) => { const won = game.winnerTeamId === state.userTeamId; const opponent = state.teams[game.homeTeamId === state.userTeamId ? game.awayTeamId : game.homeTeamId]; return <button type="button" key={game.gameId} onClick={() => setSelectedGameId(game.gameId)} className={won ? "win" : "loss"}><b>{won ? "W" : "L"} {game.awayScore} - {game.homeScore}</b><small>{game.homeTeamId === state.userTeamId ? "vs " : "@ "}{opponent.name}</small></button>; }) : <p>尚无已完成比赛</p>}</div></article>
          <article className="season-demo-card season-demo-health"><header><b>✚ 伤病 / 状态</b><span>详情</span></header><div>{currentInjuries.length ? currentInjuries.map((player) => <div className="injured" key={player.id}><b>{playerNameZh(player.name, player.id)} ({player.position})</b><small>{player.injury ? `${injurySeverityLabel(player.injury.severity)} · 剩余 ${player.injury.gamesRemaining} 场` : "暂不可出战"}</small></div>) : <div className="healthy"><b>{featuredPlayer ? playerNameZh(featuredPlayer.name, featuredPlayer.id) : "球队"}</b><small>{featuredPlayer?.seasonStats.games ? `近况稳定 · 场均 ${(featuredPlayer.seasonStats.pts / featuredPlayer.seasonStats.games).toFixed(1)} 分` : "全员可出战"}</small><em>状态良好</em></div>}</div></article>
        </div>
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

      <section hidden={activeTab !== "manage" || manageSubTab !== "overview"} data-testid="team-fit-card" className="prototype-roster-summary cyber-manage-overview">
        <div><small>阵容战术契合度</small><b>{myTeamFit.score.toFixed(0)} <em>（{fitGrade(myTeamFit.score)}）</em></b></div>
        <div><small>综合能力评估</small><b><span>进攻 {myTeamFit.offense.toFixed(0)}</span> 防守 {myTeamFit.defense.toFixed(0)}</b></div>
        <details><summary>查看完整球队适配报告</summary><div className="fit-breakdown">{[
          ["组织", myTeamFit.creation], ["空间", myTeamFit.spacing], ["侧翼防守", myTeamFit.perimeterDefense], ["护框", myTeamFit.rimProtection],
          ["篮板", myTeamFit.rebounding], ["位置尺寸", myTeamFit.sizeBalance], ["替补深度", myTeamFit.benchDepth], ["球权兼容", myTeamFit.usageConflict],
        ].map(([label, value]) => <span key={label as string}><small>{label}</small><b>{fitGrade(value as number)}</b><i><u style={{ width: `${value as number}%` }} /></i></span>)}</div></details>
        <div className="team-core-metrics regular-team-metrics"><span><small>市场评级</small><b>{myTeam.marketRating.toFixed(0)}</b></span><span><small>球队声望</small><b>{myTeam.franchiseReputation.toFixed(0)}</b></span><span><small>球迷支持</small><b>{myTeam.fanSupport.toFixed(0)}</b></span><span><small>自由球员吸引力</small><b>{myFreeAgentAttraction.toFixed(0)}</b></span></div>
      </section>

      <section hidden={activeTab !== "manage" || manageSubTab !== "roster"} id="season-roster" data-testid="team-roster-card" className="cyber-manage-roster">
        <TeamRosterPanel players={myRoster} variant="season" onOpenPlayer={setSelectedPlayerId} />
      </section>

      {activeTab === "home" && recentUserGames.length > 0 && <section className="recent-games-card regular-recent-games legacy-season-block"><div className="section-heading"><div><span className="section-kicker">比赛归档</span><h2>最近赛果</h2></div><small>{Object.keys(state.userGameDetails).length} / {userSchedule.length}</small></div><div className="recent-game-list">{recentUserGames.map((game, index) => { const won = game.winnerTeamId === state.userTeamId; const opponent = game.homeTeamId === state.userTeamId ? game.awayTeamId : game.homeTeamId; return <button data-testid={index === 0 ? "latest-game-detail" : undefined} key={game.gameId} onClick={() => setSelectedGameId(game.gameId)}><span className={won ? "game-result win" : "game-result loss"}>{won ? "胜" : "负"}</span><b>{state.teams[opponent].name}</b><small>{game.homeTeamId === state.userTeamId ? "主场" : "客场"}</small><strong>{game.awayScore}–{game.homeScore}</strong></button>; })}</div></section>}

      <details hidden={activeTab !== "manage" || manageSubTab !== "roster"} className="history-card season-calendar-card legacy-season-block">
        <summary><span><small className="section-kicker">完整赛程</small><b>我的球队 · {userSchedule.length} 场日历</b></span><strong>{playedGames} / {userSchedule.length}</strong></summary>
        <div className="season-calendar-list">{userSchedule.map((game, index) => { const opponent = game.homeTeamId === state.userTeamId ? game.awayTeamId : game.homeTeamId; const result = state.userGameDetails[game.id]; const won = result?.winnerTeamId === state.userTeamId; return <button type="button" disabled={!result} onClick={() => result && setSelectedGameId(game.id)} key={game.id}><span>{String(index + 1).padStart(2, "0")}</span><small>{game.date}</small><b>{game.homeTeamId === state.userTeamId ? "主" : "客"} · {state.teams[opponent].name}</b><strong>{result ? `${won ? "胜" : "负"} ${result.awayScore}–${result.homeScore}` : "未赛"}</strong></button>; })}</div>
      </details>

      {queuedEvent && !queuedEvent.effectivePause && <EventCard event={queuedEvent} busy={busy} onResolve={runEventCommand} mode="inline" />}

      {activeTab === "home" && simulationSummary && <section className="simulation-summary"><div><span className="section-kicker">模拟结果摘要</span><h2>{simulationSummary.games} 场 · {simulationSummary.wins}胜 {simulationSummary.losses}负</h2></div><div className="summary-grid"><span><small>分区排名</small><b>{simulationSummary.rankBefore} → {simulationSummary.rankAfter}</b></span><span><small>主要球员</small><b>{simulationSummary.topPlayer?.name ?? "—"}</b><i>{simulationSummary.topPlayer ? `${simulationSummary.topPlayer.points}分 / ${simulationSummary.topPlayer.rebounds}板 / ${simulationSummary.topPlayer.assists}助` : "暂无"}</i></span><span><small>伤病</small><b>{simulationSummary.injuries}</b></span><span><small>事件</small><b>{simulationSummary.queuedEvents}</b></span></div></section>}

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

      {state.injuryState.pendingUserMajorInjury && (() => {
        const event = state.injuryState.pendingUserMajorInjury;
        const player = state.players[event.playerId];
        return <section className="injury-alert prototype-alert-card" role="alert"><span className="prototype-alert-icon" aria-hidden="true">＋</span><div><span className="section-kicker">模拟已暂停 · 重大伤病</span><h2>{playerNameZh(player.name, player.id)} · {injurySeverityLabel(event.severity)}</h2><p>球队角色保持不变，系统已自动调整轮换。</p><div className="prototype-alert-meta"><span>预计缺阵 <b>{event.gamesOut}</b> 场</span><span>状态 <b>待确认</b></span></div></div><button data-testid="ack-major-injury" disabled={busy} onClick={() => runInjuryCommand({ commandId: `ack-injury-${event.injuryId}`, type: "ACKNOWLEDGE_MAJOR_INJURY", payload: { injuryId: event.injuryId } })}>确认伤病并继续 →</button></section>;
      })()}

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

      {activeTab === "manage" && <>
        <div className="cyber-subnav" role="tablist" aria-label="球队管理">
          {(["overview", "roster", "contracts", "training", "assets"] as const).map((tab) => <button key={tab} className={manageSubTab === tab ? "selected" : ""} onClick={() => setManageSubTab(tab)}>{({ overview: "概览", roster: "阵容", contracts: "合同薪资", training: "培养", assets: "资产筹码" })[tab]}</button>)}
        </div>
        {manageSubTab === "overview" && <section className="cyber-metric-grid"><span><small>综合战力</small><b>{myTeamFit.score.toFixed(0)}</b></span><span><small>进攻战力</small><b>{myTeamFit.offense.toFixed(0)}</b></span><span><small>防守战力</small><b>{myTeamFit.defense.toFixed(0)}</b></span><span><small>战术契合</small><b>{myTeamFit.score.toFixed(0)}%</b></span></section>}
        {manageSubTab === "contracts" && <section className="prototype-cap-overview cyber-panel"><header><b>合同与薪资</b><span>{capSheet.activeStandardContracts}/{LEAGUE_FINANCE_CONFIG.rosterLimits.regularSeasonMaximum}</span></header><div className="career-metrics"><span><b>{shortMoney(capSheet.total)}</b><small>薪资表总额</small></span><span><b>{shortMoney(capSheet.availableCapSpace)}</b><small>可用空间</small></span><span><b>{myRoster.filter((player) => player.contract.yearsRemaining <= 1).length}</b><small>到期合同</small></span><span><b>{isTradePhaseAllowed(state.league.currentPhase) ? "开放" : "关闭"}</b><small>交易窗口</small></span></div>{myRoster.map((player) => <button type="button" className="cyber-list-row" key={player.id} onClick={() => setSelectedPlayerId(player.id)}><span>{playerNameZh(player.name, player.id)}</span><small>{shortMoney(player.contract.salary)} · {player.contract.yearsRemaining} 年</small></button>)}</section>}
        {manageSubTab === "training" && <section className="cyber-panel disabled-feature"><b>重点培养</b><p>{state.trainingPlan ? "训练计划将在季前阶段结算。" : "培养计划在休赛期训练营开放。"}</p><button disabled>调整训练方向 · 休赛期开放</button></section>}
        {manageSubTab === "assets" && <section className="cyber-panel"><header><b>未来选秀权库存</b><span>{Object.values(state.draftPicks).filter((pick) => pick.ownerTeamId === state.userTeamId).length} 枚</span></header>{Object.values(state.draftPicks).filter((pick) => pick.ownerTeamId === state.userTeamId).sort((left, right) => left.year - right.year || left.round - right.round).map((pick) => <div className="cyber-list-row" key={pick.id}><span>{pick.year} 年第 {pick.round} 轮 · {state.teams[pick.originalTeamId]?.name ?? pick.originalTeamId}</span><small>{pick.reservedByCommitmentId ? "已承诺" : "可交易"}</small></div>)}<div className="cyber-list-row muted"><span>Trade Block / 交易货架</span><small>功能尚未实现</small></div></section>}
      </>}

      {activeTab === "market" && <>
        <div className="cyber-subnav" role="tablist" aria-label="球员市场">
          {(["trade", "free-agents", "offers", "log"] as const).map((tab) => <button key={tab} className={marketSubTab === tab ? "selected" : ""} onClick={() => setMarketSubTab(tab)}>{({ trade: "交易", "free-agents": "自由球员", offers: "我的报价", log: "交易记录" })[tab]}</button>)}
        </div>
        <div className={`cyber-market-status ${isTradePhaseAllowed(state.league.currentPhase) ? "open" : "closed"}`}>{isTradePhaseAllowed(state.league.currentPhase) ? "交易窗口开放中" : "当前阶段不可执行交易"}</div>
        {marketSubTab === "trade" && (isTradePhaseAllowed(state.league.currentPhase) ? <TradeDesk state={state} busy={busy} onTradeCommand={runManagerCommand} /> : <section className="cyber-panel disabled-feature"><b>交易引擎</b><p>交易功能会在交易窗口开放时自动启用。</p><button disabled>交易截止日后不可执行交易</button></section>)}
        {marketSubTab === "free-agents" && <section className="cyber-panel disabled-feature"><b>自由球员 FA</b><p>{state.freeAgency?.opened ? "自由市场的完整报价流程目前位于休赛期中心。" : "自由市场将在休赛期开放。"}</p><button disabled>{state.freeAgency?.opened ? "请前往休赛期中心" : "自由市场尚未开放"}</button></section>}
        {marketSubTab === "offers" && <section className="cyber-panel"><b>动态交易报价</b>{state.tradeDesk.offers.length ? state.tradeDesk.offers.map((offer) => <div className="cyber-list-row" key={offer.offerId}><span>来自 {state.teams[offer.counterpartyTeamId]?.fullName ?? offer.counterpartyTeamId} · {offer.userIncomingPlayerIds.map((id) => playerNameZh(state.players[id]?.name ?? id, id)).join("、")}</span><small>询价 {offer.inquiryCount} 次</small></div>) : <p>尚无交易报价。先在交易页选择本队球员并获取报价。</p>}</section>}
        {marketSubTab === "log" && <section className="cyber-panel"><b>交易记录</b>{state.gmCareer.tradeHistory.length ? state.gmCareer.tradeHistory.slice().reverse().map((trade) => <div className="cyber-list-row" key={trade.offerId}><span>{trade.summary}</span><small>{trade.seasonId}</small></div>) : <p>尚未完成交易。</p>}</section>}
      </>}

      {activeTab === "league" && <div className="cyber-subnav" role="tablist" aria-label="联盟信息">{(["standings", "leaders", "awards", "history"] as const).map((tab) => <button key={tab} className={leagueSubTab === tab ? "selected" : ""} onClick={() => setLeagueSubTab(tab)}>{({ standings: "联盟排名", leaders: "数据榜单", awards: "奖项竞争", history: "历史与名人堂" })[tab]}</button>)}</div>}

      <section id="season-league" className="standings-card prototype-standings-card" hidden={activeTab !== "league" || leagueSubTab !== "standings"}>
        <div className="section-heading">
          <div><span className="section-kicker">联盟脉搏</span><h2>联盟排名</h2></div>
          <div className="segmented" role="group" aria-label="选择分区">
            <button className={conference === "WEST" ? "selected" : ""} onClick={() => setConference("WEST")}>西部</button>
            <button className={conference === "EAST" ? "selected" : ""} onClick={() => setConference("EAST")}>东部</button>
          </div>
        </div>
        <div className="prototype-standings-head"><span>#</span><span>球队</span><span>胜负</span><span>净胜</span></div>
        <ol className="standings-list prototype-standings-list">
          {standings.slice(0, 10).map((record, index) => (
            <li key={record.teamId} className={record.teamId === state.userTeamId ? "mine" : ""}>
              <span className="rank">{index + 1}</span>
              <LogoMark team={state.teams[record.teamId]} variant="compact" />
              <span className="standing-team"><b>{state.teams[record.teamId].name}</b><small>{state.teams[record.teamId].city} · {divisionLabel(state.teams[record.teamId].division)}</small></span>
              <span className="record">{formatRecord(record.wins, record.losses)}</span>
              <span className="diff">{record.pointsFor - record.pointsAgainst >= 0 ? "+" : ""}{record.pointsFor - record.pointsAgainst}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="history-card league-hub-card prototype-secondary-details cyber-panel" hidden={activeTab !== "league" || leagueSubTab !== "leaders"}>
        <div className="section-heading"><div><span className="section-kicker">联盟中心</span><h2>联盟领袖与奖项竞争</h2></div><b>{Object.keys(state.teams).length} 支球队</b></div>
        <div className="league-leader-grid">{([
          ["得分", leagueLeaders.points, "pts"], ["篮板", leagueLeaders.rebounds, "reb"], ["助攻", leagueLeaders.assists, "ast"],
        ] as const).map(([label, player, key]) => <span key={label}><small>{label}王</small><b>{player?.name ?? "赛季尚未开始"}</b><i>{player ? `${(player.seasonStats[key] / player.seasonStats.games).toFixed(1)} / 场` : "—"}</i></span>)}</div>
      </section>

      <section className="history-card league-hub-card prototype-secondary-details cyber-panel" hidden={activeTab !== "league" || leagueSubTab !== "awards"}><div className="section-heading"><div><span className="section-kicker">赛季荣誉</span><h2>奖项竞争</h2></div></div><div className="awards-race-list">{awardsRace.map((player, index) => <span key={player.id}><b>{index + 1}. {playerNameZh(player.name, player.id)}</b><small>{state.teams[player.teamId]?.name ?? player.teamId} · OVR {playerOverall(player).toFixed(0)} · 场均 {(player.seasonStats.pts / Math.max(1, player.seasonStats.games)).toFixed(1)} 分</small></span>)}</div><div className="cyber-list-row muted"><span>DPOY / ROY / MIP / Sixth Man</span><small>赛季结束后结算</small></div></section>

      <section className="history-card league-hub-card prototype-secondary-details cyber-panel" hidden={activeTab !== "league" || leagueSubTab !== "history"}><div className="section-heading"><div><span className="section-kicker">联盟档案</span><h2>球队、动态与名人堂</h2></div></div><div className="league-team-list">{Object.values(state.teams).sort((left, right) => left.conference.localeCompare(right.conference) || left.name.localeCompare(right.name)).map((team) => <span key={team.id}><LogoMark team={team} variant="compact" /><b>{team.fullName}</b><small>{conferenceLabel(team.conference)} · {formatRecord(state.standings[team.id].wins, state.standings[team.id].losses)}</small></span>)}</div><div className="league-news-list">{state.eventState.leagueLog.length ? state.eventState.leagueLog.slice(0, 12).map((entry, index) => <span key={`${index}-${entry}`}>{humanizeUiText(entry)}</span>) : <span>联盟新赛季刚刚开始，暂无重大动态。</span>}</div><div className="hall-list">{hallOfFamers.length ? hallOfFamers.slice(0, 12).map((player) => <span key={player.id}><b>{playerNameZh(player.name, player.id)}</b><small>{player.career?.hallOfFameClass} 届 · 巅峰 OVR {player.career?.peakOverall.toFixed(1)}</small></span>) : <span>暂无名人堂球员。</span>}</div></section>

      {activeTab === "career" && <div className="cyber-subnav" role="tablist" aria-label="生涯档案">{(["overview", "achievements", "history", "milestones"] as const).map((tab) => <button key={tab} className={careerSubTab === tab ? "selected" : ""} onClick={() => setCareerSubTab(tab)}>{({ overview: "生涯总览", achievements: "成就系统", history: "球队历史", milestones: "里程碑" })[tab]}</button>)}</div>}

      <section hidden={activeTab !== "career" || careerSubTab !== "overview"} id="season-career" data-testid="gm-career-card" className="history-card career-card prototype-career-card"><div className="prototype-career-mark">🏆</div><div className="prototype-career-heading"><small>总经理评级</small><h2>{gmLevel}</h2><p>王朝积分 {state.gmCareer.dynastyScore}</p></div><div className="career-metrics"><span><b>{state.gmCareer.seasons}</b><small>经营赛季</small></span><span><b>{state.gmCareer.regularSeasonWins}-{state.gmCareer.regularSeasonLosses}</b><small>生涯战绩</small></span><span><b>{state.gmCareer.playoffWins}</b><small>季后赛胜场</small></span><span><b>{state.gmCareer.championships}</b><small>总冠军</small></span><span><b>{state.gmCareer.draftHistory.length}</b><small>选秀球员</small></span><span><b>{state.gmCareer.tradeHistory.length}</b><small>完成交易</small></span></div>{latestChampion && <section className="champion-banner">最近冠军 · {state.teams[latestChampion.teamId].city} · {latestChampion.seasonId}</section>}</section>

      {activeTab === "career" && careerSubTab === "achievements" && <section className="history-card prototype-career-secondary cyber-panel"><div className="achievement-grid">{Object.entries(state.achievements).map(([id, achievement]) => <span key={id} className={achievement.unlocked ? "unlocked" : "locked"}><b>{achievement.unlocked ? "✓" : "·"} {ACHIEVEMENT_LABELS[id as keyof typeof ACHIEVEMENT_LABELS]}</b><small>{achievement.unlocked ? achievement.seasonId : "尚未解锁"}</small></span>)}</div></section>}

      {activeTab === "career" && careerSubTab === "history" && <section className="history-card prototype-career-secondary cyber-panel"><b>球队历史</b>{state.history.seasons.length ? state.history.seasons.slice().reverse().map((season) => <div className="cyber-list-row" key={season.seasonId}><span>{season.seasonId} · {season.standings[state.userTeamId]?.wins ?? 0}-{season.standings[state.userTeamId]?.losses ?? 0}</span><small>{season.championTeamId === state.userTeamId ? "总冠军" : season.userPostseason.enteredPlayoffs ? "季后赛" : "常规赛"}</small></div>) : <p>完成首个赛季后会在此记录战绩、季后赛与冠军。</p>}</section>}

      {activeTab === "career" && careerSubTab === "milestones" && <section className="history-card prototype-career-secondary cyber-panel"><b>重大里程碑</b>{latestAwards && <div className="award-grid">{Object.entries(latestAwards.winners).map(([award, playerId]) => <span key={award}><small>{awardLabel(award)}</small><b>{state.players[playerId]?.name ?? playerId}</b></span>)}</div>}<div className="cyber-list-row muted"><span>球队首胜、首次季后赛、首次夺冠等</span><small>按成就系统记录</small></div></section>}

      <footer hidden={activeTab !== "manage"}>
        <label className="slot-picker">存档<select disabled={busy} value={activeSlot} onChange={(event) => changeActiveSlot(Number(event.target.value) as 1 | 2 | 3)}><option value={1}>{slotLabel(1)}</option><option value={2}>{slotLabel(2)}</option><option value={3}>{slotLabel(3)}</option></select></label>
        <button className="footer-action" disabled={busy} onClick={() => void save()}>保存{slotLabel(activeSlot)}</button>
        <button className="footer-action" disabled={busy} onClick={() => void load()}>读取{slotLabel(activeSlot)}</button>
        <span>{usesHupuRoster ? "球员：虎扑阵容/合同 · nba_api 统计可用时叠加 · OVR 为游戏推演" : "数据：虚构测试数据集 · 本地开发预览"}</span>
      </footer>
      <SeasonNavigation activeTab={activeTab} onChange={setActiveTab} />
      {queuedEvent?.effectivePause && <EventCard event={queuedEvent} busy={busy} onResolve={runEventCommand} mode="modal" />}
      {selectedGame && <GameDetailModal game={selectedGame} state={state} onClose={() => setSelectedGameId(null)} />}
      {selectedPlayer && <PlayerDetailModal player={selectedPlayer} teamName={state.teams[selectedPlayer.teamId]?.fullName ?? "自由球员"} busy={busy} tradeAllowed={isTradePhaseAllowed(state.league.currentPhase)} onClose={() => setSelectedPlayerId(null)} onSetRole={(role) => void runManagerCommand({ commandId: `role-${selectedPlayer.id}-${role}-${Object.keys(state.commandReceipts).length}`, type: "SET_TEAM_ROLE", payload: { playerId: selectedPlayer.id, role } })} onTrade={() => { const playerId = selectedPlayer.id; setSelectedPlayerId(null); setActiveTab("market"); setMarketSubTab("trade"); void runManagerCommand({ commandId: `trade-query-${playerId}-${(state.tradeDesk.offers[0]?.inquiryCount ?? -1) + 1}`, type: "GENERATE_TRADE_OFFERS", payload: { playerId, refresh: state.tradeDesk.selectedPlayerId === playerId } }).then(() => window.setTimeout(() => document.querySelector<HTMLElement>(".trade-desk")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0)); }} />}
      {conflictModal}
    </main>
  );
}

function SaveConflictModal({ conflict, busy, onResolve }: { conflict: SaveConflictState; busy: boolean; onResolve: (choice: "LOCAL" | "CLOUD") => Promise<void> }) {
  const summary = (envelope: SaveEnvelope) => {
    const record = envelope.state.standings[envelope.state.userTeamId];
    return `${envelope.state.league.seasonId} · ${record?.wins ?? 0}-${record?.losses ?? 0}`;
  };
  return <div className="event-modal-backdrop"><section className="save-conflict-card" role="dialog" aria-modal="true" aria-label="存档冲突"><span className="prototype-sheet-grabber" aria-hidden="true" /><header className="prototype-sheet-heading"><span className="prototype-sheet-icon">!</span><div><span className="section-kicker">存档冲突 · {slotLabel(conflict.slotId)}</span><h2>请选择要保留的进度</h2></div></header><p>本机与云端都发生了修改，系统不会自动合并完整游戏状态。选择云端前会先保存一份可校验的本机冲突备份。</p><div className="prototype-section-bar"><b>版本对比</b><span>完整覆盖，不合并</span></div><div className="conflict-versions"><span><small>本机版本 {conflict.local.revision}</small><b>{summary(conflict.local)}</b><i>{conflict.local.updatedAt}</i><code>{conflict.local.stateHash.slice(0, 12)}</code></span><span><small>云端版本 {conflict.cloud.revision}</small><b>{summary(conflict.cloud)}</b><i>{conflict.cloud.updatedAt}</i><code>{conflict.cloud.stateHash.slice(0, 12)}</code></span></div><div className="conflict-actions"><button disabled={busy} onClick={() => void onResolve("LOCAL")}>保留本机版本</button><button disabled={busy} className="secondary" onClick={() => void onResolve("CLOUD")}>使用云端版本</button></div></section></div>;
}

function PlayerDetailModal({ player, teamName, busy, tradeAllowed, onClose, onSetRole, onTrade }: {
  player: Player;
  teamName: string;
  busy: boolean;
  tradeAllowed: boolean;
  onClose: () => void;
  onSetRole: (role: TeamRole) => void;
  onTrade: () => void;
}) {
  const displayName = playerNameZh(player.name, player.id);
  const roles: TeamRole[] = ["FRANCHISE_CORE", "KEY_PLAYER", "ROTATION", "DEVELOPMENT", "BENCH"];
  return <div className="player-detail-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="reference-player-dialog with-actions" role="dialog" aria-modal="true" aria-label={`${displayName} 球员详情`}><button className="detail-close" onClick={onClose} aria-label="关闭">×</button><ReferencePlayerCard player={player} teamName={teamName} /><div className="player-manager-actions"><label>球队角色<select disabled={busy} value={player.teamRole} onChange={(event) => onSetRole(event.target.value as TeamRole)}>{roles.map((role) => <option key={role} value={role}>{teamRoleLabel(role)}</option>)}</select></label><button disabled={busy || !tradeAllowed} onClick={onTrade}>{tradeAllowed ? "加入交易 · 获取报价" : "交易截止日已过"}</button></div></section></div>;
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

function GameDetailModal({ game, state, onClose }: { game: GameResult; state: GameState; onClose: () => void }) {
  const boxes = [game.awayBoxScore, game.homeBoxScore].filter(Boolean) as NonNullable<GameResult["homeBoxScore"]>[];
  const best = getGameMvpStat(game);
  const periods = Math.max(game.homePeriodScores?.length ?? 0, game.awayPeriodScores?.length ?? 0);
  const displayedPeriods = Math.max(periods, 4);
  const teams = [state.teams[game.awayTeamId], state.teams[game.homeTeamId]];
  const fgPercent = (stat: PlayerBoxScore) => stat.fga ? `${Math.round(stat.fgm / stat.fga * 100)}%` : "—";
  const boxRows = (box: NonNullable<GameResult["homeBoxScore"]>) => [...box.playerStats].sort((left, right) => right.seconds - left.seconds || right.pts - left.pts || left.playerId.localeCompare(right.playerId));
  const TeamBox = ({ team, score }: { team: typeof teams[number]; score: number }) => {
    const won = game.winnerTeamId === team.id;
    return <div className="postgame-team-box"><LogoMark team={team} variant="compact" /><b>{team.name}{won && <em>胜</em>}</b><strong className={won ? "score-win" : "score-lose"}>{score}</strong></div>;
  };
  const mvpName = best && (state.players[best.playerId] ? playerNameZh(state.players[best.playerId].name, state.players[best.playerId].id) : best.playerId);
  return <section className="postgame-page" aria-label="比赛详情"><header className="postgame-page-header postgame-modal-header"><div><span>比赛详情 · {game.date}</span><h2>赛后数据中心</h2></div><button className="postgame-page-back" type="button" onClick={onClose} aria-label="返回赛季页">← 返回</button></header><div className="postgame-page-body postgame-modal-body" tabIndex={0}><section className="postgame-score-banner"><TeamBox team={teams[0]} score={game.awayScore} /><div className="postgame-status"><b>比赛结束</b><small>{game.overtimePeriods ? `${game.overtimePeriods} 个加时` : "常规时间"}</small></div><TeamBox team={teams[1]} score={game.homeScore} /></section><section className="postgame-quarter-section"><header><b>分节比分</b><small>{periods ? (periods > 4 ? `${periods - 4} 个加时` : "常规时间") : "历史记录未保存"}</small></header><div className="postgame-table-scroll"><table className="postgame-quarter-table"><thead><tr><th>球队</th>{Array.from({ length: displayedPeriods }, (_, index) => <th key={index}>{index < 4 ? `第${index + 1}节` : `加时${index - 3}`}</th>)}<th>总分</th></tr></thead><tbody>{[[teams[0], game.awayPeriodScores ?? [], game.awayScore], [teams[1], game.homePeriodScores ?? [], game.homeScore]].map(([team, scores, total]) => <tr key={(team as typeof teams[number]).id}><td>{(team as typeof teams[number]).name}</td>{Array.from({ length: displayedPeriods }, (_, index) => { const score = (scores as number[])[index]; return <td className={score !== undefined && score === Math.max(...(scores as number[])) ? "high" : ""} key={index}>{score ?? "—"}</td>; })}<td>{total as number}</td></tr>)}</tbody></table></div></section>{best && <section className="postgame-mvp-card"><div><span>MVP</span><div className="postgame-mvp-copy"><small>本场最佳球员</small><PostgameMvpName name={mvpName!} /></div></div><strong>{best.pts}分 · {best.reb}篮板 · {best.ast}助攻</strong></section>}<section className="postgame-roster-section">{boxes.map((box) => { const team = state.teams[box.teamId]; return <article className="postgame-roster-card" key={box.teamId}><header><b><i style={{ background: team.primaryColor }} />{team.name}球员数据</b></header><div className="postgame-table-scroll"><table className="postgame-box-table"><thead><tr><th>球员</th><th>时间</th><th>得分</th><th>篮板</th><th>助攻</th><th>抢断</th><th>盖帽</th><th>FG%</th><th>+/-</th></tr></thead><tbody>{boxRows(box).map((stat) => { const player = state.players[stat.playerId]; const name = player ? playerNameZh(player.name, player.id) : stat.playerId; return <tr key={stat.playerId}><td><span className="postgame-position-badge">{player ? positionLabel(player.position) : "—"}</span><PostgamePlayerName name={name} /></td><td>{Math.round(stat.seconds / 60)}′</td><td className={stat.pts >= 18 ? "scoring" : ""}>{stat.pts}</td><td>{stat.reb}</td><td>{stat.ast}</td><td>{stat.stl}</td><td>{stat.blk}</td><td>{fgPercent(stat)}</td><td className="postgame-pm-neutral">—</td></tr>; })}</tbody></table></div></article>; })}</section></div></section>;
}

function EventCard({ event, busy, onResolve, mode }: {
  event: NonNullable<ReturnType<typeof nextPendingEvent>>;
  busy: boolean;
  onResolve: (command: EventCommand) => void;
  mode: "inline" | "modal";
}) {
  const specialImage = event.definitionId === "playoffs_champion_001" ? "./story/championship-celebration.jpg" : event.definitionId === "expansion_complete_001" ? "./story/opening-arena.jpg" : null;
  const choices = choicesForEvent(event);
  const card = <section data-testid="event-card" className={`event-card category-${event.category.toLowerCase()}${specialImage ? " special-event-card" : ""}${mode === "modal" || specialImage ? " stage-event-card" : ""}`} role={event.effectivePause ? "alertdialog" : "status"}>
    <span className="prototype-sheet-grabber" aria-hidden="true" />
    <div className="event-visual">{specialImage ? <img src={specialImage} alt="" /> : <span>{eventCategoryLabel(event.category).slice(0, 2)}</span>}</div>
    <div className="event-copy"><div className="prototype-event-meta"><span>{eventCategoryLabel(event.category)}</span><b>优先级 {event.priority}</b></div><h2>{event.title}</h2><p>{humanizeUiText(event.description)}</p><div className="prototype-section-bar"><b>{choices.length > 1 ? "经理决策" : "事件通知"}</b><span>{choices.length} 个选项</span></div><div className="event-choices">{choices.map((choice) => <button key={choice.id} disabled={busy} onClick={() => onResolve({ commandId: `event-${event.eventInstanceId}-${choice.id}`, type: "RESOLVE_EVENT", payload: { eventInstanceId: event.eventInstanceId, choiceId: choice.id } })}>{choice.label}</button>)}</div></div>
  </section>;
  return mode === "modal" ? <div className="event-modal-backdrop stage-modal-backdrop">{card}</div> : card;
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

export default App;
