import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { resolve } from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.QA_BASE_URL || 'http://127.0.0.1:5175';
const output = resolve(process.env.QA_OUTPUT || 'reports/qa/2026-09-30/fix-validation');
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 393, height: 852 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
const results = [];
const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
async function capture(name) {
  await page.screenshot({ path: resolve(output, `${name}.png`), fullPage: true });
  results.push({ name, state: await state(), text: await page.locator('body').innerText() });
}
async function drawer(tab = 'save') {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: /存\/读档/ }).click();
  if (tab === 'load') await page.getByRole('button', { name: '读取存档', exact: true }).click();
}
async function moduleAction(action) {
  return page.evaluate(async action => {
    const { SaveService } = await import('/src/storage/SaveService.ts');
    const { createBrowserPlatform } = await import('/src/platform/PlatformAdapter.ts');
    const storage = createBrowserPlatform().storage;
    const saves = new SaveService(storage);
    if (action === 'live-baseline') {
      const live = await saves.load(1);
      live.meta.dataVersion = 'hupu.nba.live-roster.test';
      await saves.save(1, live);
    } else if (action === 'incompatible') {
      const old = await saves.load(1);
      old.meta.dataVersion = 'legacy-fictional';
      await saves.save(2, old);
    } else if (action === 'corrupted' || action === 'corrupt-third') {
      const slot = action === 'corrupt-third' ? 3 : 2;
      await storage.set(`basketball-manager:career:${slot}`, 'broken-json');
      for (const suffix of [':pending', ':previous-valid']) await storage.remove(`basketball-manager:career:${slot}${suffix}`);
    } else if (action === 'unavailable') {
      window.qaOriginalLoad = SaveService.prototype.load;
      SaveService.prototype.load = function(slot) { return slot === 2 ? Promise.reject(new Error('读取存储失败，请重试。')) : window.qaOriginalLoad.call(this, slot); };
    } else if (action === 'fail-save') {
      window.qaOriginalSave = SaveService.prototype.save;
      SaveService.prototype.save = function(slot, ...args) { return slot === 2 ? Promise.reject(new DOMException('Storage full', 'QuotaExceededError')) : window.qaOriginalSave.call(this, slot, ...args); };
    } else if (action === 'restore-load') SaveService.prototype.load = window.qaOriginalLoad;
    else if (action === 'restore-save') SaveService.prototype.save = window.qaOriginalSave;
    else if (action === 'clear-second') {
      for (const suffix of ['', ':pending', ':previous-valid']) await storage.remove(`basketball-manager:career:2${suffix}`);
    }
    else if (action === 'summaries') return await saves.listSlotSummaries();
  }, action);
}
try {
  await page.goto(`${base}/app.html?fixture=game`);
  await page.waitForFunction(() => window.render_game_to_text?.().includes('season-dashboard'));
  await drawer();
  await page.getByRole('button', { name: '覆盖保存', exact: true }).click();
  await page.getByRole('dialog', { name: '存档管理' }).waitFor({ state: 'hidden' });
  await moduleAction('live-baseline');
  await page.goto(`${base}/app.html`);
  await page.getByRole('button', { name: '继续上次进度', exact: true }).click();
  await page.waitForFunction(() => window.render_game_to_text?.().includes('season-dashboard'));
  for (const failure of ['empty', 'incompatible', 'corrupted', 'unavailable']) {
    console.log(`Checking failed load: ${failure}`);
    if (failure !== 'empty') await moduleAction(failure);
    const before = await state();
    await drawer('load');
    await page.getByRole('button', { name: /^(读取此存档|重试读取)$/ }).nth(1).click();
    await page.locator('.save-drawer-load-error').waitFor();
    assert.equal((await state()).activeSaveSlot, 1, failure);
    assert.equal((await state()).dateIndex, before.dateIndex, failure);
    await capture(`load-${failure}`);
    if (failure === 'unavailable') await moduleAction('restore-load');
    await page.getByRole('button', { name: '关闭存档管理' }).click();
  }
  const beforeGame = await state();
  await page.getByRole('button', { name: '模拟下一场比赛', exact: true }).click();
  await page.waitForFunction(date => {
    const current = JSON.parse(window.render_game_to_text());
    return current.dateIndex > date && current.fiveGameAnimation === null;
  }, beforeGame.dateIndex, { timeout: 60000 });
  assert.equal((await state()).activeSaveSlot, 1);
  const summaries = await moduleAction('summaries');
  assert.equal(summaries.find(slot => slot.slotId === 2).status, 'CORRUPTED');
  await moduleAction('clear-second');
  await drawer('load');
  await page.getByRole('button', { name: /^(读取此存档|重试读取)$/ }).nth(1).click();
  await page.locator('.save-drawer-load-error').waitFor();
  await page.getByRole('button', { name: '保存游戏', exact: true }).click();
  await moduleAction('fail-save');
  await page.getByRole('button', { name: '存入此位置', exact: true }).first().click();
  await page.locator('.save-drawer-load-error').waitFor();
  assert.equal((await state()).activeSaveSlot, 1);
  assert.match(await page.locator('.save-drawer-load-error').innerText(), /存储空间不足/);
  await capture('save-failed');
  await moduleAction('restore-save');
  await page.getByRole('button', { name: '存入此位置', exact: true }).first().click();
  await page.getByRole('dialog', { name: '存档管理' }).waitFor({ state: 'hidden' });
  assert.equal((await state()).activeSaveSlot, 2);
  await moduleAction('corrupt-third');
  await page.getByRole('button', { name: '返回游戏首页' }).click();
  await page.getByRole('button', { name: '读取存档', exact: true }).click();
  await page.getByRole('dialog', { name: '读取存档' }).waitFor();
  assert.equal(await page.getByRole('button', { name: '读取并继续' }).count(), 2);
  assert.equal(await page.getByRole('button', { name: '重试读取' }).count(), 1);
  await page.screenshot({ path: resolve(output, 'launcher-corrupt-menu.png'), fullPage: true });
  await page.getByRole('button', { name: '关闭读取存档' }).click();
  await page.getByRole('button', { name: '开始新游戏', exact: true }).click();
  await page.getByRole('button', { name: '重建并开始' }).click();
  assert.match(await page.locator('.home-load-warning').innerText(), /原有进度将被覆盖/);
  await page.screenshot({ path: resolve(output, 'launcher-rebuild-confirm.png'), fullPage: true });
  await page.getByRole('button', { name: '确认重建', exact: true }).click();
  await page.getByRole('dialog', { name: '选择新生涯槽位' }).waitFor({ state: 'hidden' });
  assert.equal((await moduleAction('summaries')).find(slot => slot.slotId === 3).status, undefined);
  results.push({ name: 'launcher-corrupt-isolation-and-rebuild', passed: true });

  await page.goto(`${base}/app.html?fixture=preseason`);
  await page.waitForFunction(() => window.render_game_to_text?.().includes('PRESEASON'));
  const triggers = await page.locator('[data-testid^="preseason-focus-"]:not([disabled])').evaluateAll(list => list.map(button => button.dataset.testid));
  let selected;
  for (const id of triggers) {
    await page.getByTestId(id).click();
    if (await page.getByRole('menuitemradio').filter({ hasText: '投射' }).isEnabled()) { selected = id; break; }
    await page.keyboard.press('Escape');
  }
  assert.ok(selected, 'must have an eligible training player');
  for (const [index, focus] of ['投射', '防守', '投射', '不指定', '投射'].entries()) {
    await page.getByRole('menuitemradio').filter({ hasText: focus }).click();
    await page.getByRole('menu').waitFor({ state: 'hidden' });
    await page.waitForFunction(id => !document.querySelector(`[data-testid="${id}"]`)?.disabled, selected);
    assert.match(await page.getByTestId(selected).innerText(), new RegExp(focus));
    await capture(`training-${index + 1}`);
    if (index < 4) await page.getByTestId(selected).click();
  }
  await page.goto(`${base}/app.html`);
  await page.getByRole('button', { name: '继续上次进度', exact: true }).click();
  await page.getByTestId(selected).waitFor();
  for (const focus of ['防守', '投射']) {
    await page.getByTestId(selected).click();
    await page.getByRole('menuitemradio').filter({ hasText: focus }).click();
    await page.getByRole('menu').waitFor({ state: 'hidden' });
    await page.waitForFunction(id => !document.querySelector(`[data-testid="${id}"]`)?.disabled, selected);
    assert.match(await page.getByTestId(selected).innerText(), new RegExp(focus));
    await capture(`training-reloaded-${focus}`);
  }
  assert.deepEqual(errors, []);
  await fs.writeFile(resolve(output, 'results.json'), JSON.stringify({ passed: true, errors, results }, null, 2));
  console.log(JSON.stringify({ passed: true, scenarios: results.map(result => result.name), output }));
} finally { await browser.close(); }
