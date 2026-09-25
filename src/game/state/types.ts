export type Conference = "WEST" | "EAST";

export type Division =
  | "PACIFIC_NORTHWEST"
  | "PACIFIC_SOUTH"
  | "MOUNTAIN"
  | "SOUTHWEST"
  | "NORTHEAST"
  | "MID_ATLANTIC"
  | "CENTRAL"
  | "SOUTHEAST";

export type Position = "PG" | "SG" | "SF" | "PF" | "C";
export type RotationRole = "STARTER" | "SIXTH_MAN" | "ROTATION" | "BENCH" | "OUT";
export type TeamRole = "FRANCHISE_CORE" | "KEY_PLAYER" | "ROTATION" | "DEVELOPMENT" | "BENCH";
export type TrainingFocus = "BALANCED" | "SHOOTING" | "PLAYMAKING" | "DEFENSE" | "INSIDE" | "ATHLETICISM";
export type InjurySeverity = "MINOR" | "SHORT" | "MEDIUM" | "LONG" | "SEASON_ENDING";
export type AwardType = "MVP" | "DPOY" | "ROY" | "MIP" | "SIXTH_MAN" | "FINALS_MVP";
export type AchievementId =
  | "EXPANSION_COMPLETE"
  | "FIRST_WIN"
  | "TEN_WINS"
  | "FIRST_PLAY_IN"
  | "FIRST_PLAYOFFS"
  | "FIRST_SERIES_WIN"
  | "CONFERENCE_FINALS"
  | "FINALS_APPEARANCE"
  | "FIRST_CHAMPIONSHIP"
  | "FIFTY_WIN_SEASON"
  | "SIXTY_WIN_SEASON"
  | "HOMEGROWN_ALL_STAR"
  | "ROOKIE_OF_YEAR"
  | "DYNASTY_TWO_OF_THREE";
export type PlayerPersonality = "COMPETITIVE" | "MONEY_FOCUSED" | "LOYAL" | "ROLE_FOCUSED" | "MARKET_FOCUSED" | "BALANCED";
export type PlayerTrait = "PRIMARY_CREATOR" | "SECONDARY_CREATOR" | "SPACER" | "SLASHER" | "RIM_RUNNER" | "WING_STOPPER" | "RIM_PROTECTOR" | "REBOUNDER" | "TWO_WAY" | "SIXTH_MAN";
export type ExpansionCityId = "SEA" | "LVG";
export type ExpansionStrategy = "FUTURE_FIRST" | "BALANCED" | "WIN_NOW";
export type GmPersonality = "AGGRESSIVE" | "CONSERVATIVE" | "STAR_CHASER" | "DRAFT_FOCUSED" | "DEVELOPMENT_FOCUSED" | "CAP_CONSCIOUS";
export type TeamDirection = "CONTEND" | "COMPETE" | "RETOOL" | "REBUILD";

export interface AiTeamProfile {
  personality: GmPersonality;
  direction: TeamDirection;
  directionLockUntilCareerDay: number;
  lastDirectionChangeSeasonId: string;
}
export type ExpansionPackage = "A" | "B";
export type ExpansionTradeType = "PROTECT_PLAYER" | "SELECT_PLAYER";
export type ExpansionTradeStatus = "AVAILABLE" | "ACCEPTED" | "FULFILLED" | "REJECTED" | "INVALIDATED";
export type ExpansionPoolStatus =
  | "AVAILABLE"
  | "PROTECTED"
  | "SELECTED"
  | "REMOVED_BY_TEAM_LOSS"
  | "PROTECTED_BY_COMMITMENT"
  | "LOCKED_BY_COMMITMENT";

export interface PlayerContract {
  salary: number;
  yearsRemaining: number;
  guaranteedAmount: number;
  status: "STANDARD" | "UFA" | "RFA" | "RETIRED";
  optionType: "NONE" | "TEAM" | "PLAYER";
  optionDecision: "NOT_APPLICABLE" | "PENDING" | "EXERCISED" | "DECLINED";
  contractId?: string;
  contractType?: "STANDARD" | "ROOKIE_FIRST" | "ROOKIE_SECOND" | "EMERGENCY";
  startSeason?: number;
  endSeason?: number;
  currentYearIndex?: number;
  salaryByYear?: number[];
  guaranteedByYear?: number[];
  optionByYear?: ContractYearOption[];
  signedTeamId?: string;
  signedPhase?: string;
  emergencyStatus?: "ACTIVE" | "PENDING_TERMINATION";
  emergencyDailySalary?: number;
  qualifyingOfferDecision?: "PENDING" | "TENDERED" | "DECLINED";
}

