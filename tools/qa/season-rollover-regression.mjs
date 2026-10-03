import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.QA_BASE_URL || "http://127.0.0.1:5184";
const output = resolve(process.env.QA_OUTPUT || "reports/rollover-2026-10-02");
const before = JSON.parse(await readFile(resolve(output, "before-rollover.save.json"), "utf8"));
const reproduction = JSON.parse(await readFile(resolve(output, "reproduction.json"), "utf8"));
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const rate of [1, 6]) {
    // Fresh contexts and a separate database keep all existing saves untouched.
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.goto(`${base}/app.html`);
    await page.evaluate(async (state) => {
      const { SaveService } = await import("/src/storage/SaveService.ts");
      const { IndexedDbStorageAdapter } = await import("/src/platform/storage/StorageAdapter.ts");
      const service = new SaveService(new IndexedDbStorageAdapter("qa-rollover-isolated"));
      await service.save(1, state);
    }, before.state);
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate });
    const result = await page.evaluate(async (state) => {
      const { SaveService } = await import("/src/storage/SaveService.ts");
      const { IndexedDbStorageAdapter } = await import("/src/platform/storage/StorageAdapter.ts");
      const { executeContractLifecycleCommand } = await import("/src/game/contracts/ContractLifecycleService.ts");
      const { hashSaveState } = await import("/src/storage/SaveCodec.ts");
      const adapter = new IndexedDbStorageAdapter("qa-rollover-isolated");
      const service = new SaveService(adapter);
      const started = performance.now();
      await service.saveCheckpoint(1, "pre-rollover-2028-29", state);
      const checkpointMs = performance.now() - started;
      const calculationStarted = performance.now();
      const next = executeContractLifecycleCommand(state, {
        commandId: "rollover-2028-29", type: "ROLLOVER_LEAGUE_YEAR", payload: {},
      });
      const calculationMs = performance.now() - calculationStarted;
      const saveStarted = performance.now();
      const saved = await service.save(1, next);
      const saveMs = performance.now() - saveStarted;
      const totalMs = performance.now() - started;
      const checkpoint = await service.loadCheckpoint(1, "pre-rollover-2028-29");
      const checkpointEnvelope = JSON.parse(await adapter.get("basketball-manager:career:1:checkpoint:pre-rollover-2028-29"));
      const previous = JSON.parse(await adapter.get("basketball-manager:career:1:previous-valid"));
      const loaded = await service.load(1);
      return {
        checkpointMs, calculationMs, saveMs, totalMs,
        savedHash: saved.stateHash, checkpointHash: await hashSaveState(checkpointEnvelope.state),
        checkpointStoredHash: checkpointEnvelope.stateHash,
        previousHash: await hashSaveState(previous.state),
        checkpointSeason: checkpoint.league.seasonId, loadedSeason: loaded.league.seasonId,
        loadedPhase: loaded.league.currentPhase,
      };
    }, before.state);
    assert.equal(result.savedHash, reproduction.nextStateHash);
    assert.equal(result.checkpointHash, before.stateHash);
    assert.equal(result.checkpointStoredHash, before.stateHash);
    assert.equal(result.previousHash, before.stateHash);
    assert.equal(result.checkpointSeason, "2028-29");
    assert.equal(result.loadedSeason, "2029-30");
    assert.equal(result.loadedPhase, "OPTION_PHASE");
    assert.deepEqual(errors, []);
    results.push({ cpuThrottle: rate, ...result, errors });
    console.log(JSON.stringify(results.at(-1)));
    await context.close();
  }
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${base}/app.html`);
  const recovery = await page.evaluate(async ({ envelope, expectedHash }) => {
    let terminated = 0;
    window.Worker = class {
      postMessage() {}
      terminate() { terminated += 1; }
    };
    const { SaveService } = await import("/src/storage/SaveService.ts");
    const { MemoryStorageAdapter } = await import("/src/platform/storage/StorageAdapter.ts");
    const { executeContractLifecycleCommand } = await import("/src/game/contracts/ContractLifecycleService.ts");
    const adapter = new MemoryStorageAdapter();
    const key = "basketball-manager:career:1";
    const original = JSON.stringify(envelope);
    await adapter.set(key, original);
    const service = new SaveService(adapter);
    const next = executeContractLifecycleCommand(envelope.state, {
      commandId: "rollover-2028-29", type: "ROLLOVER_LEAGUE_YEAR", payload: {},
    });
    const started = performance.now();
    const saving = service.save(1, next);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const preservedWhileWaiting = await adapter.get(key) === original;
    const saved = await saving;
    const laterSave = await service.save(1, next);
    return {
      scenario: "silent-worker", elapsedMs: performance.now() - started,
      preservedWhileWaiting, terminated, savedHash: saved.stateHash,
      correctHash: saved.stateHash === expectedHash, retryRevision: laterSave.revision,
      pendingRemoved: await adapter.get(`${key}:pending`) === null,
    };
  }, { envelope: before, expectedHash: reproduction.nextStateHash });
  assert.equal(recovery.preservedWhileWaiting, true);
  assert.equal(recovery.terminated, 1);
  assert.equal(recovery.correctHash, true);
  assert.equal(recovery.retryRevision, 3);
  assert.equal(recovery.pendingRemoved, true);
  results.push(recovery);
  console.log(JSON.stringify(recovery));
  await context.close();
  await writeFile(resolve(output, "browser-results.json"), JSON.stringify({ passed: true, results }, null, 2));
} finally { await browser.close(); }
