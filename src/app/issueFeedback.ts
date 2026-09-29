export interface GameIssueContext {
  kind: "年度切换失败" | "年度切换耗时过长";
  step: string;
  phase: string;
  seasonId: string;
  slotId: number;
  error?: string;
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
