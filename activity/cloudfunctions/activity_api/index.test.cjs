const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const test = require("node:test");

const entry = {
  id: 12, puid: "private-user", display_name: "虎扑玩家", avatar_url: "https://img.hupu.com/avatar.png",
  team_name: "西雅图超音速", team_logo: "./expansion-logos/seattle-default.png", season_id: "2027-28",
  score: 4200, title: "新手经理", updated_at: "2026-09-30T01:00:00Z",
};
const proof = {
  version: 1, score: 10, current: { wins: 1, losses: 0 }, seasons: [], achievements: ["FIRST_WIN"],
  teamName: "西雅图超音速", teamLogo: "./expansion-logos/seattle-default.png", seasonId: "2027-28", title: "传奇经理",
};

function harness({ query = async () => ({ data: [entry] }), submit = entry } = {}) {
  const queries = [];
  const submissions = [];
  let now = 1000;
  const sdk = { init: () => ({
    auth: () => ({ getClientCredential: async () => "test-token" }),
    rdb: () => ({ from: table => {
      const commands = [["from", table]];
      const builder = {
        then: (resolve, reject) => {
          queries.push(commands);
          return Promise.resolve(query(commands)).then(resolve, reject);
        },
      };
      for (const method of ["select", "order", "limit", "gt", "eq", "lt"]) {
        builder[method] = (...args) => { commands.push([method, ...args]); return builder; };
      }
      return builder;
    } }),
  }) };
  const module = { exports: {} };
  const context = {
    module, exports: module.exports, Buffer, URL, process: { env: { CLOUDBASE_ENV_ID: "test-env" } },
    console: { error() {} }, Date: { now: () => now },
    require: name => name === "@cloudbase/node-sdk" ? sdk : require(name === "./score" ? "./score.js" : name),
    fetch: async (_url, options) => {
      submissions.push(JSON.parse(options.body));
      return { ok: true, text: async () => JSON.stringify(submit) };
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "index.js"), "utf8"), context);
  async function request(url, { method = "GET", body, authenticated = false } = {}) {
    const req = new EventEmitter();
    Object.assign(req, { url, method, headers: authenticated ? { "x-cloudbase-context": Buffer.from(JSON.stringify({ customUserId: "private-user" })).toString("base64") } : {} });
    const response = new Promise(resolve => {
      let status;
      const work = module.exports.handle(req, {
        writeHead: value => { status = value; },
        end: value => resolve({ status, body: value ? JSON.parse(value) : null }),
      });
      if (body !== undefined) { req.emit("data", JSON.stringify(body)); req.emit("end"); }
      work.catch(assert.fail);
    });
    return response;
  }
  return { request, queries, submissions, advance: ms => { now += ms; } };
}

test("public entries include profile and score title without exposing puid", async () => {
  const api = harness();
  const response = await api.request("/api/leaderboard?limit=100");
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data[0], {
    id: 12, rank: 1, score: 4200, displayName: "虎扑玩家", avatarUrl: entry.avatar_url,
    teamName: entry.team_name, teamLogo: entry.team_logo, seasonId: entry.season_id, title: "王朝经理",
  });
  assert.ok(!JSON.stringify(response.body).includes("private-user"));
});

test("top 100 requests share in-flight work, slice limits, and expire after 15 seconds", async () => {
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const api = harness({ query: async () => { await waiting; return { data: [entry, { ...entry, id: 13 }] }; } });
  const first = api.request("/leaderboard?limit=1");
  const second = api.request("/leaderboard?limit=100");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(api.queries.length, 1);
  release();
  assert.equal((await first).body.data.length, 1);
  assert.equal((await second).body.data.length, 2);
  await api.request("/leaderboard");
  assert.equal(api.queries.length, 1);
  assert.equal(api.queries[0].at(-1)[1], 100);
  api.advance(15001);
  await api.request("/leaderboard");
  assert.equal(api.queries.length, 2);
});

test("personal rank launches all three count queries concurrently", async () => {
  let pending = [];
  const api = harness({ query: commands => {
    if (commands.some(command => command[0] === "select" && command[2]?.count)) {
      return new Promise(resolve => {
        pending.push(resolve);
        if (pending.length === 3) pending.forEach((done, index) => done({ count: index + 1 }));
      });
    }
    return { data: [entry] };
  } });
  const response = await api.request("/leaderboard/me", { authenticated: true });
  assert.equal(pending.length, 3);
  assert.equal(response.body.data.rank, 7);
  assert.equal(response.body.data.teamName, entry.team_name);
  assert.equal(response.body.data.avatarUrl, entry.avatar_url);
});

