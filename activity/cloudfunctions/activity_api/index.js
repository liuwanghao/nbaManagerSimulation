const http = require("http");
const zlib = require("zlib");
const tcb = require("@cloudbase/node-sdk");
const { validateScoreProof } = require("./score");

const app = tcb.init({
  env: process.env.CLOUDBASE_ENV_ID || process.env.TCB_ENV,
  accessKey: process.env.COLORBOX__ACCESS_KEY
});
const rdb = app.rdb({ database: "public" });
const LEADERBOARD_TABLE = "leaderboard_entries";
const PUBLIC_COLUMNS = "id, display_name, avatar_url, team_name, team_logo, season_id, title, score, updated_at";
const LEADERBOARD_CACHE_MS = 15000;
let leaderboardCache = null;
let leaderboardInFlight = null;
let leaderboardGeneration = 0;

function clearLeaderboardCache() {
  leaderboardGeneration++;
  leaderboardCache = null;
  leaderboardInFlight = null;
}

function cleanText(value, max, fallback = "") {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max) || fallback : fallback;
}

function imageUrl(value, local = false) {
  const url = cleanText(value, 2048);
  if (local && /^(?:\.\/|\/)(?:team-logos|expansion-logos)\/[a-zA-Z0-9_-]+\.(?:png|webp|svg)$/.test(url)) return url;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password ? parsed.href : "";
  } catch { return ""; }
}

function managerTitle(score, fallback = "新手经理") {
  if (score >= 7500 || fallback === "传奇经理") return "传奇经理";
  if (score >= 4000 || fallback === "王朝经理") return "王朝经理";
  if (score >= 1500) return fallback === "冠军经理" ? fallback : "联盟精英";
  return ["冠军经理", "优秀经理", "新手经理"].includes(fallback) ? fallback : "新手经理";
}

function publicEntry(row, rank) {
  const score = Number(row.score);
  return {
    id: row.id, rank, score,
    displayName: cleanText(row.display_name, 40, "虎扑经理"),
    avatarUrl: imageUrl(row.avatar_url),
    teamName: cleanText(row.team_name, 80),
    teamLogo: imageUrl(row.team_logo, true),
    seasonId: typeof row.season_id === "string" && /^\d{4}-\d{2}$/.test(row.season_id) ? row.season_id : "",
    title: managerTitle(score, row.title),
  };
}

function apiPath(req) {
  const pathname = new URL(req.url, "http://localhost").pathname || "/";
  return pathname.replace(/^\/api(?=\/|$)/, "") || "/";
}

function readPuid(req) {
  const raw = req.headers["x-cloudbase-context"];
  if (!raw) {
    const err = new Error("请先登录");
    err.statusCode = 401;
    throw err;
  }
  let buf = Buffer.from(String(raw).trim(), "base64");
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    buf = zlib.gunzipSync(buf);
  }
  let context;
  try { context = JSON.parse(buf.toString("utf8")); } catch {
    const err = new Error("请先登录");
    err.statusCode = 401;
    throw err;
  }
  const puid = context.customUserId || context.userId || context.uid;
  if (!puid) {
    const err = new Error("请先登录");
    err.statusCode = 401;
    throw err;
  }
  return String(puid);
}

function queryRows(result) {
  if (!result) return [];
  if (Array.isArray(result)) return result;
  if (Array.isArray(result.data)) return result.data;
  if (Array.isArray(result.rows)) return result.rows;
  return [];
}

