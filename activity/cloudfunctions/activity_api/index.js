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
  const result = await rdb.from(LEADERBOARD_TABLE)
    .select("id, display_name, score, updated_at")
    .order("score", { ascending: false })
    .order("updated_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(limit);
  return queryRows(result);
}

async function count(query) {
  const result = await query;
  if (typeof result.count !== "number") throw new Error("榜单计数暂不可用");
  return result.count;
}

async function rankOf(row) {
  const higher = await count(rdb.from(LEADERBOARD_TABLE).select("id", { count: "exact" }).gt("score", row.score).limit(1));
  const earlier = await count(rdb.from(LEADERBOARD_TABLE).select("id", { count: "exact" })
    .eq("score", row.score).lt("updated_at", row.updated_at).limit(1));
  const sameTime = await count(rdb.from(LEADERBOARD_TABLE).select("id", { count: "exact" })
    .eq("score", row.score).eq("updated_at", row.updated_at).lt("id", row.id).limit(1));
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

async function submitScore(puid, displayName, score) {
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
      body: JSON.stringify({ p_puid: puid, p_display_name: displayName, p_score: score })
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
      const rows = await loadLeaderboard(limit);
      const data = rows.map((row, index) => ({
        id: row.id,
        rank: index + 1,
        displayName: row.display_name,
        score: Number(row.score),
        updatedAt: row.updated_at
      }));
      res.writeHead(200, headers);
      return res.end(JSON.stringify({ code: 0, message: "success", data }));
    }

    if (req.method === "GET" && path === "/leaderboard/me") {
      const puid = readPuid(req);
      const result = await rdb.from(LEADERBOARD_TABLE).select("id, score, display_name, updated_at").eq("puid", puid).limit(1);
      const rows = queryRows(result);
      if (!rows.length) {
        res.writeHead(200, headers);
        return res.end(JSON.stringify({ code: 0, message: "success", data: null }));
      }
      const score = Number(rows[0].score);
      const rank = await rankOf(rows[0]);
      res.writeHead(200, headers);
      return res.end(JSON.stringify({ code: 0, message: "success", data: { id: rows[0].id, rank, score, displayName: rows[0].display_name } }));
    }

    if (req.method === "POST" && path === "/leaderboard/submit") {
      const puid = readPuid(req);
      const body = await getJsonBody(req);
      const score = validateScoreProof(body.proof);
      const displayName = typeof body.displayName === "string" && body.displayName.trim()
        ? body.displayName.trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 40)
        : "虎扑经理";
      const data = await submitScore(puid, displayName, score);
      if (Number(data.score) < score) {
        const err = new Error("提交过于频繁，请一分钟后再试");
        err.statusCode = 429;
        throw err;
      }
      res.writeHead(200, headers);
      return res.end(JSON.stringify({ code: 0, message: "success", data: { score: Number(data.score), displayName: data.display_name } }));
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

http.createServer(handle).listen(process.env.PORT || 9000);
