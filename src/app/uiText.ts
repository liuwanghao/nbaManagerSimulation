import type {
  AwardType,
  Conference,
  Division,
  InjurySeverity,
  PlayerTrait,
  Position,
  RotationRole,
  TeamRole,
} from "../game/state/types";

const PHASE_LABELS: Record<string, string> = {
  TEAM_CREATION: "创建扩军球队",
  EXPANSION_RIGHTS: "扩军权益选择",
  OPTION_PHASE: "合同选项阶段",
  EXPANSION_TRADE: "扩军交易",
  EXPANSION_DRAFT: "扩军选秀",
  ROOKIE_DRAFT_PENDING: "新秀选秀准备",
  OFFSEASON_PRE_DRAFT: "选秀前休赛期",
  DRAFT: "新秀选秀",
  OFFSEASON_POST_DRAFT: "选秀后休赛期",
  PRESEASON: "季前准备",
  REGULAR_PRE_DEADLINE: "常规赛·交易截止日前",
  REGULAR_POST_DEADLINE: "常规赛·交易截止日后",
  POSTSEASON: "季后赛",
  REGULAR_SEASON: "常规赛",
  PLAY_IN: "附加赛",
  PLAYOFFS: "季后赛",
  OFFSEASON: "休赛期",
};

const POSITION_LABELS: Record<Position, string> = {
  PG: "PG",
  SG: "SG",
  SF: "SF",
  PF: "PF",
  C: "C",
};

const ROTATION_ROLE_LABELS: Record<RotationRole, string> = {
  STARTER: "首发",
  SIXTH_MAN: "第六人",
  ROTATION: "轮换",
  BENCH: "替补",
  OUT: "停赛名单",
};

const TEAM_ROLE_LABELS: Record<TeamRole, string> = {
  FRANCHISE_CORE: "建队核心",
  KEY_PLAYER: "关键球员",
  ROTATION: "轮换球员",
  DEVELOPMENT: "培养球员",
  BENCH: "替补球员",
};

const CONTRACT_STATUS_LABELS: Record<string, string> = {
  STANDARD: "标准合同",
  UFA: "完全自由球员",
  RFA: "受限自由球员",
  RETIRED: "已退役",
};

const OPTION_TYPE_LABELS: Record<string, string> = {
  NONE: "无选项",
  TEAM: "球队选项",
  PLAYER: "球员选项",
};

const PROFILE_SOURCE_LABELS: Record<string, string> = {
  FICTIONAL_FIXTURE: "虚构测试数据",
  HUPU_LIVE_ROSTER: "虎扑实时阵容",
  CURATED_DATASET: "离线球员资料",
  PROCEDURAL_DRAFT: "程序化新秀",
  HISTORICAL_ARCHETYPE: "传奇原型新秀",
};

const INJURY_LABELS: Record<InjurySeverity, string> = {
  MINOR: "轻微伤病",
  SHORT: "短期伤病",
  MEDIUM: "中期伤病",
  LONG: "长期伤病",
  SEASON_ENDING: "赛季报销",
};

const ATTRIBUTE_LABELS: Record<string, string> = {
  shooting: "投射",
  finishing: "终结",
  playmaking: "组织",
  perimeterDefense: "外线防守",
  interiorDefense: "内线防守",
  rebounding: "篮板",
  athleticism: "运动能力",
  basketballIq: "篮球智商",
};

const TRAIT_LABELS: Record<PlayerTrait, string> = {
  PRIMARY_CREATOR: "第一持球核心",
  SECONDARY_CREATOR: "第二持球点",
  SPACER: "空间射手",
  SLASHER: "突破手",
  RIM_RUNNER: "顺下终结者",
  WING_STOPPER: "侧翼防守尖兵",
  RIM_PROTECTOR: "护框者",
  REBOUNDER: "篮板手",
  TWO_WAY: "攻防一体",
  SIXTH_MAN: "第六人",
};

const AWARD_LABELS: Record<AwardType, string> = {
  MVP: "最有价值球员",
  DPOY: "最佳防守球员",
  ROY: "最佳新秀",
  MIP: "进步最快球员",
  SIXTH_MAN: "最佳第六人",
  FINALS_MVP: "总决赛最有价值球员",
};