test("submit returns complete rank and refreshes public cache without a personal GET", async () => {
  const api = harness({ query: commands => commands.some(command => command[2]?.count) ? { count: 0 } : { data: [entry] } });
  await api.request("/leaderboard");
  const response = await api.request("/leaderboard/submit", { method: "POST", authenticated: true, body: { proof, displayName: "昵称\u0000", avatarUrl: entry.avatar_url } });
  assert.equal(response.status, 200);
  assert.equal(response.body.data.id, 12);
  assert.equal(response.body.data.rank, 1);
  assert.equal(response.body.data.teamLogo, entry.team_logo);
  assert.equal(response.body.data.title, "王朝经理");
  assert.equal(api.submissions[0].p_display_name, "昵称");
  assert.equal(api.submissions[0].p_avatar_url, entry.avatar_url);
  assert.equal(api.submissions[0].p_team_name, proof.teamName);
  assert.equal(api.submissions[0].p_team_logo, proof.teamLogo);
  assert.equal(api.submissions[0].p_season_id, proof.seasonId);
  assert.equal(api.submissions[0].p_title, "新手经理", "client-provided title must not be trusted");
  assert.equal(api.queries.length, 4, "cached top 100 plus only three rank counts");
  await api.request("/leaderboard");
  assert.equal(api.queries.length, 5);
});

test("rate-limited score still clears profile cache and returns 429", async () => {
  const api = harness({ submit: { ...entry, score: 0 } });
  await api.request("/leaderboard");
  const response = await api.request("/leaderboard/submit", { method: "POST", authenticated: true, body: { proof } });
  assert.equal(response.status, 429);
  assert.match(response.body.message, /一分钟/);
  await api.request("/leaderboard");
  assert.equal(api.queries.length, 2);
});

test("titles retain the game's championship and completed-season rules", async () => {
  const season = (index, champion) => ({
    seasonId: `${2025 + index}-${String(26 + index).padStart(2, "0")}`, wins: 0, losses: 82,
    enteredPlayIn: false, enteredPlayoffs: champion, seriesWins: champion ? 4 : 0,
    conferenceFinals: champion, finalsAppearance: champion, champion,
    playoffWins: champion ? 16 : 0, playoffLosses: 0,
  });
  for (const [championships, years, score, title] of [[0, 2, 0, "优秀经理"], [1, 1, 1900, "冠军经理"], [2, 2, 3800, "王朝经理"], [4, 4, 7600, "传奇经理"]]) {
    const career = { ...proof, score, achievements: [], seasons: Array.from({ length: years }, (_, index) => season(index, index < championships)) };
    const api = harness({ submit: { ...entry, score, title }, query: () => ({ count: 0 }) });
    const response = await api.request("/leaderboard/submit", { method: "POST", authenticated: true, body: { proof: career } });
    assert.equal(response.status, 200);
    assert.equal(api.submissions[0].p_title, title);
    assert.equal(response.body.data.title, title);
  }
});

test("submission invalidation prevents an older in-flight response restoring cache", async () => {
  let release;
  let releaseNew;
  let topQueries = 0;
  const waiting = new Promise(resolve => { release = resolve; });
  const waitingNew = new Promise(resolve => { releaseNew = resolve; });
  const api = harness({ query: async commands => {
    if (commands.some(command => command[2]?.count)) return { count: 0 };
    if (++topQueries === 1) await waiting;
    else await waitingNew;
    return { data: [entry] };
  } });
  const staleRequest = api.request("/leaderboard");
  await new Promise(resolve => setImmediate(resolve));
  await api.request("/leaderboard/submit", { method: "POST", authenticated: true, body: { proof } });
  const freshRequest = api.request("/leaderboard");
  await new Promise(resolve => setImmediate(resolve));
  release();
  await staleRequest;
  const joinedRequest = api.request("/leaderboard");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(topQueries, 2);
  releaseNew();
  await Promise.all([freshRequest, joinedRequest]);
});

test("failed public query is not cached and unsafe avatar URLs are removed", async () => {
  let calls = 0;
  const api = harness({ query: () => ++calls === 1 ? { error: "db unavailable" } : { data: [{ ...entry, avatar_url: "javascript:alert(1)", team_logo: "//evil.test/logo.svg" }] } });
  assert.equal((await api.request("/leaderboard")).status, 500);
  const response = await api.request("/leaderboard");
  assert.equal(response.body.data[0].avatarUrl, "");
  assert.equal(response.body.data[0].teamLogo, "");
  assert.equal(calls, 2);
});
