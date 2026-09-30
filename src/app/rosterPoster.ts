import { calculatePlayerOverall } from "../game/player/PlayerRatingService";
import { LINEUP_POSITIONS } from "../game/roster/RotationPlanService";
import type { Player, Position, Team, TeamRotationPlan } from "../game/state/types";
import { playerNameZh } from "./playerNameZh";
import { portraitSpriteMeta } from "./portraitSprite";
import { loadRetiredPortrait, retiredPortraitId } from "./retiredPortraitLoader";

export interface RosterPosterData {
  team: Pick<Team, "fullName">;
  players: Player[];
  seasonId: string;
  plan: TeamRotationPlan;
}

export interface RosterPosterRow {
  playerId: string;
  name: string;
  position: Position;
  overall: number;
  portraitPath?: string | null;
}

/** Share the displayed draft exactly; invalid slots must never be auto-filled. */
export function rosterPosterRows(data: RosterPosterData): RosterPosterRow[] {
  const playersById = new Map(data.players.map((player) => [player.id, player]));
  const selectedIds = new Set<string>();
  return LINEUP_POSITIONS.map((position) => {
    const player = playersById.get(data.plan.starters[position]);
    if (!player) throw new Error(`请先为 ${position} 选择首发球员，再晒出首发五虎。`);
    if (selectedIds.has(player.id)) throw new Error("首发球员不能重复，请调整首发五虎后再试。");
    if (!player.available || player.injury) throw new Error("首发包含无法出战的球员，请调整首发五虎后再试。");
    selectedIds.add(player.id);
    return {
      playerId: player.id,
      name: playerNameZh(player.name, player.id),
      position,
      overall: calculatePlayerOverall(player),
      portraitPath: player.portraitPath,
    };
  });
}

function fitText(ctx: CanvasRenderingContext2D, value: string, maxWidth: number): string {
  if (ctx.measureText(value).width <= maxWidth) return value;
  const letters = Array.from(value);
  while (letters.length && ctx.measureText(`${letters.join("")}…`).width > maxWidth) letters.pop();
  return ctx.measureText("…").width <= maxWidth ? `${letters.join("")}…` : "";
}

function loadImage(source: string, label: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
      if (error) reject(error); else resolve(image);
    };
    const timeout = setTimeout(() => finish(new Error(`${label}加载超时，请重试。`)), 10000);
    image.onload = () => finish(image.naturalWidth > 0 && image.naturalHeight > 0 ? undefined : new Error(`${label}加载失败，请重试。`));
    image.onerror = () => finish(new Error(`${label}加载失败，请重试。`));
    image.src = source;
  });
}

interface PortraitSource { source: string; column?: number }

async function portraitSource(row: RosterPosterRow): Promise<PortraitSource | null> {
  if (retiredPortraitId(row.portraitPath)) {
    const source = await loadRetiredPortrait(row.portraitPath);
    return source ? { source } : null;
  }
  if (!row.portraitPath?.match(/^\.\/player-portraits\/nba-\d+\.png$/u)) return null;
  const sprite = portraitSpriteMeta(row.playerId, row.portraitPath);
  return sprite ? { source: `${import.meta.env.BASE_URL}${sprite.source.slice(2)}`, column: sprite.index % 25 } : null;
}

function drawDefaultPortrait(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  ctx.fillStyle = "#29485a";
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = "#91acbc";
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size * 0.34, size * 0.18, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size * 0.98, size * 0.35, Math.PI, Math.PI * 2);
  ctx.fill();
}

export async function renderRosterPoster(data: RosterPosterData): Promise<Blob> {
  const rows = rosterPosterRows(data);
  const width = 1080;
  const height = 1560;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("当前设备无法生成首发五虎图片。");
  const sources = await Promise.all(rows.map(portraitSource));
  // Cache only within this export: teammates in one atlas share a single load.
  const images = new Map<string, Promise<HTMLImageElement | null>>();
  const portraits = sources.map((source) => {
    if (!source) return Promise.resolve(null);
    if (!images.has(source.source)) images.set(source.source, loadImage(source.source, "球员头像").catch(() => null));
    return images.get(source.source)!;
  });
  const [logo, loadedPortraits] = await Promise.all([
    loadImage(`${import.meta.env.BASE_URL}branding/home-logo-cutout.png`, "应用 Logo "),
    Promise.all(portraits),
  ]);

  const background = ctx.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, "#102c40");
  background.addColorStop(0.5, "#091624");
  background.addColorStop(1, "#07111d");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#366174";
  ctx.lineWidth = 2;
  ctx.strokeRect(45, 45, width - 90, height - 90);
  ctx.drawImage(logo, 65, 65, 220, 220);
  ctx.textAlign = "left";
  ctx.fillStyle = "#dfbd7b";
  ctx.font = "900 56px sans-serif";
  ctx.fillText("首发五虎", 310, 135);
  ctx.fillStyle = "#f5faff";
  ctx.font = "700 38px sans-serif";
  ctx.fillText(fitText(ctx, data.team.fullName, 680), 310, 200);
  ctx.fillStyle = "#9eb8c8";
  ctx.font = "26px sans-serif";
  ctx.fillText(fitText(ctx, `${data.seasonId} 赛季`, 680), 310, 251);
  ctx.fillStyle = "#d7b36f";
  ctx.fillRect(85, 310, 120, 6);

  rows.forEach((row, index) => {
    const y = 350 + index * 218;
    ctx.fillStyle = "#122c3d";
    ctx.fillRect(85, y, 910, 198);
    ctx.textAlign = "center";
    ctx.fillStyle = "#dfbd7b";
    ctx.font = "900 36px sans-serif";
    ctx.fillText(row.position, 143, y + 112);
    const x = 210;
    const portraitY = y + 25;
    const size = 148;
    const source = sources[index];
    const image = loadedPortraits[index];
    let drawn = false;
    if (source && image) {
      try {
        if (source.column === undefined) ctx.drawImage(image, x, portraitY, size, size);
        else {
          const cellWidth = image.naturalWidth / 25;
          ctx.drawImage(image, source.column * cellWidth, 0, cellWidth, image.naturalHeight, x, portraitY, size, size);
        }
        drawn = true;
      } catch { /* A damaged local image still exports with a default portrait. */ }
    }
    if (!drawn) drawDefaultPortrait(ctx, x, portraitY, size);
    ctx.textAlign = "left";
    ctx.fillStyle = "#f5faff";
    ctx.font = "700 38px sans-serif";
    ctx.fillText(fitText(ctx, row.name, 410), 395, y + 112);
    ctx.textAlign = "center";
    ctx.fillStyle = "#9fbccc";
    ctx.font = "24px sans-serif";
    ctx.fillText("能力", 900, y + 58);
    ctx.fillStyle = "#f5ce84";
    ctx.font = "900 60px sans-serif";
    ctx.fillText(row.overall.toFixed(0), 900, y + 132);
  });
  ctx.textAlign = "center";
  ctx.fillStyle = "#c3d4dd";
  ctx.font = "26px sans-serif";
  ctx.fillText("篮球经理：联盟扩军时代", width / 2, height - 78);

  const blob = await new Promise<Blob | null>((resolve, reject) => {
    try { canvas.toBlob(resolve, "image/png"); }
    catch { reject(new Error("首发五虎图片生成失败，请重试。")); }
  });
  if (!blob) throw new Error("首发五虎图片生成失败，请重试。");
  return blob;
}