const CONFERENCE_LABELS: Record<Conference, string> = { WEST: "西部", EAST: "东部" };
const DIVISION_LABELS: Record<Division, string> = {
  PACIFIC_NORTHWEST: "太平洋西北赛区",
  PACIFIC_SOUTH: "太平洋南部赛区",
  MOUNTAIN: "中西赛区",
  SOUTHWEST: "西南赛区",
  NORTHEAST: "东北赛区",
  MID_ATLANTIC: "大西洋中部赛区",
  CENTRAL: "中部赛区",
  SOUTHEAST: "东南赛区",
};

export const phaseLabel = (value: string): string => PHASE_LABELS[value] ?? "未知阶段";
export const positionLabel = (value: Position | string | undefined): string => value && POSITION_LABELS[value as Position] ? POSITION_LABELS[value as Position] : value ?? "未知位置";
export const positionPairLabel = (primary: Position | string, secondary?: Position | string): string => secondary && secondary !== primary
  ? `${positionLabel(primary)} / ${positionLabel(secondary)}`
  : positionLabel(primary);
export const rotationRoleLabel = (value: RotationRole): string => ROTATION_ROLE_LABELS[value];
export const teamRoleLabel = (value: TeamRole): string => TEAM_ROLE_LABELS[value];
export const contractStatusLabel = (value: string): string => CONTRACT_STATUS_LABELS[value] ?? "其他合同";
export const optionTypeLabel = (value: string): string => OPTION_TYPE_LABELS[value] ?? "其他选项";
export const profileSourceLabel = (value: string): string => PROFILE_SOURCE_LABELS[value] ?? "游戏数据";
export const injurySeverityLabel = (value: InjurySeverity | string | undefined): string => value && INJURY_LABELS[value as InjurySeverity] ? INJURY_LABELS[value as InjurySeverity] : "无法出场";
export const attributeLabel = (value: string): string => ATTRIBUTE_LABELS[value] ?? "综合能力";
export const traitLabel = (value: PlayerTrait | string): string => TRAIT_LABELS[value as PlayerTrait] ?? "综合型球员";
export const awardLabel = (value: AwardType | string): string => AWARD_LABELS[value as AwardType] ?? "赛季奖项";
export const conferenceLabel = (value: Conference): string => CONFERENCE_LABELS[value];
export const divisionLabel = (value: Division): string => DIVISION_LABELS[value];
export const slotLabel = (value: number): string => `存档 ${value}`;
export const moneyLabel = (value: number): string => `${Math.round(value / 10_000).toLocaleString("zh-CN")} 万美元`;
export const adaptiveMoneyLabel = (value: number): string => Math.abs(value) >= 100_000_000
  ? `${(value / 100_000_000).toLocaleString("zh-CN", { minimumFractionDigits: 1, maximumFractionDigits: 2 })} 亿美元`
  : moneyLabel(value);
export const hundredMillionDollarLabel = (value: number): string => `${(value / 100_000_000).toFixed(3)} 亿美元`;
export const measurementLabel = (value: number | null | undefined, unit: "cm" | "kg"): string =>
  value != null && Number.isFinite(value) && value > 0 ? `${Math.round(value)}${unit}` : "—";