export interface PlayerAttributes {
  shooting: number;
  finishing: number;
  playmaking: number;
  perimeterDefense: number;
  interiorDefense: number;
  rebounding: number;
  athleticism: number;
  basketballIq: number;
}

export interface PlayerSeasonStats {
  games: number;
  seconds: number;
  pts: number;
  fgm: number;
  fga: number;
  threePm: number;
  threePa: number;
  ftm: number;
  fta: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
}

export interface PlayerCareerRecord {
  seasonsPlayed: number;
  totals: PlayerSeasonStats;
  peakOverall: number;
  peakImpact: number;
  unemployedGameDays: number;
  unemployedLeagueYears: number;
  careerInjuryGamesMissed: number;
  lastSeasonStats?: PlayerSeasonStats;
  honors?: {
    allStar: number;
    mvp: number;
    dpoy: number;
    roy: number;
    mip: number;
    sixthMan: number;
    championships: number;
    finalsMvp: number;
  };
  hallOfFameEligibleData?: boolean;
  retirementSeason?: string;
  hallOfFame?: boolean;
  hallOfFameClass?: number;
  hallOfFameScore?: number;
}

export interface PlayerInjury {
  injuryId: string;
  severity: InjurySeverity;
  gamesRemaining: number;
  occurredSeasonId: string;
  occurredGameId: string;
  previousRotationRole: RotationRole;
}

export interface InjuryEvent {
  injuryId: string;
  playerId: string;
  teamId: string;
  severity: InjurySeverity;
  gamesOut: number;
  gameId: string;
  seasonId: string;
}

export interface Player {
  id: string;
  teamId: string;
  name: string;
  age: number;
  heightCm: number;
  weightKg: number;
  /** Local bundle path only; never a remote runtime URL. */
  portraitPath?: string | null;
  position: Position;
  secondaryPosition: Position;
  birthDate: string;
  ageAtSnapshot: number;
  ageSource: "GENERATED_BIRTH_DATE" | "SNAPSHOT_FALLBACK";
  serviceYears: number;
  serviceYearsSource?: "NBA_OFFICIAL_PROFILE" | "DOCUMENTED_DEBUT" | "AGE_ESTIMATE" | "GENERATED";
  serviceRosterDays?: number;
  birdTeamId?: string | null;
  birdYears?: number;
  injuryRating: number;
  personality: PlayerPersonality;
  marketPreference: number;
  profileSource: "FICTIONAL_FIXTURE" | "HUPU_LIVE_ROSTER" | "CURATED_DATASET" | "PROCEDURAL_DRAFT" | "HISTORICAL_ARCHETYPE";
  projectionSource?: "HUPU_BASIC_V1" | "NBA_API_MODEL_V1" | "PROCEDURAL_V1" | "HISTORICAL_REBIRTH_V1";
  projectionDataVersion?: string;
  /** UI-only calibration against the source season's production tier. */
  overallAdjustment?: number;
  historicalSourcePlayerId?: string;
  attributes: PlayerAttributes;
  threeRate: number;
  assistRate?: number;
  rimRate?: number;
  usageTendency: number;
  health: number;
  morale: number;
  fatigue: number;
  form: number;
  rotationRole: RotationRole;
  teamRole: TeamRole;
  available: boolean;
  traits?: PlayerTrait[];
  truePotential?: number;
  developmentRate?: number;
  developmentVolatility?: number;
  scoutedPotentialGrade?: "S" | "A+" | "A" | "B+" | "B" | "C" | "D";
  scoutingConfidence?: number;
  contract: PlayerContract;
  seasonStats: PlayerSeasonStats;
  postseasonStats: PlayerSeasonStats;
  career?: PlayerCareerRecord;
  injury?: PlayerInjury;
}