async function loadLeaderboard(limit) {
  if (leaderboardCache && leaderboardCache.expiresAt > Date.now()) return leaderboardCache.data.slice(0, limit);
  if (!leaderboardInFlight) {
    const generation = leaderboardGeneration;
    const pending = (async () => {
      const result = await rdb.from(LEADERBOARD_TABLE)
        .select(PUBLIC_COLUMNS)
        .order("score", { ascending: false })
        .order("updated_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(100);
      if (result.error) throw new Error("榜单暂不可用");
      const data = queryRows(result).map((row, index) => publicEntry(row, index + 1));
      if (generation === leaderboardGeneration) leaderboardCache = { data, expiresAt: Date.now() + LEADERBOARD_CACHE_MS };
      return data;
    })();
    leaderboardInFlight = pending;
    pending.finally(() => {
      if (leaderboardInFlight === pending) leaderboardInFlight = null;
    }).catch(() => {});
  }
  return (await leaderboardInFlight).slice(0, limit);
}

async function count(query) {
  const result = await query;
  if (typeof result.count !== "number") throw new Error("榜单计数暂不可用");
  return result.count;
}

async function rankOf(row) {
  const [higher, earlier, sameTime] = await Promise.all([
    count(rdb.from(LEADERBOARD_TABLE).select("id", { count: "exact" }).gt("score", row.score).limit(1)),
    count(rdb.from(LEADERBOARD_TABLE).select("id", { count: "exact" }).eq("score", row.score).lt("updated_at", row.updated_at).limit(1)),
    count(rdb.from(LEADERBOARD_TABLE).select("id", { count: "exact" }).eq("score", row.score).eq("updated_at", row.updated_at).lt("id", row.id).limit(1)),
  ]);
  return higher + earlier + sameTime + 1;
}

function getJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    let tooLarge = false;
    req.on("data", chunk => {
      if (tooLarge) return;
      body += chunk;
      if (body.length > 131072) {
        tooLarge = true;
        const err = new Error("请求内容过大");
        err.statusCode = 413;
        reject(err);
      }
    });
    req.on("end", () => {
      if (tooLarge) return;
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); } catch {
        const err = new Error("请求格式不正确");
        err.statusCode = 400;
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

async function getRdbServiceToken() {
  const credential = await app.auth().getClientCredential();
  if (typeof credential === "string" && credential.trim()) return credential.trim();
  if (credential && typeof credential.access_token === "string" && credential.access_token.trim()) {
    return credential.access_token.trim();
  }
  const accessKey = process.env.COLORBOX__ACCESS_KEY;
  if (accessKey && accessKey.trim()) return accessKey.trim();
  throw new Error("数据库服务凭据不可用");
}

async function submitScore(puid, profile, score) {
  const token = await getRdbServiceToken();
  const envId = process.env.CLOUDBASE_ENV_ID || process.env.TCB_ENV;
  const response = await fetch(
    `https://${envId}.api.tcloudbasegateway.com/v1/rdb/rest/rpc/submit_leaderboard_score`,
    {
      method: "POST",
      headers: {
        "Authorization": token.startsWith("Bearer ") ? token : `Bearer ${token}`,
        "X-Db-Instance": "default",
        "Accept-Profile": "public",
        "Content-Profile": "public",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ p_puid: puid, p_score: score, ...profile })
    }
  );
  const raw = await response.text();
  let data = raw;
  try { data = raw ? JSON.parse(raw) : null; } catch { /* preserve text for logs */ }
  if (!response.ok) {
    console.error("[Leaderboard RPC Error]", response.status, data);
    const err = new Error("成绩暂时无法保存");
    err.statusCode = 500;
    throw err;
  }
  return Array.isArray(data) ? data[0] : data;
}

async function handle(req, res) {
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Request-Id, X-CloudBase-Context",
    "Content-Type": "application/json; charset=utf-8"
  };
  if (req.method === "OPTIONS") {
    res.writeHead(204, headers);
    return res.end();
  }

  const path = apiPath(req);
  try {
    if (req.method === "GET" && path === "/health") {
      res.writeHead(200, headers);
      return res.end(JSON.stringify({ code: 0, message: "ok" }));
    }

    if (req.method === "GET" && path === "/leaderboard") {
      const requested = new URL(req.url, "http://localhost").searchParams.get("limit");
      const limit = requested === null ? 50 : Number(requested);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        const err = new Error("榜单条数须为 1 到 100");
        err.statusCode = 400;
        throw err;
      }
      const data = await loadLeaderboard(limit);
      res.writeHead(200, headers);
      return res.end(JSON.stringify({ code: 0, message: "success", data }));
    }

    if (req.method === "GET" && path === "/leaderboard/me") {
      const puid = readPuid(req);
      const result = await rdb.from(LEADERBOARD_TABLE).select(PUBLIC_COLUMNS).eq("puid", puid).limit(1);
      if (result.error) throw new Error("个人名次暂不可用");
      const rows = queryRows(result);
      if (!rows.length) {
        res.writeHead(200, headers);
        return res.end(JSON.stringify({ code: 0, message: "success", data: null }));
      }
      const rank = await rankOf(rows[0]);
      res.writeHead(200, headers);
      return res.end(JSON.stringify({ code: 0, message: "success", data: publicEntry(rows[0], rank) }));
    }

    if (req.method === "POST" && path === "/leaderboard/submit") {
      const puid = readPuid(req);
      const body = await getJsonBody(req);
      const score = validateScoreProof(body.proof);
      const championships = body.proof.seasons.filter(season => season.champion).length;
      const fallbackTitle = championships >= 1 ? "冠军经理" : body.proof.seasons.length >= 2 ? "优秀经理" : "新手经理";
      const title = championships >= 4 ? "传奇经理" : championships >= 2 ? "王朝经理" : managerTitle(score, fallbackTitle);
      const data = await submitScore(puid, {
        p_display_name: cleanText(body.displayName, 40, "虎扑经理"),
        p_avatar_url: imageUrl(body.avatarUrl),
        p_team_name: cleanText(body.proof.teamName, 80),
        p_team_logo: imageUrl(body.proof.teamLogo, true),
        p_season_id: typeof body.proof.seasonId === "string" && /^\d{4}-\d{2}$/.test(body.proof.seasonId) ? body.proof.seasonId : "",
        p_title: title,
      }, score);
      clearLeaderboardCache();
      if (Number(data.score) < score) {
        const err = new Error("提交过于频繁，请一分钟后再试");
        err.statusCode = 429;
        throw err;
      }
      res.writeHead(200, headers);
      return res.end(JSON.stringify({ code: 0, message: "success", data: publicEntry(data, await rankOf(data)) }));
    }

    res.writeHead(404, headers);
    return res.end(JSON.stringify({ code: 404, message: "not found" }));
  } catch (err) {
    console.error("[Activity API Error]", err);
    const statusCode = err.statusCode || 500;
    const message = statusCode < 500 ? (err.message || "请求失败") : "服务暂时不可用";
    res.writeHead(statusCode, headers);
    return res.end(JSON.stringify({ code: statusCode, message }));
  }
}

if (require.main === module) http.createServer(handle).listen(process.env.PORT || 9000);
module.exports = { handle };