const UI_TERM_REPLACEMENTS: Array<[RegExp, string]> = [
  [/^.+ is not allowed during .+$/giu, "当前阶段不能执行此操作"],
  [/Cannot allocate without recipients/giu, "没有可分配的球员"], [/Allocation capacity exhausted with (\d+) remaining/giu, "仍有 $1 分钟无法分配"],
  [/Allocation made no progress/giu, "轮换时间分配无法继续"], [/A team needs at least (\d+) available players/giu, "球队至少需要 $1 名可用球员"],
  [/Player is not on the user roster/giu, "该球员不在你的阵容中"], [/Cannot waive below (\d+) available players/giu, "可用球员少于 $1 人时不能裁员"],
  [/Resolve the pending RFA decision first/giu, "请先处理待定的受限自由球员报价"], [/Not enough free agents to complete AI rosters/giu, "自由球员不足，无法补齐电脑球队阵容"],
  [/No free agent is available for minimum roster fill/giu, "没有可用于补齐最低名单人数的自由球员"],
  [/Opening schedule is invalid:.+$/giu, "开季赛程校验失败"], [/Generated invalid schedule:.+$/giu, "生成的赛程未通过校验"],
  [/Offer references an invalid player or team/giu, "报价引用了无效的球员或球队"], [/.+ has reached its roster limit/giu, "球队已达到名单人数上限"],
  [/Player is not available in free agency/giu, "该球员当前不在自由市场中"], [/RFA is already in a matching window/giu, "该受限自由球员已进入匹配报价窗口"],
  [/The rights team cannot submit an RFA offer proposal/giu, "拥有匹配权的球队不能提交受限自由球员报价"],
  [/Contract length must be (\d+)-(\d+) years/giu, "合同年限必须为 $1 至 $2 年"], [/Year-one salary is outside legal limits/giu, "首年薪资超出合法范围"],
  [/Guaranteed percentage is invalid/giu, "保障比例无效"], [/Team roster is already full/giu, "球队名单已满"],
  [/Insufficient cap space for this offer reservation/giu, "薪资空间不足，无法预留此报价"], [/Rookie Draft must be completed first/giu, "必须先完成新秀选秀"],
  [/Offer cannot be withdrawn/giu, "该报价无法撤回"], [/Free agency is not open/giu, "自由市场尚未开放"],
  [/Resolve the pending RFA offer sheet before advancing/giu, "请先处理待定的受限自由球员报价单"], [/No RFA decision is pending/giu, "当前没有待处理的受限自由球员决定"],
  [/RFA match requires a roster slot/giu, "匹配报价需要一个空余名单名额"], [/Trade offer is no longer available/giu, "该交易报价已失效"],
  [/Expansion Package ([AB]) has no owner/giu, "扩军权益方案 $1 尚未分配"], [/.+ exceeds the offseason roster limit/giu, "球队超过休赛期名单人数上限"],
  [/Rookie Draft cannot finalize before (\d+) picks/giu, "新秀选秀必须完成 $1 个签位后才能结束"], [/No eligible prospect remains/giu, "没有剩余的合格新秀"],
  [/Expansion Draft must be finalized first/giu, "必须先完成扩军选秀"], [/Rookie Draft is not prepared/giu, "新秀选秀尚未准备完成"],
  [/Draft pick has changed; refresh and try again/giu, "签位已经变化，请刷新后重试"], [/Current pick is not controlled by the player team/giu, "当前签位不属于你的球队"],
  [/Prospect is not available/giu, "该新秀当前不可选择"], [/A prospect was drafted more than once/giu, "同一名新秀被重复选择"],
  [/Unknown team:.+$/giu, "未知球队"], [/Unable to reconcile legal shooting for score .+$/giu, "比赛得分无法生成合法投篮数据"],
  [/Headless season advance could not resolve the rookie draft/giu, "自动推进赛季时无法完成新秀选秀"],
  [/V1 supports save slots 1 through 3/giu, "版本 1 仅支持 1 至 3 号存档"], [/Temporary save verification failed/giu, "临时存档校验失败"],
  [/Save checksum mismatch/giu, "存档校验码不匹配"], [/Invalid checkpoint id/giu, "检查点编号无效"], [/Checkpoint checksum mismatch/giu, "检查点校验码不匹配"],
  [/Conflict backup checksum mismatch/giu, "冲突备份校验码不匹配"], [/No recoverable save revision/giu, "没有可恢复的存档版本"],
  [/Emergency Roster/giu, "紧急名单"], [/Replacement-Level/giu, "替补级"], [/All-Star/giu, "全明星"],
  [/Rookie Draft/giu, "新秀选秀"], [/Draft Room/giu, "选秀大厅"], [/Option Phase/giu, "合同选项阶段"],
  [/Expansion Trade/giu, "扩军交易"], [/Expansion Pick/giu, "扩军选秀签"], [/Free Agency/giu, "自由市场"],
  [/Service Year/giu, "效力年限"], [/Bird Rights/giu, "伯德权"], [/Offer Sheet/giu, "报价单"],
  [/Checkpoint/giu, "检查点"], [/Revision/giu, "版本"], [/Command ID/giu, "指令编号"], [/Command/giu, "指令"],
  [/Payload/giu, "参数"], [/Package/giu, "权益方案"], [/Seed/giu, "随机种子"], [/Reserve/giu, "预留"],
  [/AI GM/giu, "电脑经理"], [/AI Picks/giu, "电脑球队选秀"], [/AI 球队/giu, "电脑球队"],
  [/\bAI\b/gu, "电脑球队"], [/\bUFA\b/gu, "完全自由球员"], [/\bRFA\b/gu, "受限自由球员"],
  [/\bSlot\s*(\d+)/giu, "存档 $1"], [/\bDay\s*(\d+)/giu, "第 $1 天"], [/\bFit\b/gu, "适配度"],
  [/PLAYER_OPTION_DECLINED/gu, "球员选项被拒绝"], [/TEAM_OPTION_DECLINED/gu, "球队选项被拒绝"],
  [/CONTRACT_EXPIRED/gu, "合同到期"], [/PLAYER_OPTION_EXERCISED/gu, "球员选项已执行"], [/TEAM_OPTION_EXERCISED/gu, "球队选项已执行"],
  [/SELECT_PLAYER/gu, "指定选择球员"], [/PICK_UP/gu, "执行选项"], [/DECLINE/gu, "放弃"],
  [/is not allowed during/giu, "不能在当前阶段执行："], [/not found/giu, "不存在"], [/invalid/giu, "无效"],
];

