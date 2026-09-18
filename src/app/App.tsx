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
import { executeTradeCommand, type TradeCommand } from "../game/trade/TradeService";
import { executeRosterCommand, type RosterCommand } from "../game/roster/RosterService";
import { executeContractLifecycleCommand, type ContractLifecycleCommand } from "../game/contracts/ContractLifecycleService";
import { executeInjuryCommand, type InjuryCommand } from "../game/injuries/InjuryService";
import { executeEmergencyRosterCommand, type EmergencyRosterCommand } from "../game/injuries/EmergencyRosterService";
import { ACHIEVEMENT_LABELS } from "../game/career/AchievementService";
import { blockingEvent, choicesForEvent, executeEventCommand, nextPendingEvent, type EventCommand } from "../game/events/EventService";
import type { GameResult, GameState, Player, PlayerBoxScore, TeamRole } from "../game/state/types";
import { createBrowserPlatform } from "../platform/PlatformAdapter";
import { SaveService, type SaveEnvelope } from "../storage/SaveService";
import { ExpansionFlow } from "./ExpansionFlow";
import { Stage4Flow, TradeDesk } from "./Stage4Flow";
import { calculateTeamFit, fitGrade } from "../game/team/TeamFitService";
import { freeAgentAttraction } from "../game/team/TeamSystemService";
import { calculatePlayerOverall } from "../game/player/PlayerRatingService";
import { GameChrome, SeasonNavigation, type SeasonTab } from "./GameChrome";
import { playerNameZh } from "./playerNameZh";
import {
  awardLabel, conferenceLabel, divisionLabel, eventCategoryLabel, humanizeUiText, injurySeverityLabel,
  moneyLabel, phaseLabel, positionLabel, rotationRoleLabel, slotLabel, teamRoleLabel,
} from "./uiText";
import { ReferencePlayerCard } from "./ReferencePlayerCard";

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

