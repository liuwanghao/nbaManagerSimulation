import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.QA_BASE_URL || "http://127.0.0.1:5184";
const output = resolve(process.env.QA_OUTPUT || "reports/qa/2026-10-02/trade-black-screen");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];

try {
  for (const width of [393, 320]) {
    for (const scenario of ["normal", "targeted-filter", "user-shortage", "counterparty-shortage", "injured-incoming", "repair-roster", "picks-only", "missing-team", "incomplete-assets"]) {
      // Never attach to a real profile: each scenario gets empty, isolated storage.
      const context = await browser.newContext({ viewport: { width, height: 852 } });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(String(error)));
      page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
      await page.goto(`${base}/app.html`);
      const setup = await page.evaluate(async (scenario) => {
        const { createCareer } = await import("/src/game/season/career.ts");
        const { generateTradeOffers, generateTargetedTradeOffers, evaluateTradeOffer } = await import("/src/game/trade/TradeService.ts");
        const reactModule = await import("/node_modules/.vite/deps/react.js");
        const React = reactModule.default ?? reactModule;
        const clientModule = await import("/node_modules/.vite/deps/react-dom_client.js");
        const { createRoot } = clientModule.default ?? clientModule;
        const { default: App } = await import("/src/app/App.tsx");
        const state = createCareer(scenario === "targeted-filter" ? "trade-black-screen-generated" : "trade-impact-preview");
        state.league.currentPhase = "OFFSEASON_PRE_DRAFT";
        state.league.seasonYear = 2027;
        state.league.seasonId = "2027-28";
        let quoted;
        if (scenario === "targeted-filter") {
          state.teams[state.userTeamId].playerIds.forEach((id, index) => { state.players[id].available = index < 5; });
          state.players["POR-P04"].available = false;
          quoted = generateTargetedTradeOffers(state, ["POR-P04"]);
          if (!quoted.tradeDesk.offers.length || !quoted.tradeDesk.offers.every((offer) => evaluateTradeOffer(quoted, offer.offerId).legal)) throw new Error("Unsafe targeted quote generated");
        } else {
          quoted = generateTradeOffers(state, state.teams[state.userTeamId].playerIds[5], false);
        }
        let offer = quoted.tradeDesk.offers.find((entry) => entry.userIncomingPlayerIds.length === 1);
        if (!offer) throw new Error("Expected a one-player quote");
        if (["user-shortage", "counterparty-shortage", "injured-incoming"].includes(scenario)) {
          const teamId = scenario === "counterparty-shortage" ? offer.counterpartyTeamId : quoted.userTeamId;
          const outgoing = scenario === "counterparty-shortage" ? offer.userIncomingPlayerIds : offer.userOutgoingPlayerIds;
          const incoming = scenario === "counterparty-shortage" ? offer.userOutgoingPlayerIds : offer.userIncomingPlayerIds;
          const healthy = new Set([...outgoing, ...quoted.teams[teamId].playerIds.filter((id) => !outgoing.includes(id)).slice(0, 4)]);
          for (const id of quoted.teams[teamId].playerIds) quoted.players[id].available = healthy.has(id);
          for (const id of incoming) {
            if (scenario === "injured-incoming") quoted.players[id].injury = { injuryId: "qa-injury", severity: "LONG", gamesRemaining: 20, occurredSeasonId: quoted.league.seasonId, occurredGameId: "qa", previousRotationRole: "BENCH" };
            else quoted.players[id].available = false;
          }
        }
        if (scenario === "repair-roster" || scenario === "picks-only") quoted.teams[quoted.userTeamId].playerIds.forEach((id, index) => { quoted.players[id].available = index < 4; });
        if (scenario === "picks-only") {
          const outgoing = Object.values(quoted.draftPicks).find((pick) => pick.ownerTeamId === quoted.userTeamId && pick.round === 2 && pick.year > quoted.league.seasonYear);
          const incoming = Object.values(quoted.draftPicks).find((pick) => pick.ownerTeamId === "CHA" && pick.round === 2 && pick.year === outgoing.year);
          offer = { offerId: "qa-picks", inquiryKey: "qa-picks", inquiryCount: 0, counterpartyTeamId: "CHA", status: "AVAILABLE", userOutgoingPlayerIds: [], userIncomingPlayerIds: [], userOutgoingPickIds: [outgoing.id], userIncomingPickIds: [incoming.id] };
          quoted.tradeDesk = { inquiryMode: "ASSET", selectedPlayerIds: [], selectedPickIds: [outgoing.id], offers: [offer] };
        }
        if (scenario === "missing-team") offer.counterpartyTeamId = "MISSING_TEAM";
        if (scenario === "incomplete-assets") Reflect.deleteProperty(offer, "userIncomingPickIds");
        const evaluation = evaluateTradeOffer(quoted, offer.offerId);
        const index = quoted.tradeDesk.offers.indexOf(offer);
        const healthyBefore = quoted.teams[quoted.userTeamId].playerIds.filter((id) => quoted.players[id].available && !quoted.players[id].injury).length;
        const container = document.createElement("div");
        container.id = "qa-root";
        document.body.replaceChildren(container);
        createRoot(container).render(React.createElement(App, { initialState: quoted }));
        return { index, legal: evaluation.legal, reason: evaluation.reason, healthyBefore, offerId: offer.offerId, targetMode: quoted.tradeDesk.inquiryMode === "TARGET" };
      }, scenario);
      await page.getByRole("button", { name: /交易球员或选秀权/ }).click();
      if (setup.targetMode) await page.getByRole("button", { name: "搜索目标球员", exact: true }).click();
      if (scenario === "incomplete-assets") {
        await page.getByRole("alert").filter({ hasText: "部分交易方案数据不完整" }).waitFor();
      } else {
        await page.locator(".trade-console-offer-card").nth(setup.index).click();
        await page.getByRole("dialog", { name: "交易方案详情", exact: true }).waitFor();
        assert.equal(await page.getByTestId("trade-accept").isEnabled(), setup.legal);
        if (setup.reason) assert.ok((await page.locator(".trade-detail-screen").innerText()).includes(setup.reason));
        if (["repair-roster", "picks-only"].includes(scenario)) assert.ok((await page.locator(".trade-detail-screen").innerText()).includes("无法生成可靠的轮换预览"));
      }
      await page.screenshot({ path: resolve(output, `${scenario}-${width}.png`), fullPage: true });
      let committed = null;
      if (["normal", "repair-roster", "picks-only"].includes(scenario)) {
        await page.getByTestId("trade-accept").click();
        await page.getByRole("dialog", { name: "交易方案详情", exact: true }).waitFor({ state: "detached" });
        committed = await page.evaluate(async (offerId) => {
          const { SaveService } = await import("/src/storage/SaveService.ts");
          const { createBrowserPlatform } = await import("/src/platform/PlatformAdapter.ts");
          const state = await new SaveService(createBrowserPlatform().storage).load(1);
          return { status: state.tradeDesk.offers.find((offer) => offer.offerId === offerId)?.status, healthy: state.teams[state.userTeamId].playerIds.filter((id) => state.players[id].available && !state.players[id].injury).length };
        }, setup.offerId);
        assert.equal(committed.status, "ACCEPTED");
        if (scenario === "repair-roster") assert.equal(committed.healthy, 5);
        if (scenario === "picks-only") assert.equal(committed.healthy, 4);
      }
      assert.ok(await page.locator("#qa-root").innerText());
      assert.deepEqual(errors, []);
      results.push({ scenario, width, setup, committed, errors });
      console.log(JSON.stringify(results.at(-1)));
      await context.close();
    }
  }

  // Inject one deliberate render error into the real entry point, then recover
  // from a leaderboard-return URL without changing the saved slot.
  const context = await browser.newContext({ viewport: { width: 393, height: 852 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.route("**/src/app/TradeOfferDetail.tsx*", (route) => route.fulfill({ contentType: "text/javascript", body: 'export function TradeOfferDetail() { throw new Error("QA_RENDER_FAILURE"); }' }));
  await page.goto(`${base}/app.html`);
  await page.evaluate(async () => {
    const { createCareer } = await import("/src/game/season/career.ts");
    const { generateTradeOffers } = await import("/src/game/trade/TradeService.ts");
    const { SaveService } = await import("/src/storage/SaveService.ts");
    const { createBrowserPlatform } = await import("/src/platform/PlatformAdapter.ts");
    const state = createCareer("qa-render-recovery");
    state.league.currentPhase = "OFFSEASON_PRE_DRAFT";
    state.league.seasonYear = 2027;
    state.league.seasonId = "2027-28";
    await new SaveService(createBrowserPlatform().storage).save(1, generateTradeOffers(state, state.teams[state.userTeamId].playerIds[5], false));
  });
  await page.goto(`${base}/app.html?careerSlot=1`);
  await page.getByRole("button", { name: /交易球员或选秀权/ }).click();
  const savedBefore = await page.evaluate(async () => {
    const { createBrowserPlatform } = await import("/src/platform/PlatformAdapter.ts");
    return createBrowserPlatform().storage.get("basketball-manager:career:1");
  });
  await page.locator(".trade-console-offer-card").first().click();
  await page.getByRole("heading", { name: "页面显示出现异常" }).waitFor();
  await page.screenshot({ path: resolve(output, "render-error-recovery.png"), fullPage: true });
  await page.getByRole("button", { name: "返回首页", exact: true }).click();
  await page.getByRole("button", { name: /开始新游戏/ }).waitFor();
  assert.ok(!new URL(page.url()).searchParams.has("careerSlot"));
  const savedAfter = await page.evaluate(async () => {
    const { createBrowserPlatform } = await import("/src/platform/PlatformAdapter.ts");
    return createBrowserPlatform().storage.get("basketball-manager:career:1");
  });
  assert.equal(savedAfter, savedBefore);
  assert.ok(errors.some((error) => error.includes("[GameErrorBoundary]") && error.includes("QA_RENDER_FAILURE")));
  assert.ok(errors.every((error) => error.includes("QA_RENDER_FAILURE")));
  results.push({ scenario: "root-render-recovery", returnedHome: true, slotUnchanged: true, expectedErrors: errors });
  await context.close();
  await writeFile(resolve(output, "browser-results.json"), JSON.stringify({ passed: true, results }, null, 2));
} finally {
  await browser.close();
}
