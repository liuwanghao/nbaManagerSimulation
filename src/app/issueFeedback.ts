import type { ContractLifecycleCommand } from "../game/contracts/ContractLifecycleService";

type ContractIssueOperation = "年度切换" | "球队选项处理" | "进入选秀前休赛期";

export interface GameIssueContext {
  kind: `${ContractIssueOperation}失败` | `${ContractIssueOperation}耗时过长`;
  step: string;
  phase: string;
  seasonId: string;
  slotId: number;
  error?: string;
}

const contractCommandIssueLabels = {
  ROLLOVER_LEAGUE_YEAR: {
    computeStep: "计算下一联盟年度", saveStep: "保存新赛季存档",
    failureKind: "年度切换失败", slowKind: "年度切换耗时过长",
  },
  RESOLVE_TEAM_OPTION: {
    computeStep: "处理球队选项", saveStep: "保存球队选项存档",
    failureKind: "球队选项处理失败", slowKind: "球队选项处理耗时过长",
  },
  FINALIZE_OPTION_PHASE: {
    computeStep: "完成合同选项结算", saveStep: "保存选秀前休赛期存档",
    failureKind: "进入选秀前休赛期失败", slowKind: "进入选秀前休赛期耗时过长",
  },
} as const;

export function getContractCommandIssueLabels(type: ContractLifecycleCommand["type"]) {
  return contractCommandIssueLabels[type];
}

export function buildGameIssueFeedback(context: GameIssueContext): string {
  const lines = [
    `【游戏异常】${context.kind}`,
    `处理步骤：${context.step}`,
    `赛季：${context.seasonId}`,
    `游戏阶段：${context.phase}`,
    `存档槽位：${context.slotId}`,
  ];
  if (context.error) lines.push(`错误：${context.error.slice(0, 800)}`);
  lines.push("请检查此处卡点或报错，保留当前存档以便复现。");
  return Array.from(lines.join("\n")).slice(0, 2000).join("");
}
