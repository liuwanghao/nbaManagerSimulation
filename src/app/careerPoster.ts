import type { GameState } from "../game/state/types";
import type { CareerOverview } from "../game/career/CareerRecords";

const WIDTH = 1080;
const HEIGHT = 1350;

function fitText(ctx: CanvasRenderingContext2D, value: string, maxWidth: number): string {
  let text = value;
  while (text && ctx.measureText(text).width > maxWidth) text = text.slice(0, -1);
  return text === value ? text : `${text.slice(0, -1)}…`;
}

function loadLogo(): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const logo = new Image();
    logo.onload = () => resolve(logo);
    logo.onerror = () => reject(new Error("应用 Logo 加载失败，请重试。"));
    logo.src = `${import.meta.env.BASE_URL}branding/home-logo-cutout.png`;
  });
}

export async function renderCareerPoster(state: GameState, overview: CareerOverview, latestMilestone?: string, globalRank?: number | null): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("当前设备无法生成海报。");

  const background = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  background.addColorStop(0, "#102c40");
  background.addColorStop(0.52, "#091624");
  background.addColorStop(1, "#07111d");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = "rgba(0, 226, 242, .10)";
  ctx.beginPath(); ctx.arc(920, 80, 370, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "rgba(221, 169, 81, .08)";
  ctx.beginPath(); ctx.arc(90, 1170, 430, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "#366174";
  ctx.lineWidth = 2;
  ctx.strokeRect(45, 45, 990, 1260);
  ctx.fillStyle = "#d7b36f";
  ctx.fillRect(85, 80, 120, 8);
  ctx.fillRect(875, 1262, 120, 8);

  const logo = await loadLogo();
  ctx.drawImage(logo, 360, 75, 360, 360);
  ctx.textAlign = "center";
  ctx.fillStyle = "#dfbd7b";
  ctx.font = "700 26px sans-serif";
  ctx.fillText("MY FRANCHISE · CAREER REPORT", WIDTH / 2, 475);
  ctx.fillStyle = "#f5faff";
  ctx.font = "900 68px sans-serif";
  ctx.fillText("生 涯 战 报", WIDTH / 2, 565);

  const teamName = state.teams[state.userTeamId]?.fullName ?? "我的球队";
  ctx.font = "700 42px sans-serif";
  ctx.fillText(fitText(ctx, teamName, 850), WIDTH / 2, 655);
  ctx.fillStyle = "#9eb8c8";
  ctx.font = "28px sans-serif";
  ctx.fillText(fitText(ctx, `${state.league.seasonId} 赛季`, 850), WIDTH / 2, 698);
  ctx.fillStyle = "#f5ce84";
  ctx.font = "900 54px sans-serif";
  ctx.fillText(fitText(ctx, overview.level, 850), WIDTH / 2, 758);

  ctx.fillStyle = "#102b3b";
  ctx.fillRect(100, 790, 880, 210);
  ctx.strokeStyle = "#3f7181";
  ctx.strokeRect(100, 790, 880, 210);
  ctx.beginPath(); ctx.moveTo(640, 814); ctx.lineTo(640, 977); ctx.stroke();
  ctx.fillStyle = "#9fbccc";
  ctx.font = "700 28px sans-serif";
  ctx.fillText("王 朝 积 分", 370, 840);
  ctx.fillText("全 服 排 名", 810, 840);
  ctx.fillStyle = "#f5ce84";
  ctx.font = "900 88px sans-serif";
  ctx.fillText(fitText(ctx, overview.dynastyScore.toLocaleString("zh-CN"), 480), 370, 950);
  const rankLabel = globalRank === null ? "暂未上榜"
    : typeof globalRank === "number" && Number.isSafeInteger(globalRank) && globalRank > 0 ? `第 ${globalRank.toLocaleString("zh-CN")} 名` : "排名暂不可用";
  ctx.font = "900 48px sans-serif";
  for (let size = 46; ctx.measureText(rankLabel).width > 300 && size >= 14; size -= 2) ctx.font = `900 ${size}px sans-serif`;
  ctx.fillText(rankLabel, 810, 922);
  ctx.fillStyle = "#9fbccc";
  ctx.font = "22px sans-serif";
  ctx.fillText("按账号最高积分排名", 810, 968);

  const stats = [
    ["常规赛", `${overview.regularSeasonWins}胜 ${overview.regularSeasonLosses}负`],
    ["总冠军", `${overview.championships} 座`],
    ["完整赛季", `${overview.seasons} 季`],
  ];
  stats.forEach(([label, value], index) => {
    const x = 245 + index * 295;
    ctx.fillStyle = "#86aabd";
    ctx.font = "26px sans-serif";
    ctx.fillText(label, x, 1080);
    ctx.fillStyle = "#f5faff";
    ctx.font = "700 38px sans-serif";
    ctx.fillText(value, x, 1140);
  });
  ctx.strokeStyle = "#31546a";
  ctx.beginPath(); ctx.moveTo(110, 1185); ctx.lineTo(970, 1185); ctx.stroke();
  ctx.fillStyle = "#c3d4dd";
  ctx.font = "27px sans-serif";
  const footer = latestMilestone ? `最新里程碑 · ${latestMilestone}` : "从扩军建队，走向王朝";
  ctx.fillText(fitText(ctx, footer, 880), WIDTH / 2, 1238);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("海报生成失败，请重试。");
  return blob;
}
