import type { EventDefinition, EventEffectDefinition, EventScope } from "../game/state/types";
import { BALANCE_CONFIG } from "../config/balanceConfig";

type EventSeed = [id: string, title: string, description: string, priority?: number, pause?: boolean, scope?: EventScope];

const seedGroups: Record<string, EventSeed[]> = {
  INJURY: [
    ["injury_core_major_001", "核心伤病", "{{player_name}} 遭遇重大伤病，轮换计划必须调整。", 90, true],
    ["injury_recovery_001", "伤员回归", "{{player_name}} 已通过复出评估。", 45],
    ["injury_emergency_roster_001", "紧急名单", "可用球员不足，球队启用紧急名单。", 95, true],
    ["injury_depth_test_001", "阵容深度考验", "连续伤病正在考验球队阵容深度。", 55],
  ],
  MORALE: [
    ["morale_role_unhappy_001", "角色不满", "{{player_name}} 对当前角色感到不满。", 70, true],
    ["morale_team_first_001", "团队至上", "更衣室认可球队最近的无私表现。", 38],
    ["morale_minutes_001", "上场时间诉求", "{{player_name}} 希望获得更多上场时间。", 62, true],
    ["morale_veteran_voice_001", "老将发声", "球队老将主动稳定更衣室。", 40],
  ],
  ROLE: [
    ["role_starter_claim_001", "首发诉求", "一名轮换球员认为自己已经配得上首发。", 60, true],
    ["role_sixth_man_001", "第六人定位", "替补核心逐渐适应第六人角色。", 35],
    ["role_rookie_growth_001", "新秀角色升级", "新秀的表现推动教练组重新评估定位。", 42],
    ["role_veteran_reduced_001", "老将角色调整", "老将需要面对出场顺位下降。", 58, true],
  ],
  BREAKOUT: [
    ["breakout_scorer_001", "得分爆发", "{{player_name}} 打出赛季代表作。", 45],
    ["breakout_defender_001", "防守突破", "一名球员正在成为可靠的防守支柱。", 42],
    ["breakout_playmaker_001", "组织蜕变", "球队出现新的持球组织点。", 42],
    ["breakout_rookie_001", "新秀爆发", "新秀连续交出超预期表现。", 50],
  ],
  SLUMP: [
    ["slump_shooting_001", "投篮低迷", "球队外线手感连续低迷。", 38],
    ["slump_star_001", "核心低潮", "{{player_name}} 正经历赛季低谷。", 55],
    ["slump_bench_001", "替补失速", "第二阵容近期净效率明显下降。", 36],
    ["slump_defense_001", "防守松动", "球队连续多场防守失准。", 42],
  ],
  TRADE: [
    ["trade_market_interest_001", "市场询价", "多支球队正在询问你的轮换球员。", 65, true],
    ["trade_star_available_001", "球星进入市场", "联盟交易市场出现重量级目标。", 72, true, "LEAGUE"],
    ["trade_deadline_001", "交易截止日", "交易窗口即将关闭。", 92, true],
    ["trade_ai_completed_001", "联盟交易", "两支电脑球队完成交易。", 24, false, "LEAGUE"],
  ],
  STREAK: [
    ["streak_winning_003", "三连胜", "球队建立起三场连胜势头。", 32],
    ["streak_winning_005", "五连胜", "球队豪取五连胜，联盟开始关注。", 52, true],
    ["streak_winning_010", "十连胜", "十连胜让球队成为联盟焦点。", 75, true],
    ["streak_losing_003", "三连败", "球队需要尽快终止连败。", 38],
    ["streak_losing_005", "五连败", "五连败正在动摇更衣室信心。", 64, true],
    ["streak_losing_010", "十连败", "漫长连败让赛季进入危机。", 82, true],
  ],
  ROOKIE: [
    ["rookie_debut_001", "新秀首秀", "球队新秀完成职业生涯首秀。", 35],
    ["rookie_wall_001", "新秀墙", "密集赛程让新秀出现疲态。", 44],
    ["rookie_month_001", "月度新秀", "自家新秀成为月度焦点。", 45],
    ["rookie_award_001", "最佳新秀", "球队球员赢得年度最佳新秀。", 74, true],
  ],
  EXPANSION: [
    ["expansion_complete_001", "新球队诞生", "扩军选秀完成，一支新球队正式加入联盟。", 96, true],
    ["expansion_first_home_001", "首个主场", "城市迎来队史首个主场比赛。", 70, true],
    ["expansion_identity_001", "球队身份", "球迷正在形成属于扩军球队的新文化。", 38],
    ["expansion_rivalry_001", "新生宿敌", "扩军球队之间的竞争开始升温。", 48],
  ],
  PLAYOFFS: [
    ["playoffs_appearance_001", "季后赛初体验", "球队首次进入季后赛。", 82, true],
    ["playoffs_series_win_001", "系列赛突破", "球队赢下队史第一轮系列赛。", 84, true],
    ["playoffs_finals_001", "总决赛舞台", "球队首次站上总决赛舞台。", 94, true],
    ["playoffs_champion_001", "联盟冠军", "球队夺得总冠军，城市进入庆典时刻。", 100, true],
  ],
  FRANCHISE: [
    ["franchise_season_opening_001", "常规赛开幕", "常规赛名单已锁定。", 101, true],
    ["franchise_first_win_001", "队史首胜", "球队赢下队史第一场常规赛。", 78, true],
    ["franchise_ten_wins_001", "初具竞争力", "球队取得生涯第十场胜利。", 48],
    ["franchise_fifty_wins_001", "五十胜", "球队首次完成单季 50 胜。", 62, true],
    ["franchise_sixty_wins_001", "六十胜", "球队完成精英级的 60 胜赛季。", 76, true],
    ["franchise_all_star_001", "自家球星", "自己选中的球员首次入选全明星。", 68, true],
    ["franchise_dynasty_001", "王朝雏形", "球队在三年内赢得第二座冠军。", 98, true],
  ],
  DRAFT: [
    ["draft_lottery_jump_001", "乐透跃升", "球队在乐透抽签中获得超预期签位。", 58, true],
    ["draft_pick_001", "新秀加盟", "球队完成一个重要选秀选择。", 42],
  ],
  FREE_AGENCY: [
    ["free_agency_signing_001", "自由球员加盟", "球队完成一笔自由市场签约。", 44],
    ["free_agency_miss_001", "目标落空", "自由球员选择了另一支球队。", 46],
  ],
  RFA: [
    ["rfa_offer_sheet_001", "受限球员报价", "你的受限自由球员收到报价合同。", 88, true],
    ["rfa_match_001", "匹配完成", "球队决定匹配受限自由球员报价。", 54],
  ],
  AI_GM: [
    ["ai_gm_rebuild_001", "重建信号", "一支电脑球队开始出售老将。", 22, false, "LEAGUE"],
    ["ai_gm_contend_001", "争冠加码", "一支争冠球队正在积极补强。", 26, false, "LEAGUE"],
  ],
};