export function humanizeUiText(value: string | undefined | null): string {
  if (!value) return "";
  const codeLabels: Record<string, string> = {
    TEAM_OPTION_NOT_PENDING: "该球队选项当前不在待处理列表中", TEAM_OPTION_NOT_CONTROLLED: "你无法处理该球队选项", TEAM_OPTIONS_STILL_PENDING: "仍有球队选项尚未处理",
    TRAINING_PLAYER_NOT_ON_USER_ROSTER: "该培养球员不在你的阵容中", TRAINING_FOCUS_LIMIT_REACHED: "重点培养名额已满", ROLE_PLAYER_NOT_ON_USER_ROSTER: "该球员不在你的阵容中",
    FRANCHISE_CORE_LIMIT_REACHED: "建队核心名额已满", ROSTER_OVER_REGULAR_LIMIT: "阵容超过常规赛人数上限", MINIMUM_FILL_CONFIRMATION_REQUIRED: "需要确认自动补齐最低名单人数",
    EVENT_NOT_PENDING: "该事件当前不在待处理队列中", EVENT_CHOICE_INVALID: "事件选项无效", MAJOR_INJURY_NOT_PENDING: "没有待确认的重大伤病",
    MAJOR_INJURY_ACK_REQUIRED: "请先确认重大伤病", EMERGENCY_HARD_BLOCK: "可用球员不足，必须先处理紧急名单", EMERGENCY_TEAM_NOT_FOUND: "紧急名单球队不存在",
    EMERGENCY_USER_TEAM_ONLY: "只能处理自己球队的紧急名单", EMERGENCY_ROSTER_NOT_PENDING: "当前没有待处理的紧急名单",
    DRAFT_PICK_NOT_OWNED: "球队不拥有该选秀权", CONSECUTIVE_FIRST_ROUND_LIMIT: "交易违反连续首轮签限制", EMERGENCY_CONTRACT_NOT_TRADEABLE: "紧急合同不能交易",
    NOT_ENOUGH_LEGAL_TRADE_OFFERS: "没有足够的合法交易报价", OUTGOING_ASSET_NOT_OWNED: "球队不拥有送出的资产", INCOMING_ASSET_NOT_OWNED: "对方球队不拥有送出的资产",
    ROSTER_LIMIT_EXCEEDED: "交易后名单人数超出限制", SECOND_APRON_SALARY_MATCH_FAILED: "交易未通过第二土豪线薪资匹配", FIRST_APRON_SALARY_MATCH_FAILED: "交易未通过第一土豪线薪资匹配",
    SALARY_MATCH_FAILED: "交易薪资不匹配", NO_SAVE_CONFLICT: "当前没有存档冲突", CONFLICT_BACKUP_VERIFICATION_FAILED: "冲突备份校验失败", SAVE_WRITE_VERIFICATION_FAILED: "存档写入校验失败",
  };
  if (codeLabels[value]) return codeLabels[value];
  const translated = UI_TERM_REPLACEMENTS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
  return /^[A-Z][A-Z0-9_:-]+$/u.test(translated) ? "操作未通过规则校验" : translated;
}

const EVENT_CATEGORY_LABELS: Record<string, string> = {
  INJURY: "伤病", MORALE: "士气", ROLE: "角色", BREAKOUT: "爆发", SLUMP: "低迷",
  TRADE: "交易", STREAK: "连胜", ROOKIE: "新秀", EXPANSION: "扩军", PLAYOFFS: "季后赛",
  FRANCHISE: "球队", DRAFT: "选秀", FREE_AGENCY: "自由市场", RFA: "受限自由球员", AI_GM: "电脑经理",
};
export const eventCategoryLabel = (value: string): string => EVENT_CATEGORY_LABELS[value] ?? "事件";