export interface ExpansionBrand {
  presetId: string;
  teamName: string;
  shortName: string;
  logoAssetId: string;
  logoUrl: string;
  primaryColor: string;
  secondaryColor: string;
}

export interface ExpansionRightsDraw {
  seed: string;
  winnerTeamId: ExpansionCityId;
  selectedPackage?: ExpansionPackage;
  packageByTeam: Partial<Record<ExpansionCityId, ExpansionPackage>>;
  resolved: boolean;
}

export interface ExpansionProtectionList {
  teamId: string;
  protectedPlayerIds: string[];
  exposedPlayerIds: string[];
}

export interface DraftPickAsset {
  id: string;
  year: number;
  round: 1 | 2;
  originalTeamId: string;
  ownerTeamId: string;
  reservedByCommitmentId?: string;
}

export interface ExpansionTradeOffer {
  id: string;
  sourceTeamId: string;
  targetExpansionTeamId: ExpansionCityId;
  type: ExpansionTradeType;
  targetPlayerId: string;
  compensationAssetIds: string[];
  status: ExpansionTradeStatus;
  commitmentId?: string;
}

export interface ExpansionTradeCommitment {
  id: string;
  offerId: string;
  expansionTeamId: ExpansionCityId;
  sourceTeamId: string;
  type: ExpansionTradeType;
  targetPlayerId: string;
  compensationAssetIds: string[];
  status: "ACTIVE" | "FULFILLED" | "INVALIDATED";
  acceptedOrder: number;
}

export interface ExpansionPick {
  pickNumber: number;
  round: number;
  teamId: ExpansionCityId;
  playerId: string;
  sourceTeamId: string;
  commitmentId?: string;
}

export interface ExpansionState {
  playerTeamId: ExpansionCityId;
  aiTeamId: ExpansionCityId;
  brands: Partial<Record<ExpansionCityId, ExpansionBrand>>;
  aiStrategy: ExpansionStrategy;
  rightsDraw: ExpansionRightsDraw;
  optionPhaseResolved: boolean;
  protectionLists: Record<string, ExpansionProtectionList>;
  poolStatusByPlayerId: Record<string, ExpansionPoolStatus>;
  sourceTeamLossOwner: Record<string, ExpansionCityId | undefined>;
  tradeOffers: ExpansionTradeOffer[];
  commitments: ExpansionTradeCommitment[];
  draftOrder: ExpansionCityId[];
  picks: ExpansionPick[];
  currentPickIndex: number;
  lastNotice?: string;
  finalized: boolean;
}

export interface RookieDraftPick {
  pickNumber: number;
  round: 1 | 2;
  originalTeamId: string;
  ownerTeamId: string;
  realPickNumber?: number;
  scriptedPlayerId?: string;
  playerId?: string;
}

export interface RookieDraftState {
  draftSeed: string;
  classPlayerIds: string[];
  revealedProspectIds?: string[];
  pickOrder: RookieDraftPick[];
  currentPickIndex: number;
  completed: boolean;
  source: "CURATED_2026" | "PROCEDURAL_2026" | "PROCEDURAL_FUTURE" | "MIXED_FUTURE";
}

export interface CapHold {
  playerId: string;
  teamId: string;
  amount: number;
  type: "BIRD_UFA" | "RFA";
}

export interface DeadMoneyCharge {
  id: string;
  teamId: string;
  salaryBySeason: Record<string, number>;
}

export interface OfferReservation {
  offerId: string;
  playerId: string;
  teamId: string;
  amount: number;
}

export interface CapState {
  capHolds: CapHold[];
  deadMoney: DeadMoneyCharge[];
  offerReservations: OfferReservation[];
  emergencySalaryCharges?: Array<{
    id: string;
    playerId: string;
    teamId: string;
    seasonId: string;
    dateIndex: number;
    amount: number;
  }>;
}

export type FreeAgentOfferStatus = "DRAFT" | "SUBMITTED" | "ACTIVE" | "ACCEPTED" | "REJECTED" | "EXPIRED" | "WITHDRAWN" | "SIGNED_OFFER_SHEET";
export type FreeAgentOfferResolutionReason = "PLAYER_REJECTED" | "SIGNED_WITH_OTHER_TEAM" | "RFA_MATCHED" | "ROSTER_FULL" | "ACTIVE_OFFER_LIMIT";
export type PromisedRole = "STARTER" | "SIXTH_MAN" | "ROTATION" | "BENCH";
export type ContractYearOption = "NONE" | "TEAM_OPTION" | "PLAYER_OPTION";

