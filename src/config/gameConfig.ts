import { SIMULATION_CONFIG } from "../game/simulation/config";
import { BALANCE_CONFIG } from "./balanceConfig";
import { LEAGUE_FINANCE_CONFIG } from "./leagueFinance";

/**
 * 调参统一入口。各模块仍按领域拆分，避免一个超大文件成为依赖中心；
 * 工具、测试和后续配置面板只需要读取 GAME_CONFIG。
 */
export const GAME_CONFIG = {
  version: "game-config.v5",
  balance: BALANCE_CONFIG,
  simulation: SIMULATION_CONFIG,
  finance: LEAGUE_FINANCE_CONFIG,
} as const;

export function validateGameConfig(): string[] {
  const errors: string[] = [];
  const { balance, simulation, finance } = GAME_CONFIG;
  const assert = (condition: boolean, message: string): void => { if (!condition) errors.push(message); };

  assert(simulation.paceMin < simulation.leagueBasePace && simulation.leagueBasePace < simulation.paceMax, "Pace 必须满足 min < base < max");
  assert(simulation.garbageTime.scoreMarginThreshold > 0, "垃圾时间分差必须大于 0");
  assert(Math.abs(Object.values(simulation.ratings.offenseWeights).reduce((sum, value) => sum + value, 0) - 1) < 0.0001, "进攻影响权重之和必须为 1");
  assert(Math.abs(Object.values(simulation.ratings.defenseWeights).reduce((sum, value) => sum + value, 0) - 1) < 0.0001, "防守影响权重之和必须为 1");
  assert(Math.abs(simulation.boxScore.usage.tendencyWeight + simulation.boxScore.usage.offenseImpactWeight - 1) < 0.0001, "Usage 权重之和必须为 1");
  assert(Math.abs(simulation.starPower.bestStarWeight + simulation.starPower.secondStarWeight - 1) < 0.0001, "Star Power 聚合权重之和必须为 1");
  assert(balance.freeAgency.minimumAcceptThreshold <= balance.freeAgency.earlyAcceptThreshold, "自由市场最低接受阈值不能高于提前接受阈值");
  assert(balance.freeAgency.marketSalary.ratingAnchors.every((anchor, index, anchors) =>
    anchor.annualSalary > 0 && (index === 0 || anchor.overall > anchors[index - 1].overall && anchor.annualSalary > anchors[index - 1].annualSalary)),
  "自由球员年薪锚点必须随能力严格递增");
  const offerWeights = balance.freeAgency.weights;
  assert(Object.values(offerWeights).reduce((sum, value) => sum + value, 0) === 100, "自由市场报价权重之和必须为 100");
  assert(Object.values(balance.freeAgency.personalityWeightShifts).every((shifts) =>
    Object.values(shifts).reduce((sum: number, value) => sum + value, 0) === 0
    && Object.keys(offerWeights).every((key) => offerWeights[key as keyof typeof offerWeights] + ((shifts as Record<string, number>)[key] ?? 0) >= 0)),
  "性格权重调整必须守恒且不能产生负权重");
  assert(Object.values(balance.teamCore.marketRatings).every((value) => Number.isInteger(value) && value >= 0 && value <= 100), "球队市场评分必须在 0～100 之间");
  assert(Object.values(balance.freeAgency.weights).reduce((sum, value) => sum + value, 0) === 100, "自由市场 Utility 权重之和必须为 100");
  assert(Object.values(balance.expansion.aiStrategyWeights).reduce((sum, value) => sum + value, 0) === 100, "扩军 AI 策略权重之和必须为 100");
  assert(balance.draft.classSize >= 64, "Draft 人数不能少于联盟选秀签位数");
  assert(balance.draft.historicalRebirth.classShare >= 0 && balance.draft.historicalRebirth.classShare <= 1, "历史原型新秀占比必须在 0～1");
  assert(balance.draft.historicalRebirth.maximumPerClass >= 0 && balance.draft.historicalRebirth.maximumPerClass <= balance.draft.classSize, "历史原型新秀人数不能超过 Draft 人数");
  assert(balance.draft.historicalRebirth.mode === "LEGEND_ARCHETYPE", "当前版本仅支持传奇原型身份模式");
  assert(balance.draft.historicalRebirth.reusePerCareer === 1, "同一历史来源在单个存档中只能使用一次");
  assert(balance.leagueBalance.annualRookieInflow === balance.draft.classSize, "联盟年度新秀供给应与 Draft 人数一致");
  assert(Object.values(balance.injuries.severityWeights).reduce((sum, value) => sum + value, 0) === 100, "伤病类型权重之和必须为 100");
  assert(Math.abs(Object.values(balance.teamFit.scoreWeights).reduce((sum, value) => sum + value, 0) - 1) < 0.0001, "Team Fit 权重之和必须为 1");
  assert(Math.abs(balance.teamFit.starWeights.primary + balance.teamFit.starWeights.secondary - 1) < 0.0001, "Team Fit Star Power 权重之和必须为 1");
  assert(Math.abs(Object.values(balance.teamCore.freeAgentAttractionWeights).reduce((sum, value) => sum + value, 0) - 1) < 0.0001, "FA Attraction 权重之和必须为 1");
  assert(Object.values(balance.overall.attributeWeightsByPosition).every((weights) =>
    Math.abs(Object.values(weights).reduce((sum, value) => sum + value, 0) - 1) < 0.0001), "各位置 OVR 权重之和必须为 1");
  assert(finance.minimumTeamSalary < finance.salaryCap, "最低球队工资必须低于工资帽");
  assert(finance.salaryCap < finance.luxuryTaxLine && finance.luxuryTaxLine < finance.firstApron && finance.firstApron < finance.secondApron, "工资帽、奢侈税线和 Apron 顺序非法");
  assert(finance.contractYears.minimum <= finance.contractYears.otherTeamMaximum && finance.contractYears.otherTeamMaximum <= finance.contractYears.ownTeamMaximum, "合同年限配置非法");
  assert(finance.rosterLimits.hardPlayableMinimum <= finance.rosterLimits.emergencyTarget
    && finance.rosterLimits.emergencyTarget <= finance.rosterLimits.regularSeasonMinimum
    && finance.rosterLimits.regularSeasonMinimum <= finance.rosterLimits.regularSeasonMaximum
    && finance.rosterLimits.regularSeasonMaximum <= finance.rosterLimits.offseasonMaximum, "名单人数阈值顺序非法");
  assert(balance.playerLifecycle.retirement.ageProbability.every((entry, index, rows) => index === 0 || entry.minimumAge < rows[index - 1].minimumAge), "退役年龄档位必须按年龄降序排列");
  return errors;
}

export function assertValidGameConfig(): void {
  const errors = validateGameConfig();
  if (errors.length) throw new Error(`GAME_CONFIG_INVALID: ${errors.join("；")}`);
}