function App({ initialState = createExpansionCareer("expansion-era-demo"), openSaveOnStart = false, onExitToHome }: { initialState?: GameState; openSaveOnStart?: boolean; onExitToHome?: () => void }) {
  const [state, setState] = useState<GameState>(() => initialState);
  const [openLoadDrawer, setOpenLoadDrawer] = useState(openSaveOnStart);
  const [conference, setConference] = useState<"WEST" | "EAST">("WEST");
  const [status, setStatus] = useState(() => ["REGULAR_SEASON", "REGULAR_PRE_DEADLINE", "REGULAR_POST_DEADLINE"].includes(initialState.league.currentPhase)
    ? "新赛季已开始 · 等待下一项经理决策"
    : `已进入${phaseLabel(initialState.league.currentPhase)}`);
  const [busy, setBusy] = useState(false);
  const [activeSlot, setActiveSlot] = useState<1 | 2 | 3>(1);
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [simulationSummary, setSimulationSummary] = useState<SimulationSummary | null>(null);
  const [fiveGameAnimation, setFiveGameAnimation] = useState<FiveGameAnimation | null>(null);
  const fiveGameTimer = useRef<number | null>(null);
  const [activeTab, setActiveTab] = useState<SeasonTab>("home");
  const [manageSubTab, setManageSubTab] = useState<"trade" | "cap">("trade");
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const firstUserGame = initialState.schedule.find((game) => game.homeTeamId === initialState.userTeamId || game.awayTeamId === initialState.userTeamId);
    return firstUserGame?.date.slice(0, 7) ?? "";
  });
  const [selectedCalendarGameId, setSelectedCalendarGameId] = useState<string | null>(() => initialState.schedule.find((game) => game.status === "SCHEDULED" && (game.homeTeamId === initialState.userTeamId || game.awayTeamId === initialState.userTeamId))?.id ?? null);
  const [saveConflict, setSaveConflict] = useState<{ local: SaveEnvelope; cloud: SaveEnvelope } | null>(null);
  const standings = useMemo(() => standingsForConference(state, conference), [state, conference]);
  const myTeam = state.teams[state.userTeamId];
  const myRecord = state.standings[state.userTeamId];
  const myTeamFit = useMemo(() => calculateTeamFit(state, state.userTeamId), [state]);
  const myRoster = useMemo(() => myTeam.playerIds.map((id) => state.players[id]).filter(Boolean).sort((left, right) => playerOverall(right) - playerOverall(left) || left.id.localeCompare(right.id)), [state, myTeam.playerIds]);
  const teamPayroll = useMemo(() => myRoster.reduce((total, player) => total + player.contract.salary, 0), [myRoster]);
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
  const leagueLeaders = useMemo(() => {
    const qualified = Object.values(state.players).filter((player) => player.seasonStats.games > 0 && player.teamId !== "FREE_AGENT");
    const leader = (key: "pts" | "reb" | "ast") => [...qualified].sort((left, right) => right.seasonStats[key] / right.seasonStats.games - left.seasonStats[key] / left.seasonStats.games || left.id.localeCompare(right.id))[0];
    return { points: leader("pts"), rebounds: leader("reb"), assists: leader("ast") };
  }, [state.players]);
  const awardsRace = useMemo(() => Object.values(state.players).filter((player) => player.teamId !== "FREE_AGENT" && player.available)
    .sort((left, right) => playerOverall(right) - playerOverall(left) || right.seasonStats.pts - left.seasonStats.pts || left.id.localeCompare(right.id)).slice(0, 5), [state.players]);
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
  const gmLevel = state.gmCareer.championships >= 4 || state.gmCareer.dynastyScore >= 7_500 ? "传奇经理"
    : state.gmCareer.championships >= 2 || state.gmCareer.dynastyScore >= 4_000 ? "王朝经理"
      : state.gmCareer.championships >= 1 ? "冠军经理"
        : state.gmCareer.dynastyScore >= 1_500 ? "联盟精英"
          : state.gmCareer.seasons >= 2 ? "优秀经理" : "新手经理";

  useEffect(() => () => {
    if (fiveGameTimer.current !== null) window.clearTimeout(fiveGameTimer.current);
  }, []);

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

  const persistState = async (next: GameState, slot: 1 | 2 | 3 = activeSlot): Promise<"LOCAL" | "SYNCED" | "CONFLICT"> => {
    if (!saveService) return "LOCAL";
    await saveService.save(slot, next);
    if (!cloudStorage) return "LOCAL";
    try {
      const sync = await saveService.syncWithCloud(slot, cloudStorage);
      if (sync?.status === "SAVE_CONFLICT") {
        setSaveConflict({ local: sync.local, cloud: sync.cloud });
        return "CONFLICT";
      }
      return "SYNCED";
    } catch {
      return "LOCAL";
    }
  };

  const run = (label: string, operation: (current: GameState) => GameState) => {
    setBusy(true);
    setStatus(label);
    window.setTimeout(() => {
      void (async () => {
        try {
          const next = operation(state);
          await persistState(next);
          startTransition(() => {
            setState(next);
            setSimulationSummary(buildSimulationSummary(state, next));
            setStatus(`完成 · 已自动保存${slotLabel(activeSlot)}`);
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
    const nextUserGame = next.schedule.find((game) => game.status === "SCHEDULED"
      && (game.homeTeamId === next.userTeamId || game.awayTeamId === next.userTeamId)
      && game.dateIndex >= next.calendar.currentDateIndex);
    setSelectedCalendarGameId(nextUserGame?.id ?? null);
    return currentDate;
  };

  const simulateNextDay = () => {
    if (busy) return;
    setBusy(true);
    setStatus("正在结算下一联盟日…");
    window.setTimeout(() => {
      void (async () => {
        try {
          const next = simulateLeagueDay(state);
          if (next === state) {
            setStatus("当前有待处理的经理事件，无法继续推进");
            return;
          }
          await persistState(next);
          const currentDate = focusCalendarAtCurrentDate(next);
          startTransition(() => {
            setState(next);
            setSimulationSummary(buildSimulationSummary(state, next));
            setStatus(`完成 · 已推进至 ${currentDate} 并自动保存${slotLabel(activeSlot)}`);
          });
        } catch (error) {
          setStatus(error instanceof Error ? humanizeUiText(error.message) : "模拟失败，状态未改变");
        } finally {
          setBusy(false);
        }
      })();
    }, 0);
  };

  const simulateFive = () => {
    if (busy || fiveGameAnimation) return;
    let next = state;
    const frames: FiveGameAnimation["frames"] = [];
    let completedGames = 0;
    while (completedGames < 5 && next.calendar.currentDateIndex < next.calendar.finalDateIndex && !next.injuryState.pendingUserMajorInjury && !next.injuryState.pendingEmergencyRoster && !blockingEvent(next)) {
      const dateIndex = next.calendar.currentDateIndex;
      const knownGames = new Set(Object.keys(next.userGameDetails));
      const day = simulateLeagueDay(next);
      const game = Object.values(day.userGameDetails).find((entry) => !knownGames.has(entry.gameId));
      frames.push({ date: calendarDateAtIndex(next.calendar.openingDate, dateIndex), game });
      if (game) completedGames += 1;
      next = day;
    }
    if (!completedGames || !frames.length) {
      setStatus("没有可推进的本队比赛，或有待处理的经理事件");
      return;
    }
    const focusAnimationDate = (date: string) => {
      setCalendarMonth(date.slice(0, 7));
    };
    setBusy(true);
    setFiveGameAnimation({ frames, completed: 0, totalGames: completedGames });
    focusAnimationDate(frames[0].date);
    setStatus(`赛程推进中 · ${frames[0].date} · 0 / ${completedGames} 场`);
    const advance = (completed: number) => {
      if (completed < frames.length) {
        const current = frames[Math.min(completed, frames.length - 1)];
        const finishedGames = frames.slice(0, completed).filter((frame) => frame.game).length;
        setFiveGameAnimation({ frames, completed, totalGames: completedGames });
        focusAnimationDate(current.date);
        setStatus(`赛程推进中 · ${current.date} · ${finishedGames} / ${completedGames} 场`);
        fiveGameTimer.current = window.setTimeout(() => advance(completed + 1), 380);
        return;
      }
      void (async () => {
        try {
          await persistState(next);
          focusCalendarAtCurrentDate(next);
          startTransition(() => {
            setState(next);
            setSimulationSummary(buildSimulationSummary(state, next));
            setStatus(`完成 · 已逐日推进 ${completedGames} 场并自动保存${slotLabel(activeSlot)}`);
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
    fiveGameTimer.current = window.setTimeout(() => advance(1), 380);
  };

  const save = async (slot: 1 | 2 | 3 = activeSlot) => {
    setActiveSlot(slot);
    setStatus(`正在原子保存${slotLabel(slot)}…`);
    const destination = await persistState(state, slot);
    setStatus(destination === "SYNCED" ? `${slotLabel(slot)}已保存并同步` : destination === "CONFLICT" ? `${slotLabel(slot)}已保存 · 需要处理云端冲突` : `${slotLabel(slot)}已保存至本机`);
  };

  const load = async (slot: 1 | 2 | 3 = activeSlot) => {
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

  const runExpansionCommand = async (command: ExpansionCommand) => {
    if (!saveService) return;
    setBusy(true);
    setStatus("正在校验并原子提交…");
    try {
      if (command.type === "START_EXPANSION_DRAFT") await saveService.saveCheckpoint(activeSlot, "pre-expansion-draft", state);
      const next = executeExpansionCommand(state, command);
      await persistState(next);
      setState(next);
      setStatus(humanizeUiText(next.expansion?.lastNotice) || "操作完成 · 已自动保存");
    } catch (error) {
      setStatus(error instanceof Error ? humanizeUiText(error.message) : "操作失败，状态未改变");
    } finally {
      setBusy(false);
    }
  };

  const runDraftCommand = async (command: DraftCommand) => {
    if (!saveService) return;
    setBusy(true);
    setStatus("正在校验选秀事务并自动保存…");
    try {
      if (command.type === "PREPARE_ROOKIE_DRAFT") await saveService.saveCheckpoint(activeSlot, "pre-rookie-draft", state);
      const next = executeDraftCommand(state, command);
      await persistState(next);
      setState(next);
      const nextPick = next.rookieDraft?.pickOrder[next.rookieDraft.currentPickIndex];
      const completedPickNumber = command.type === "PREPARE_ROOKIE_DRAFT" ? 0 : command.payload.expectedPickNumber;
      setStatus(next.league.currentPhase === "OFFSEASON_POST_DRAFT"
        ? "新秀选秀完成 · 64 份合同已结算"
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
    setBusy(true);
    setStatus("正在校验工资帽、报价与球员决策…");
    try {
      if (command.type === "ENTER_FREE_AGENCY") await saveService.saveCheckpoint(activeSlot, "pre-free-agency", state);
      const next = executeFreeAgencyCommand(state, command);
      await persistState(next);
      setState(next);
      setStatus(command.type === "ADVANCE_FA_DAY" ? `自由市场第 ${next.freeAgency?.currentDay} 天 · 今日结算完成` : "报价事务已原子提交并自动保存");
    } catch (error) {
      setStatus(error instanceof Error ? humanizeUiText(error.message) : "自由市场操作失败，状态未改变");
    } finally {
      setBusy(false);
    }
  };

  const runManagerCommand = async (command: TradeCommand | RosterCommand) => {
    if (!saveService) return;
    setBusy(true); setStatus("正在校验交易、名单与工资帽…");
    try {
      const next = command.type === "GENERATE_TRADE_OFFERS" || command.type === "ACCEPT_TRADE_OFFER" ? executeTradeCommand(state, command) : executeRosterCommand(state, command);
      await persistState(next); setState(next); setStatus(command.type === "LOCK_OPENING_ROSTER" ? "开季名单已锁定 · 新赛季正式开始" : command.type === "GENERATE_TRADE_OFFERS" ? "已生成 3 个动态报价 · 适配度变化已计算" : command.type === "ACCEPT_TRADE_OFFER" ? "交易已原子执行并自动保存" : "经理事务已原子提交并自动保存");
    } catch (error) { setStatus(error instanceof Error ? humanizeUiText(error.message) : "操作失败，状态未改变"); } finally { setBusy(false); }
  };

  const runContractCommand = async (command: ContractLifecycleCommand) => {
    if (!saveService) return;
    setBusy(true);
    setStatus("正在统一滚动合同、效力年限与伯德权…");
    try {
      if (command.type === "ROLLOVER_LEAGUE_YEAR") await saveService.saveCheckpoint(activeSlot, `pre-rollover-${state.league.seasonId}`, state);
      const next = executeContractLifecycleCommand(state, command);
      await persistState(next);
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
    setBusy(true);
    try {
      const next = executeInjuryCommand(state, command);
      await persistState(next);
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
    setBusy(true);
    setStatus("正在生成合法紧急名单并核算按日底薪…");
    try {
      const next = executeEmergencyRosterCommand(state, command);
      await persistState(next);
      setState(next);
      setStatus("紧急名单已补足至 8 人 · 可继续模拟");
    } catch (error) {
      setStatus(error instanceof Error ? humanizeUiText(error.message) : "紧急名单补员失败，状态未改变");
    } finally {
      setBusy(false);
    }
  };

  const runEventCommand = async (command: EventCommand) => {
    if (!saveService) return;
    setBusy(true);
    try {
      const next = executeEventCommand(state, command);
      await persistState(next);
      setState(next);
      setStatus(nextPendingEvent(next) ? "事件已处理 · 队列还有待确认事件" : "事件队列已清空 · 可继续模拟");
    } catch (error) {
      setStatus(error instanceof Error ? humanizeUiText(error.message) : "事件处理失败，状态未改变");
    } finally {
      setBusy(false);
    }
  };

  const restoreExpansionCheckpoint = async () => {
    const checkpoint = await saveService?.loadCheckpoint(activeSlot, "pre-expansion-draft");
    if (!checkpoint) {
      setStatus("暂无扩军选秀前检查点");
      return;
    }
    await persistState(checkpoint);
    setState(checkpoint);
    setStatus("已恢复扩军选秀前检查点");
  };

  const resolveSaveConflict = async (choice: "LOCAL" | "CLOUD") => {
    if (!saveService || !cloudStorage) return;
    setBusy(true);
    try {
      await saveService.resolveConflict(activeSlot, cloudStorage, choice);
      const resolved = await saveService.load(activeSlot);
      if (resolved) setState(resolved);
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
    return <><ExpansionFlow state={state} busy={busy} status={status} onCommand={runExpansionCommand} onSave={save} onLoad={load} onRestoreCheckpoint={restoreExpansionCheckpoint} activeSlot={activeSlot} onSlotChange={setActiveSlot} onHome={onExitToHome} initialDrawerTab={openLoadDrawer ? "load" : undefined} />{conflictModal}</>;
  }

  if (["ROOKIE_DRAFT_PENDING", "OPTION_PHASE", "OFFSEASON_PRE_DRAFT", "DRAFT", "OFFSEASON_POST_DRAFT", "PRESEASON"].includes(state.league.currentPhase)) {
    return <><Stage4Flow state={state} busy={busy} status={status} onCommand={runDraftCommand} onContractCommand={runContractCommand} onFreeAgencyCommand={runFreeAgencyCommand} onTradeCommand={runManagerCommand} onRosterCommand={runManagerCommand} onSave={save} onLoad={load} activeSlot={activeSlot} onSlotChange={setActiveSlot} onHome={onExitToHome} initialDrawerTab={openLoadDrawer ? "load" : undefined} />{conflictModal}</>;
  }

  const phaseDone = state.schedule.every((game) => game.status === "FINAL");
  const visibleRecord = fiveGameAnimation ? {
    wins: myRecord.wins + fiveGameAnimation.frames.slice(0, fiveGameAnimation.completed).flatMap((frame) => frame.game ? [frame.game] : []).filter((game) => game.winnerTeamId === state.userTeamId).length,
    losses: myRecord.losses + fiveGameAnimation.frames.slice(0, fiveGameAnimation.completed).flatMap((frame) => frame.game ? [frame.game] : []).filter((game) => game.winnerTeamId !== state.userTeamId).length,
  } : myRecord;
  const animatedCalendarIndex = selectedCalendarGame ? fiveGameAnimation?.frames.findIndex((frame) => frame.game?.gameId === selectedCalendarGame.id) ?? -1 : -1;
  const animatedCalendarResult = animatedCalendarIndex >= 0 && fiveGameAnimation && animatedCalendarIndex < fiveGameAnimation.completed ? fiveGameAnimation.frames[animatedCalendarIndex].game : undefined;
  const animatedCalendarDate = fiveGameAnimation?.frames[Math.min(fiveGameAnimation.completed, (fiveGameAnimation.frames.length ?? 1) - 1)]?.date;
  const displayedCalendarResult = selectedCalendarResult ?? animatedCalendarResult;
  return (
    <main className="app-shell" style={{ "--team-color": myTeam.primaryColor } as React.CSSProperties}>
      <GameChrome phase={state.league.currentPhase} dataLabel="本地球员数据已载入" onSave={save} onLoad={load} activeSlot={activeSlot} onSlotChange={setActiveSlot} onHome={onExitToHome} initialDrawerTab={openLoadDrawer ? "load" : undefined} />
      <header id="season-home" className="prototype-team-summary regular-team-banner" hidden={activeTab !== "home"}>
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

      <section className="prototype-calendar-card" hidden={activeTab !== "home"}>
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

      {activeTab === "home" && selectedCalendarGame && <section className="prototype-game-day-card">
        <header><b>比赛日：{selectedCalendarGame.date.slice(5).replace("-", "月")}日</b><span>{displayedCalendarResult ? "比赛已结束" : animatedCalendarIndex >= 0 ? "正在模拟" : "即将进行的赛事"}</span></header>
        <div className="prototype-matchup"><div><LogoMark team={state.teams[selectedCalendarGame.awayTeamId]} variant="compact" /><b>{state.teams[selectedCalendarGame.awayTeamId].name}</b><small>{formatRecord(state.standings[selectedCalendarGame.awayTeamId].wins, state.standings[selectedCalendarGame.awayTeamId].losses)}</small></div><strong>{displayedCalendarResult ? `${displayedCalendarResult.awayScore} - ${displayedCalendarResult.homeScore}` : "VS"}</strong><div><LogoMark team={state.teams[selectedCalendarGame.homeTeamId]} variant="compact" /><b>{state.teams[selectedCalendarGame.homeTeamId].name}</b><small>{formatRecord(state.standings[selectedCalendarGame.homeTeamId].wins, state.standings[selectedCalendarGame.homeTeamId].losses)}</small></div></div>
        <div className="prototype-game-actions">
          {state.league.currentPhase === "OFFSEASON" ? <button disabled={busy} onClick={() => runContractCommand({ commandId: `rollover-${state.league.seasonId}`, type: "ROLLOVER_LEAGUE_YEAR", payload: {} })}>进入下一联盟年度</button> : phaseDone ? <button disabled={busy} onClick={() => run("正在结算附加赛与季后赛…", simulatePostseason)}>结算季后赛</button> : <>{displayedCalendarResult ? <button onClick={() => setSelectedGameId(selectedCalendarGame.id)}>查看比赛详情</button> : <button disabled={busy || Boolean(state.injuryState.pendingUserMajorInjury) || Boolean(state.injuryState.pendingEmergencyRoster) || Boolean(simulationBlockingEvent)} onClick={simulateNextDay}>模拟下一日</button>}<button className="secondary" data-testid="simulate-five" disabled={busy || Boolean(state.injuryState.pendingUserMajorInjury) || Boolean(state.injuryState.pendingEmergencyRoster) || Boolean(simulationBlockingEvent)} onClick={simulateFive}>{fiveGameAnimation ? `逐日推进 · ${fiveGameAnimation.frames.slice(0, fiveGameAnimation.completed).filter((frame) => frame.game).length} / ${fiveGameAnimation.totalGames} 场` : "逐日推进 5 场赛程"}</button></>}
        </div>
        {!phaseDone && state.league.currentPhase !== "OFFSEASON" && <details className="prototype-more-actions"><summary>更多模拟选项</summary><div><button data-testid="simulate-next-event" disabled={busy || Boolean(state.injuryState.pendingUserMajorInjury) || Boolean(state.injuryState.pendingEmergencyRoster) || Boolean(simulationBlockingEvent)} onClick={() => run("正在模拟到下一经理事件…", simulateToNextEvent)}>模拟到下一事件</button><button disabled={busy || Boolean(state.injuryState.pendingUserMajorInjury) || Boolean(state.injuryState.pendingEmergencyRoster) || Boolean(simulationBlockingEvent)} onClick={() => run("正在结算完整常规赛…", simulateRegularSeason)}>模拟至季后赛</button></div></details>}
      </section>}

      <section hidden={activeTab !== "roster"} data-testid="team-fit-card" className="prototype-roster-summary">
        <div><small>阵容战术契合度</small><b>{myTeamFit.score.toFixed(0)} <em>（{fitGrade(myTeamFit.score)}）</em></b></div>
        <div><small>综合能力评估</small><b><span>进攻 {myTeamFit.offense.toFixed(0)}</span> 防守 {myTeamFit.defense.toFixed(0)}</b></div>
        <details><summary>查看完整球队适配报告</summary><div className="fit-breakdown">{[
          ["组织", myTeamFit.creation], ["空间", myTeamFit.spacing], ["侧翼防守", myTeamFit.perimeterDefense], ["护框", myTeamFit.rimProtection],
          ["篮板", myTeamFit.rebounding], ["位置尺寸", myTeamFit.sizeBalance], ["替补深度", myTeamFit.benchDepth], ["球权兼容", myTeamFit.usageConflict],
        ].map(([label, value]) => <span key={label as string}><small>{label}</small><b>{fitGrade(value as number)}</b><i><u style={{ width: `${value as number}%` }} /></i></span>)}</div></details>
        <div className="team-core-metrics regular-team-metrics"><span><small>市场评级</small><b>{myTeam.marketRating.toFixed(0)}</b></span><span><small>球队声望</small><b>{myTeam.franchiseReputation.toFixed(0)}</b></span><span><small>球迷支持</small><b>{myTeam.fanSupport.toFixed(0)}</b></span><span><small>自由球员吸引力</small><b>{myFreeAgentAttraction.toFixed(0)}</b></span></div>
      </section>

      <section hidden={activeTab !== "roster"} id="season-roster" data-testid="team-roster-card" className="prototype-roster-list">
        {myRoster.map((player) => <button type="button" className="prototype-roster-player" data-player-id={player.id} onClick={() => setSelectedPlayerId(player.id)} key={player.id}><span className="prototype-position-mark">{positionLabel(player.position)}</span><span className="prototype-player-copy"><b>{playerNameZh(player.name, player.id)}{!player.available && <em>伤病</em>}</b><small>{player.age}岁 ｜ {shortMoney(player.contract.salary)} ｜ {rotationRoleLabel(player.rotationRole)}</small></span><span className="prototype-player-overall"><b>{playerOverall(player).toFixed(0)}</b><small>综合</small></span></button>)}
      </section>

      {activeTab === "home" && recentUserGames.length > 0 && <section className="recent-games-card regular-recent-games"><div className="section-heading"><div><span className="section-kicker">比赛归档</span><h2>最近赛果</h2></div><small>{Object.keys(state.userGameDetails).length} / 82</small></div><div className="recent-game-list">{recentUserGames.map((game, index) => { const won = game.winnerTeamId === state.userTeamId; const opponent = game.homeTeamId === state.userTeamId ? game.awayTeamId : game.homeTeamId; return <button data-testid={index === 0 ? "latest-game-detail" : undefined} key={game.gameId} onClick={() => setSelectedGameId(game.gameId)}><span className={won ? "game-result win" : "game-result loss"}>{won ? "胜" : "负"}</span><b>{state.teams[opponent].name}</b><small>{game.homeTeamId === state.userTeamId ? "主场" : "客场"}</small><strong>{game.awayScore}–{game.homeScore}</strong></button>; })}</div></section>}

      <details hidden={activeTab !== "roster"} className="history-card season-calendar-card legacy-season-block">
        <summary><span><small className="section-kicker">完整赛程</small><b>我的球队 · 82 场日历</b></span><strong>{playedGames} / 82</strong></summary>
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
        return <section className="injury-alert emergency-roster-alert prototype-alert-card" role="alert"><span className="prototype-alert-icon" aria-hidden="true">!</span><div><span className="section-kicker">模拟已暂停 · 紧急名单</span><h2>可用球员仅 {emergency.availableCount} 人</h2><p>比赛名单至少需要 8 名可用球员，系统将优先签下自由球员，不足时生成临时替补。</p><div className="prototype-alert-meta"><span>当前 <b>{emergency.availableCount}</b> 人</span><span>最低 <b>8</b> 人</span></div></div><button data-testid="fill-emergency-roster" disabled={busy} onClick={() => runEmergencyRosterCommand({ commandId: `fill-emergency-${state.league.seasonId}-${state.calendar.currentDateIndex}`, type: "FILL_EMERGENCY_ROSTER", payload: { teamId: state.userTeamId } })}>自动补齐至 8 人 →</button></section>;
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

      {activeTab === "manage" && <div className="prototype-manage-tabs"><button className={manageSubTab === "trade" ? "selected" : ""} onClick={() => setManageSubTab("trade")}>常规交易</button><button className={manageSubTab === "cap" ? "selected" : ""} onClick={() => setManageSubTab("cap")}>工资帽与资产</button></div>}

      {activeTab === "manage" && manageSubTab === "cap" && <section className="prototype-cap-overview"><header><b>球队资产概览</b><span>{myRoster.length}/15</span></header><div className="career-metrics"><span><b>{shortMoney(teamPayroll)}</b><small>当前薪资</small></span><span><b>{state.tradeDesk.offers.length}</b><small>动态报价</small></span><span><b>{activeSlot}</b><small>当前存档</small></span><span><b>{state.league.currentPhase === "REGULAR_PRE_DEADLINE" ? "开放" : "关闭"}</b><small>交易窗口</small></span></div></section>}

      {activeTab === "manage" && manageSubTab === "trade" && ["REGULAR_SEASON", "REGULAR_PRE_DEADLINE"].includes(state.league.currentPhase) && <TradeDesk state={state} busy={busy} onTradeCommand={runManagerCommand} />}

      <section id="season-league" className="standings-card prototype-standings-card" hidden={activeTab !== "league"}>
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

      <details className="history-card league-hub-card prototype-secondary-details" hidden={activeTab !== "league"}>
        <summary><span>联盟领袖、奖项与新闻</span><b>展开</b></summary>
        <div className="section-heading"><div><span className="section-kicker">联盟中心</span><h2>联盟领袖与奖项竞争</h2></div><b>32 支球队</b></div>
        <div className="league-leader-grid">{([
          ["得分", leagueLeaders.points, "pts"], ["篮板", leagueLeaders.rebounds, "reb"], ["助攻", leagueLeaders.assists, "ast"],
        ] as const).map(([label, player, key]) => <span key={label}><small>{label}王</small><b>{player?.name ?? "赛季尚未开始"}</b><i>{player ? `${(player.seasonStats[key] / player.seasonStats.games).toFixed(1)} / 场` : "—"}</i></span>)}</div>
        <details><summary>最有价值球员竞争 · 当前前五</summary><div className="awards-race-list">{awardsRace.map((player, index) => <span key={player.id}><b>{index + 1}. {playerNameZh(player.name, player.id)}</b><small>{state.teams[player.teamId]?.name ?? player.teamId} · 综合 {playerOverall(player).toFixed(0)} · 场均 {(player.seasonStats.pts / Math.max(1, player.seasonStats.games)).toFixed(1)} 分</small></span>)}</div></details>
        <details><summary>联盟球队列表</summary><div className="league-team-list">{Object.values(state.teams).sort((left, right) => left.conference.localeCompare(right.conference) || left.name.localeCompare(right.name)).map((team) => <span key={team.id}><LogoMark team={team} variant="compact" /><b>{team.fullName}</b><small>{conferenceLabel(team.conference)} · {formatRecord(state.standings[team.id].wins, state.standings[team.id].losses)}</small></span>)}</div></details>
        <details><summary>联盟新闻</summary><div className="league-news-list">{state.eventState.leagueLog.length ? state.eventState.leagueLog.slice(0, 12).map((entry, index) => <span key={`${index}-${entry}`}>{humanizeUiText(entry)}</span>) : <span>联盟新赛季刚刚开始，暂无重大动态。</span>}</div></details>
      </details>

      <section hidden={activeTab !== "career"} id="season-career" data-testid="gm-career-card" className="history-card career-card prototype-career-card"><div className="prototype-career-mark">🏆</div><div className="prototype-career-heading"><small>总经理评级</small><h2>{gmLevel}</h2><p>王朝积分 {state.gmCareer.dynastyScore}</p></div><div className="career-metrics"><span><b>{state.gmCareer.seasons}</b><small>执教赛季</small></span><span><b>{state.gmCareer.regularSeasonWins}</b><small>常规赛胜场</small></span><span><b>{state.gmCareer.playoffWins}</b><small>季后赛胜场</small></span><span><b>{state.gmCareer.championships}</b><small>总冠军</small></span></div><details className="prototype-career-achievements"><summary>查看生涯成就</summary><div className="achievement-grid">{Object.entries(state.achievements).map(([id, achievement]) => <span key={id} className={achievement.unlocked ? "unlocked" : "locked"}><b>{achievement.unlocked ? "✓" : "·"} {ACHIEVEMENT_LABELS[id as keyof typeof ACHIEVEMENT_LABELS]}</b><small>{achievement.unlocked ? achievement.seasonId : "尚未解锁"}</small></span>)}</div></details></section>

      {activeTab === "career" && latestAwards && <details className="history-card prototype-career-secondary"><summary>{latestAwards.seasonId} 赛季荣誉</summary><div className="award-grid">{Object.entries(latestAwards.winners).map(([award, playerId]) => <span key={award}><small>{awardLabel(award)}</small><b>{state.players[playerId]?.name ?? playerId}</b></span>)}</div><div className="history-meta">全明星 · 西部 {latestAwards.allStars.WEST.length} 人 / 东部 {latestAwards.allStars.EAST.length} 人</div></details>}

      {activeTab === "career" && hallOfFamers.length > 0 && <details className="history-card prototype-career-secondary"><summary>联盟名人堂 · {hallOfFamers.length} 人</summary><div className="hall-list">{hallOfFamers.slice(0, 12).map((player) => <span key={player.id}><b>{playerNameZh(player.name, player.id)}</b><small>{player.career?.hallOfFameClass} 届 · 得分 {player.career?.hallOfFameScore?.toFixed(1)} · 巅峰综合 {player.career?.peakOverall.toFixed(1)}</small></span>)}</div></details>}

      {activeTab === "career" && latestChampion && <section className="champion-banner">最近冠军 · {state.teams[latestChampion.teamId].city} · {latestChampion.seasonId}</section>}

      <footer hidden={activeTab !== "manage"}>
        <label className="slot-picker">存档<select value={activeSlot} onChange={(event) => setActiveSlot(Number(event.target.value) as 1 | 2 | 3)}><option value={1}>{slotLabel(1)}</option><option value={2}>{slotLabel(2)}</option><option value={3}>{slotLabel(3)}</option></select></label>
        <button className="footer-action" onClick={() => void save()}>保存{slotLabel(activeSlot)}</button>
        <button className="footer-action" onClick={() => void load()}>读取{slotLabel(activeSlot)}</button>
        <span>{usesHupuRoster ? "球员：虎扑阵容/合同 · nba_api 统计可用时叠加 · 能力值为游戏推演" : "数据：虚构测试数据集 · 本地开发预览"}</span>
      </footer>
      <SeasonNavigation activeTab={activeTab} onChange={setActiveTab} />
      {queuedEvent?.effectivePause && <EventCard event={queuedEvent} busy={busy} onResolve={runEventCommand} mode="modal" />}
      {selectedGame && <GameDetailModal game={selectedGame} state={state} onClose={() => setSelectedGameId(null)} />}
      {selectedPlayer && <PlayerDetailModal player={selectedPlayer} teamName={state.teams[selectedPlayer.teamId].fullName} busy={busy} tradeAllowed={state.league.currentPhase === "REGULAR_PRE_DEADLINE"} onClose={() => setSelectedPlayerId(null)} onSetRole={(role) => void runManagerCommand({ commandId: `role-${selectedPlayer.id}-${role}-${Object.keys(state.commandReceipts).length}`, type: "SET_TEAM_ROLE", payload: { playerId: selectedPlayer.id, role } })} onTrade={() => { const playerId = selectedPlayer.id; setSelectedPlayerId(null); void runManagerCommand({ commandId: `trade-query-${playerId}-${(state.tradeDesk.offers[0]?.inquiryCount ?? -1) + 1}`, type: "GENERATE_TRADE_OFFERS", payload: { playerId, refresh: state.tradeDesk.selectedPlayerId === playerId } }).then(() => window.setTimeout(() => { const panel = document.querySelector<HTMLDetailsElement>(".trade-desk"); if (panel) { panel.open = true; panel.scrollIntoView({ behavior: "smooth", block: "start" }); } }, 0)); }} />}
      {conflictModal}
    </main>
  );
}

function playerGameImpact(stat: PlayerBoxScore): number {
  return stat.pts + stat.reb * 1.15 + stat.ast * 1.45 + stat.stl * 2.2 + stat.blk * 2.1 - stat.tov * 0.8;
}

function SaveConflictModal({ conflict, busy, onResolve }: { conflict: { local: SaveEnvelope; cloud: SaveEnvelope }; busy: boolean; onResolve: (choice: "LOCAL" | "CLOUD") => Promise<void> }) {
  const summary = (envelope: SaveEnvelope) => {
    const record = envelope.state.standings[envelope.state.userTeamId];
    return `${envelope.state.league.seasonId} · ${record?.wins ?? 0}-${record?.losses ?? 0}`;
  };
  return <div className="event-modal-backdrop"><section className="save-conflict-card" role="dialog" aria-modal="true" aria-label="存档冲突"><span className="prototype-sheet-grabber" aria-hidden="true" /><header className="prototype-sheet-heading"><span className="prototype-sheet-icon">!</span><div><span className="section-kicker">存档冲突 · {slotLabel(conflict.local.slotId)}</span><h2>请选择要保留的进度</h2></div></header><p>本机与云端都发生了修改，系统不会自动合并完整游戏状态。选择云端前会先保存一份可校验的本机冲突备份。</p><div className="prototype-section-bar"><b>版本对比</b><span>完整覆盖，不合并</span></div><div className="conflict-versions"><span><small>本机版本 {conflict.local.revision}</small><b>{summary(conflict.local)}</b><i>{conflict.local.updatedAt}</i><code>{conflict.local.stateHash.slice(0, 12)}</code></span><span><small>云端版本 {conflict.cloud.revision}</small><b>{summary(conflict.cloud)}</b><i>{conflict.cloud.updatedAt}</i><code>{conflict.cloud.stateHash.slice(0, 12)}</code></span></div><div className="conflict-actions"><button disabled={busy} onClick={() => void onResolve("LOCAL")}>保留本机版本</button><button disabled={busy} className="secondary" onClick={() => void onResolve("CLOUD")}>使用云端版本</button></div></section></div>;
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

function GameDetailModal({ game, state, onClose }: { game: GameResult; state: GameState; onClose: () => void }) {
  const boxes = [game.awayBoxScore, game.homeBoxScore].filter(Boolean) as NonNullable<GameResult["homeBoxScore"]>[];
  const best = boxes.flatMap((box) => box.playerStats).sort((left, right) => playerGameImpact(right) - playerGameImpact(left) || left.playerId.localeCompare(right.playerId))[0];
  const periods = Math.max(game.homePeriodScores?.length ?? 0, game.awayPeriodScores?.length ?? 0);
  const displayedPeriods = Math.max(periods, 4);
  const teams = [state.teams[game.awayTeamId], state.teams[game.homeTeamId]];
  const fgPercent = (stat: PlayerBoxScore) => stat.fga ? `${Math.round(stat.fgm / stat.fga * 100)}%` : "—";
  const boxRows = (box: NonNullable<GameResult["homeBoxScore"]>) => [...box.playerStats].sort((left, right) => right.seconds - left.seconds || right.pts - left.pts || left.playerId.localeCompare(right.playerId));
  const TeamBox = ({ team, score }: { team: typeof teams[number]; score: number }) => {
    const won = game.winnerTeamId === team.id;
    return <div className="postgame-team-box"><LogoMark team={team} variant="compact" /><b>{team.name}{won && <em>胜</em>}</b><strong className={won ? "score-win" : "score-lose"}>{score}</strong></div>;
  };
  return <div className="game-detail-backdrop stage-modal-backdrop"><section className="game-detail-card stage-detail-card postgame-data-center" role="dialog" aria-modal="true" aria-label="比赛详情"><header className="postgame-modal-header"><div><span>比赛详情 · {game.date}</span><h2>赛后数据中心</h2></div><button className="detail-close" onClick={onClose} aria-label="关闭">✕</button></header><div className="postgame-modal-body"><section className="postgame-score-banner"><TeamBox team={teams[0]} score={game.awayScore} /><div className="postgame-status"><b>比赛结束</b><small>{game.overtimePeriods ? `${game.overtimePeriods} 个加时` : "常规时间"}</small></div><TeamBox team={teams[1]} score={game.homeScore} /></section><section className="postgame-quarter-section"><header><b>分节比分</b><small>{periods ? (periods > 4 ? `${periods - 4} 个加时` : "常规时间") : "历史记录未保存"}</small></header><div className="postgame-table-scroll"><table className="postgame-quarter-table"><thead><tr><th>球队</th>{Array.from({ length: displayedPeriods }, (_, index) => <th key={index}>{index < 4 ? `第${index + 1}节` : `加时${index - 3}`}</th>)}<th>总分</th></tr></thead><tbody>{[[teams[0], game.awayPeriodScores ?? [], game.awayScore], [teams[1], game.homePeriodScores ?? [], game.homeScore]].map(([team, scores, total]) => <tr key={(team as typeof teams[number]).id}><td>{(team as typeof teams[number]).name}</td>{Array.from({ length: displayedPeriods }, (_, index) => { const score = (scores as number[])[index]; return <td className={score !== undefined && score === Math.max(...(scores as number[])) ? "high" : ""} key={index}>{score ?? "—"}</td>; })}<td>{total as number}</td></tr>)}</tbody></table></div></section>{best && <section className="postgame-mvp-card"><div><span>MVP</span><div><small>本场最佳球员</small><b>{state.players[best.playerId] ? playerNameZh(state.players[best.playerId].name, state.players[best.playerId].id) : best.playerId}</b></div></div><strong>{best.pts}分 · {best.reb}篮板 · {best.ast}助攻</strong></section>}<section className="postgame-roster-section">{boxes.map((box) => { const team = state.teams[box.teamId]; return <article className="postgame-roster-card" key={box.teamId}><header><b><i style={{ background: team.primaryColor }} />{team.name}球员数据</b></header><div className="postgame-table-scroll"><table className="postgame-box-table"><thead><tr><th>球员</th><th>时间</th><th>得分</th><th>篮板</th><th>助攻</th><th>抢断</th><th>盖帽</th><th>FG%</th><th>+/-</th></tr></thead><tbody>{boxRows(box).map((stat) => { const player = state.players[stat.playerId]; const name = player ? playerNameZh(player.name, player.id) : stat.playerId; return <tr key={stat.playerId}><td><span className="postgame-position-badge">{player ? positionLabel(player.position) : "—"}</span><PostgamePlayerName name={name} /></td><td>{Math.round(stat.seconds / 60)}′</td><td className={stat.pts >= 18 ? "scoring" : ""}>{stat.pts}</td><td>{stat.reb}</td><td>{stat.ast}</td><td>{stat.stl}</td><td>{stat.blk}</td><td>{fgPercent(stat)}</td><td className="postgame-pm-neutral">—</td></tr>; })}</tbody></table></div></article>; })}</section></div></section></div>;
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
  const className = variant === "compact" ? "mini-logo" : "logo-disc";
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