export interface FreeAgentOffer {
  offerId: string;
  playerId: string;
  teamId: string;
  createdDay: number;
  expiresDay: number;
  years: number;
  year1Salary: number;
  salaryByYear?: number[];
  annualRaiseRate?: number;
  finalYearOption?: ContractYearOption;
  totalValue: number;
  guaranteedValue: number;
  rolePromised: PromisedRole;
  capReservation: number;
  utility: number;
  status: FreeAgentOfferStatus;
  resolutionReason?: FreeAgentOfferResolutionReason;
  kind: "UFA_OFFER" | "RFA_OFFER_PROPOSAL";
}

export interface PlayerMarketWindow {
  playerId: string;
  marketWindowStartDay: number;
  decisionDeadline: number;
  marketWindowStatus: "OPEN" | "CLOSED_NO_SIGNING" | "SIGNED" | "RFA_MATCHING";
  originalTeamId?: string;
  matchingDeadline?: number;
  signedOfferSheetId?: string;
}

export interface FreeAgencyState {
  opened: boolean;
  currentDay: number;
  offers: Record<string, FreeAgentOffer>;
  markets: Record<string, PlayerMarketWindow>;
  settledPlayerDay: Record<string, number>;
  transactionLog: string[];
  pendingUserRfaDecision?: { playerId: string; offerId: string; originalTeamId: string; deadline: number };
}

export interface TeamNotification {
  id: string;
  category: "FREE_AGENCY" | "SEASON" | "TEAM";
  seasonId: string;
  title: string;
  message: string;
  playerId?: string;
  playerName?: string;
  read: boolean;
}

export interface TradeOffer {
  offerId: string;
  inquiryKey: string;
  inquiryCount: number;
  counterpartyTeamId: string;
  userOutgoingPlayerIds: string[];
  userOutgoingPickIds: string[];
  userIncomingPlayerIds: string[];
  userIncomingPickIds: string[];
  status: "AVAILABLE" | "ACCEPTED" | "REJECTED";
}

export interface TradeDeskState {
  selectedPlayerId?: string;
  offers: TradeOffer[];
}

export interface AiTradeState {
  evaluationCounter: number;
  completedByTeamSeason: Record<string, number>;
  transactionLog: string[];
}

export interface ContractLifecycleState {
  rolloverSeasonId: string;
  pendingUserTeamOptionPlayerIds: string[];
  transactionLog: string[];
  completed: boolean;
}

export interface PlayerLifecycleReport {
  processedSeasonId: string;
  developedPlayerIds: string[];
  regressedPlayerIds: string[];
  retiredPlayerIds: string[];
  hallOfFameInducteeIds: string[];
  trainedPlayerIds: string[];
  activePlayerCount: number;
  freeAgentCount: number;
  retiredPlayerCount: number;
  rookieInflow: number;
  retirementOutflow: number;
  averageOverallBefore: number;
  averageOverallAfter: number;
}

export interface SeasonAwardsRecord {
  seasonId: string;
  allStars: Record<Conference, string[]>;
  winners: Partial<Record<AwardType, string>>;
}

export interface SeasonHistoryArchive {
  seasonId: string;
  championTeamId: string;
  standings: Record<string, { wins: number; losses: number }>;
  regularSeasonResults: GameResult[];
  userRegularGameDetails: Record<string, GameResult>;
  postseasonGameDetails: Record<string, GameResult>;
  userPostseason: {
    enteredPlayIn: boolean;
    enteredPlayoffs: boolean;
    seriesWins: number;
    conferenceFinals: boolean;
    finalsAppearance: boolean;
    champion: boolean;
    playoffWins: number;
    playoffLosses: number;
  };
}

export interface AchievementRecord {
  unlocked: boolean;
  unlockedAt: string | null;
  seasonId: string | null;
}