function definition(category: string, seed: EventSeed): EventDefinition {
  const [id, title, description, priority = 40, pauseSimulation = false, scope = "PLAYER_TEAM"] = seed;
  const seasonOpening = id === "franchise_season_opening_001";
  const expansionComplete = id === "expansion_complete_001";
  const choiceEffects: EventEffectDefinition[] = seasonOpening ? [] : category === "MORALE" || category === "ROLE"
    ? [{ effectId: "morale_response", type: "PLAYER_MORALE", target: "{{player_id}}", value: category === "MORALE" ? 6 : 4, executionPhase: "ON_CHOICE" }]
    : category === "BREAKOUT"
      ? [{ effectId: "form_breakout", type: "PLAYER_FORM", target: "{{player_id}}", value: 0.75, executionPhase: "ON_CHOICE" }]
      : category === "SLUMP"
        ? [{ effectId: "form_recovery", type: "PLAYER_FORM", target: "{{player_id}}", value: 0.4, executionPhase: "ON_CHOICE" }]
        : category === "STREAK" || category === "FRANCHISE" || category === "EXPANSION" || category === "PLAYOFFS"
          ? [{ effectId: "fan_response", type: "TEAM_FAN_SUPPORT", value: id.includes("losing") ? -1 : 1, executionPhase: "ON_CHOICE" }]
          : [{ effectId: "event_log", type: "LEAGUE_LOG", value: title, executionPhase: "ON_CHOICE" }];
  const choices = category === "MORALE" || category === "ROLE"
    ? [
      {
        id: "increase_role",
        label: "回应诉求 · 提升角色",
        effects: [{ effectId: "morale_role_up", type: "PLAYER_MORALE" as const, target: "{{player_id}}", value: 12, executionPhase: "ON_CHOICE" as const }],
      },
      {
        id: "maintain_plan",
        label: "维持当前轮换",
        effects: [{ effectId: "morale_role_down", type: "PLAYER_MORALE" as const, target: "{{player_id}}", value: -8, executionPhase: "ON_CHOICE" as const }],
      },
    ]
    : [{ id: "acknowledge", label: "确认", effects: choiceEffects }];
  return {
    id,
    version: 1,
    type: category,
    category,
    scope,
    visibility: expansionComplete ? "BACKGROUND" : "PLAYER_VISIBLE",
    priority,
    trigger: { mode: seasonOpening ? "MANUAL" : "CONDITION", checkPoint: category === "FREE_AGENCY" || category === "DRAFT" ? "OFFSEASON" : "AFTER_GAME" },
    conditions: {},
    weight: (BALANCE_CONFIG.randomEvents.categoryWeights as Record<string, number>)[category] ?? BALANCE_CONFIG.randomEvents.defaultWeight,
    cooldownGames: seasonOpening ? 0 : BALANCE_CONFIG.randomEvents.defaultCooldownGames,
    oncePerSeason: category === "FRANCHISE" || id.includes("first_") || id.includes("award") || id.includes("champion") || id.includes("complete"),
    oncePerCareer: !seasonOpening && (category === "FRANCHISE" || category === "EXPANSION" || id.includes("first_") || id.includes("complete_001") || id.includes("dynasty")),
    pauseSimulation: expansionComplete ? false : pauseSimulation,
    visual: { useIllustration: true, illustrationKey: id.replace(/_\d+$/u, "") },
    content: { title, description },
    autoEffects: [],
    choices,
    aiChoice: { strategy: "FIRST" },
    tags: [category.toLowerCase()],
  };
}

export const EVENT_DEFINITIONS: EventDefinition[] = Object.entries(seedGroups)
  .flatMap(([category, seeds]) => seeds.map((seed) => definition(category, seed)));

export const EVENT_DEFINITION_BY_ID = Object.fromEntries(EVENT_DEFINITIONS.map((event) => [event.id, event]));
