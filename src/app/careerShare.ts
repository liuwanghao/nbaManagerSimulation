import type { GameState } from "../game/state/types";
import type { CareerOverview, FranchiseRecords } from "../game/career/CareerRecords";

type PostEditorResponse = { code: number; message?: string };
type PostEditorBridge = { openPostEditor: (params: {
  topicId: string;
  tagId: string;
  topicName: string;
  tagName: string;
  title: string;
  content: string;
  imageUrl: string;
}) => Promise<PostEditorResponse> };
type UploadBridge = { uploadFile: (params: { file: Blob; filename: string }) => Promise<{ downloadUrl?: string }> };

const CAREER_POST_DESTINATION = {
  topicId: "871",
  tagId: "157696",
  topicName: "AI工坊",
  tagName: "篮球经理：联盟扩军时代",
};

export function careerPostDraft(state: GameState, overview: CareerOverview, records: FranchiseRecords, latestMilestone?: string) {
  const teamName = state.teams[state.userTeamId]?.fullName ?? "我的球队";
  const record = `${overview.regularSeasonWins}胜${overview.regularSeasonLosses}负`;
  const bestSeason = records.bestSeason
    ? `${records.bestSeason.seasonId}赛季 ${records.bestSeason.wins}胜${records.bestSeason.losses}负${records.bestSeason.isCurrent ? "（进行中）" : ""}`
    : "仍在征程中";
  return {
    title: `${teamName}生涯战报：王朝积分${overview.dynastyScore}，${record}，${overview.championships}座总冠军`,
    content: [
      `我在《篮球经理：联盟扩军时代》执掌${teamName}，目前是${overview.level}，王朝积分${overview.dynastyScore}。`,
      `生涯常规赛：${record}；已完成${overview.seasons}个赛季。`,
      `球队荣誉：${overview.championships}座总冠军、${overview.conferenceTitles}次分区冠军；附加赛及季后赛累计${overview.playoffWins}胜。`,
      `最佳赛季：${bestSeason}。${latestMilestone ? `最新里程碑：${latestMilestone}。` : ""}`,
      "这支球队接下来该怎么建设？欢迎一起聊聊。",
    ].join("\n\n"),
  };
}

export async function openPosterPostEditor(
  draft: { title: string; content: string },
  poster: Blob,
  kind: "career" | "roster" = "career",
  onStage?: (stage: "uploading" | "opening") => void,
): Promise<void> {
  const sdk = (window as Window & { ColorboxAI?: { request?: { bbs?: PostEditorBridge }; oss?: UploadBridge } }).ColorboxAI;
  const bridge = sdk?.request?.bbs;
  if (!bridge?.openPostEditor) throw new Error("请在虎扑 App 内打开游戏后使用发帖分享。");
  if (!sdk?.oss?.uploadFile) throw new Error("图片上传暂不可用，请在虎扑 App 内重试。");
  if (!poster.size) throw new Error("海报生成失败，请重试。");
  if (poster.size > 10 * 1024 * 1024) throw new Error("海报超过 10MB，暂时无法上传。");
  onStage?.("uploading");
  const uploaded = await sdk.oss.uploadFile({ file: poster, filename: `basketball-manager-${kind}-${Date.now()}.png` });
  let imageUrl: URL;
  try { imageUrl = new URL(uploaded?.downloadUrl ?? ""); } catch { throw new Error("海报上传失败，请重试。"); }
  if (imageUrl.protocol !== "https:" || !imageUrl.hostname) throw new Error("海报上传失败，请重试。");
  onStage?.("opening");
  const response = await bridge.openPostEditor({ ...CAREER_POST_DESTINATION, ...draft, imageUrl: imageUrl.href });
  if (response?.code !== 200) throw new Error(response?.message || "发帖编辑器暂时无法打开，请稍后重试。");
}

export async function openCareerPostEditor(draft: ReturnType<typeof careerPostDraft>, poster: Blob): Promise<void> {
  return openPosterPostEditor(draft, poster);
}