export interface GmCareerRecord {
  seasons: number;
  regularSeasonWins: number;
  regularSeasonLosses: number;
  playoffWins: number;
  playoffLosses: number;
  championships: number;
  conferenceTitles: number;
  draftHistory: Array<{ seasonId: string; pickNumber: number; playerId: string }>;
  tradeHistory: Array<{ seasonId: string; offerId: string; summary: string }>;
  bestPlayerDrafted?: string;
  bestTrade?: string;
  dynastyScore: number;
}

export type EventScope = "PLAYER_TEAM" | "AI_TEAM" | "LEAGUE";
export type EventVisibility = "PLAYER_VISIBLE" | "BACKGROUND";
export type EventCheckPoint = "DAY_START" | "AFTER_GAME" | "OFFSEASON";

export interface EventEffectDefinition {
  effectId: string;
  type: "LEAGUE_LOG" | "PLAYER_MORALE" | "PLAYER_FORM" | "TEAM_FAN_SUPPORT" | "TEAM_REPUTATION";
  target?: string;
  value: string | number;
  executionPhase: "ON_CREATE" | "ON_CHOICE";
}

export interface EventChoiceDefinition {
  id: string;
  label: string;
  effects: EventEffectDefinition[];
}

export interface EventDefinition {
  id: string;
  version: number;
  type: string;
  category: string;
  scope: EventScope;
  visibility: EventVisibility;
  priority: number;
  trigger: { mode: "CONDITION" | "MANUAL"; checkPoint: EventCheckPoint };
  conditions: Record<string, string | number | boolean>;
  weight: number;
  cooldownGames: number;
  oncePerSeason: boolean;
  oncePerCareer: boolean;
  pauseSimulation: boolean;
  visual: { useIllustration: boolean; illustrationKey: string };
  content: { title: string; description: string };
  autoEffects: EventEffectDefinition[];
  choices: EventChoiceDefinition[];
  aiChoice: { strategy: "WEIGHTED" | "FIRST" };
  tags: string[];
}

export interface EventInstance {
  eventInstanceId: string;
  definitionId: string;
  definitionVersion: number;
  seasonId: string;
  scheduledAt: string;
  priority: number;
  title: string;
  description: string;
  category: string;
  illustrationKey: string;
  effectivePause: boolean;
  autoEffects: EventEffectDefinition[];
  choices: EventChoiceDefinition[];
  status: "PENDING" | "RESOLVED" | "SKIPPED_UNKNOWN";
  selectedChoiceId?: string;
}

export interface EventState {
  queue: EventInstance[];
  resolvedInstanceIds: string[];
  executedEffectIds: string[];
  lastOccurrenceByDefinition: Record<string, { seasonId: string; careerGame: number }>;
  leagueLog: string[];
}

export interface TrainingPlan {
  seasonId: string;
  assignments: Partial<Record<string, TrainingFocus>>;
}

export interface Team {
  id: string;
  sourceTeamId?: string;
  city: string;
  name: string;
  fullName: string;
  englishName: string;
  abbreviation: string;
  conference: Conference;
  division: Division;
  primaryColor: string;
  secondaryColor: string;
  dayColor: string;
  nightColor: string;
  logoUrl?: string;
  arena?: string;
  marketRating: number;
  franchiseReputation: number;
  fanSupport: number;
  currentStreak: number;
  playerIds: string[];
}

export type GameStatus = "SCHEDULED" | "FINAL";

export interface ScheduleGame {
  id: string;
  seasonId: string;
  dateIndex: number;
  date: string;
  homeTeamId: string;
  awayTeamId: string;
  matchupOrdinal: number;
  status: GameStatus;
  homeScore?: number;
  awayScore?: number;
  winnerTeamId?: string;
}

export interface StandingRecord {
  teamId: string;
  wins: number;
  losses: number;
  homeWins: number;
  homeLosses: number;
  awayWins: number;
  awayLosses: number;
  conferenceWins: number;
  conferenceLosses: number;
  divisionWins: number;
  divisionLosses: number;
  pointsFor: number;
  pointsAgainst: number;
  headToHead: Record<string, { wins: number; losses: number }>;
}

export interface PlayerBoxScore extends PlayerSeasonStats {
  playerId: string;
}

