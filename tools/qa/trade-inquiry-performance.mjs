import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.QA_BASE_URL || "http://127.0.0.1:5184";
const output = resolve(process.env.QA_OUTPUT || "reports/qa/2026-10-02/trade-inquiry-performance");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const cpuRate of process.argv.includes("--before-only") ? [1] : [1, 6]) {
    const context = await browser.newContext({ viewport: { width: 393, height: 852 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto(`${base}/app.html`);
    await page.evaluate(async () => {
      const { createCareer } = await import("/src/game/season/career.ts");
      const { generateTradeOffers } = await import("/src/game/trade/TradeService.ts");
      const { stableHash, stableSerialize } = await import("/src/game/random/hash.ts");
      const state = createCareer("trade-extra-audit");
      state.league.currentPhase = "OFFSEASON_PRE_DRAFT";
      state.league.seasonYear = 2027;
      state.league.seasonId = "2027-28";
      const selection = { playerIds: state.teams[state.userTeamId].playerIds.slice(5, 11), pickIds: [] };
      window.qaTrade = { state, selection, generateTradeOffers, hash: (quoted) => stableHash(stableSerialize({ tradeDesk: quoted.tradeDesk, tradeInquiryCount: quoted.tradeInquiryCount })) };
    });
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuRate });
    const samples = [];
    for (let run = 0; run < (process.argv.includes("--before-only") ? 1 : 3); run += 1) {
      samples.push(await page.evaluate(() => new Promise((resolve) => {
        const { state, selection, generateTradeOffers, hash } = window.qaTrade;
        const started = performance.now();
        let generated;
        setTimeout(() => resolve({ computeMs: generated.computeMs, timerDelayMs: performance.now() - started, resultHash: generated.resultHash, offers: generated.offers }), 0);
        const quoted = generateTradeOffers(state, selection, false);
        generated = { computeMs: performance.now() - started, resultHash: hash(quoted), offers: quoted.tradeDesk.offers.length };
      })));
    }
    for (const sample of samples) {
      assert.equal(sample.resultHash, "9850a20f57e17404");
      assert.equal(sample.offers, 3);
    }
    let interaction = null;
    if (!process.argv.includes("--before-only")) {
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
      await page.evaluate(async () => {
        const reactModule = await import("/node_modules/.vite/deps/react.js");
        const React = reactModule.default ?? reactModule;
        const clientModule = await import("/node_modules/.vite/deps/react-dom_client.js");
        const { createRoot } = clientModule.default ?? clientModule;
        const { default: App } = await import("/src/app/App.tsx");
        const { state, selection } = window.qaTrade;
        state.tradeDesk = { inquiryMode: "ASSET", selectedPlayerId: selection.playerIds[0], selectedPlayerIds: selection.playerIds, selectedPickIds: [], offers: [] };
        const container = document.createElement("div");
        container.id = "qa-root";
        document.body.replaceChildren(container);
        createRoot(container).render(React.createElement(App, { initialState: state }));
      });
      await page.getByRole("button", { name: /交易球员或选秀权/ }).click();
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuRate });
      const started = performance.now();
      await page.getByRole("button", { name: "获取报价", exact: true }).click();
      await page.locator(".trade-console-offer-card").nth(2).waitFor({ timeout: 30000 });
      const quoteVisibleMs = performance.now() - started;
      await page.screenshot({ path: resolve(output, `six-assets-cpu-${cpuRate}.png`), fullPage: true });
      await page.locator(".trade-console-offer-card").first().click();
      await page.getByRole("dialog", { name: "交易方案详情", exact: true }).waitFor();
      assert.equal(await page.getByTestId("trade-accept").isEnabled(), true);
      await page.getByTestId("trade-accept").click();
      await page.getByRole("dialog", { name: "交易方案详情", exact: true }).waitFor({ state: "detached" });
      const committed = await page.evaluate(async () => {
        const { SaveService } = await import("/src/storage/SaveService.ts");
        const { createBrowserPlatform } = await import("/src/platform/PlatformAdapter.ts");
        const saved = await new SaveService(createBrowserPlatform().storage).load(1);
        return { accepted: saved.tradeDesk.offers.filter((offer) => offer.status === "ACCEPTED").length, healthy: saved.teams[saved.userTeamId].playerIds.filter((id) => saved.players[id].available && !saved.players[id].injury).length };
      });
      assert.equal(committed.accepted, 1);
      assert.ok(committed.healthy >= 5);
      assert.ok(await page.locator("#qa-root").innerText());
      interaction = { quoteVisibleMs, committed };
    }
    assert.deepEqual(errors, []);
    results.push({ cpuRate, samples, interaction, errors });
    console.log(JSON.stringify(results.at(-1)));
    await context.close();
  }
  await writeFile(resolve(output, "results.json"), JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
