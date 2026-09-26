import type { GameState } from "../game/state/types";
import type { CareerOverview, FranchiseRecords } from "../game/career/CareerRecords";

type PostEditorResponse = { code: number; message?: string };
type PostEditorBridge = { openPostEditor: (params: { title: string; content: string }) => Promise<PostEditorResponse> };

export function careerPostDraft(state: GameState, overview: CareerOverview, records: FranchiseRecords, latestMilestone?: string) {
  const teamName = state.teams[state.userTeamId]?.fullName ?? "我的球队";
  const record = `${overview.regularSeasonWins}胜${overview.regularSeasonLosses}负`;
  const bestSeason = records.bestSeason
    ? `${records.bestSeason.seasonId}赛季 ${records.bestSeason.wins}胜${records.bestSeason.losses}负${records.bestSeason.isCurrent ? "（进行中）" : ""}`
    : "仍在征程中";
  return {
    title: `${teamName}生涯战报：王朝积分${overview.dynastyScore}，${record}，${overview.championships}座总冠军`,
    content: [
      `我在《篮球经理：扩军时代》执掌${teamName}，目前是${overview.level}，王朝积分${overview.dynastyScore}。`,
      `生涯常规赛：${record}；已完成${overview.seasons}个赛季。`,
      `球队荣誉：${overview.championships}座总冠军、${overview.conferenceTitles}次分区冠军；附加赛及季后赛累计${overview.playoffWins}胜。`,
      `最佳赛季：${bestSeason}。${latestMilestone ? `最新里程碑：${latestMilestone}。` : ""}`,
      "这支球队接下来该怎么建设？欢迎一起聊聊。",
    ].join("\n\n"),
  };
}

export async function openCareerPostEditor(draft: ReturnType<typeof careerPostDraft>): Promise<void> {
  const bridge = (window as Window & { ColorboxAI?: { request?: { bbs?: PostEditorBridge } } }).ColorboxAI?.request?.bbs;
  if (!bridge?.openPostEditor) throw new Error("请在虎扑 App 内打开游戏后使用发帖分享。");
  const response = await bridge.openPostEditor(draft);
  if (response.code !== 200) throw new Error(response.message || "发帖编辑器暂时无法打开，请稍后重试。");
}