export interface TeamBoxScore {
  teamId: string;
  score: number;
  playerStats: PlayerBoxScore[];
  totals: Omit<PlayerBoxScore, "playerId" | "games">;
}

export interface GameResult {
  gameId: string;
  date: string;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number;
  awayScore: number;
  winnerTeamId: string;
  overtimePeriods: number;
  homePeriodScores?: number[];
  awayPeriodScores?: number[];
  homeBoxScore?: TeamBoxScore;
  awayBoxScore?: TeamBoxScore;
  injuryEvents?: InjuryEvent[];
}

export interface InjuryState {
  recentEvents: InjuryEvent[];
  pendingUserMajorInjury?: InjuryEvent;
  pendingEmergencyRoster?: {
    teamId: string;
    availableCount: number;
    requiredCount: number;
  };
}

export interface GameState {
  meta: {
    schemaVersion: number;
    gameVersion: string;
    dataVersion: string;
    generatorVersion: number;
    configVersion: string;
    prngAlgorithm: "xoshiro128ss-v1";
    hashAlgorithm: "fnv1a64-utf8-v1";
  };
  seeds: {
    careerSeed: string;
    seasonSeed: string;
  };
  league: {
    currentPhase:
      | "TEAM_CREATION"
      | "EXPANSION_RIGHTS"
      | "OPTION_PHASE"
      | "EXPANSION_TRADE"
      | "EXPANSION_DRAFT"
      | "ROOKIE_DRAFT_PENDING"
      | "OFFSEASON_PRE_DRAFT"
      | "DRAFT"
      | "OFFSEASON_POST_DRAFT"
      | "PRESEASON"
      | "REGULAR_PRE_DEADLINE"
      | "REGULAR_POST_DEADLINE"
      | "POSTSEASON"
      | "REGULAR_SEASON"
      | "PLAY_IN"
      | "PLAYOFFS"
      | "OFFSEASON";
    seasonYear: number;
    seasonId: string;
  };
  calendar: {
    currentDateIndex: number;
    openingDate: string;
    finalDateIndex: number;
  };
  userTeamId: string;
  scheduleCycleYear: number;
  teams: Record<string, Team>;
  players: Record<string, Player>;
  schedule: ScheduleGame[];
  standings: Record<string, StandingRecord>;
  lightweightResults: GameResult[];
  userGameDetails: Record<string, GameResult>;
  history: {
    champions: Array<{ seasonId: string; teamId: string }>;
    retiredPlayerIds: string[];
    rebornHistoricalSourceIds: string[];
    seasonAwards: SeasonAwardsRecord[];
    seasons: SeasonHistoryArchive[];
  };
  achievements: Record<AchievementId, AchievementRecord>;
  gmCareer: GmCareerRecord;
  eventState: EventState;
  teamNotifications?: TeamNotification[];
  draftPicks: Record<string, DraftPickAsset>;
  rookieDraft?: RookieDraftState;
  capState: CapState;
  freeAgency?: FreeAgencyState;
  tradeInquiryCount: Record<string, number>;
  tradeDesk: TradeDeskState;
  aiTradeState: AiTradeState;
  aiTeamProfiles: Record<string, AiTeamProfile>;
  contractLifecycle?: ContractLifecycleState;
  playerLifecycle?: PlayerLifecycleReport;
  trainingPlan?: TrainingPlan;
  injuryState: InjuryState;
  expansion?: ExpansionState;
  commandReceipts: Record<string, { payloadHash: string }>;
}

export const emptyPlayerSeasonStats = (): PlayerSeasonStats => ({
  games: 0,
  seconds: 0,
  pts: 0,
  fgm: 0,
  fga: 0,
  threePm: 0,
  threePa: 0,
  ftm: 0,
  fta: 0,
  reb: 0,
  ast: 0,
  stl: 0,
  blk: 0,
  tov: 0,
});

export const emptyStanding = (teamId: string): StandingRecord => ({
  teamId,
  wins: 0,
  losses: 0,
  homeWins: 0,
  homeLosses: 0,
  awayWins: 0,
  awayLosses: 0,
  conferenceWins: 0,
  conferenceLosses: 0,
  divisionWins: 0,
  divisionLosses: 0,
  pointsFor: 0,
  pointsAgainst: 0,
  headToHead: {},
});
