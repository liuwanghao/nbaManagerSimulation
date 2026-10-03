# 年度切换保存卡点排查（2026-10-02）

## 结论与证据边界

反馈定位到 `保存新赛季存档`，即 `App.runContractCommand → persistState → SaveService.save`。年度计算已返回，但 UI 要等持久化完成才更新赛季，因此反馈仍显示 `2028-29 / OFFSEASON`。

已复现并修复三个恢复缺陷：存档 Worker 静默丢失回包会永久等待；IndexedDB 打开或事务静默时也会永久等待；数据库被强制关闭后会反复复用失效连接。修复前的故障注入回归失败，修复后可恢复或明确拒绝，并允许后续保存继续执行。

没有收到玩家原始存档、客户端版本或设备日志。这里的复现存档是固定种子生成的三季测试生涯，不能认定这批反馈全部由上述缺陷触发。当前平台使用 IndexedDB/localStorage，Colorbox 分片存储未接入该调用链。

`transitionSlow` 在年度切换累计超过 12 秒时触发，并非对“保存新赛季存档”单独计时。该提示本身不表示保存已经失败，也不能证明存在无限循环。

## 修复范围

先加故障回归，再修存储等待；保留现有哈希、压缩格式、原子保存和旧存档迁移规则，不改年度合同、成长、退役或历史归档规则，不增加依赖。

- `src/storage/SaveCodec.ts`：统一管理所有 Worker 请求的 10 秒响应期限。失联时终止 Worker，释放全部等待者，用现有本地实现重算；分块压缩也受保护。修复 DataCloneError 发生时其它请求留在队列中的问题。
- `src/platform/storage/StorageAdapter.ts`：按需打开 IndexedDB；blocked 明确拒绝；打开和事务分别设置 10 秒期限；事务超时先 abort 再拒绝。失败连接允许重开，迟到连接关闭，versionchange/close/InvalidStateError 使旧连接失效。本次失败不自动重放写操作。
- `src/storage/SaveCodec.test.ts`、`src/platform/storage/StorageAdapter.test.ts`：覆盖静默、错误、并发、分块压缩、迟到响应、连接关闭、重试、原数据保留和年度保存队列释放。
- `tools/headless/create-rollover-repro.ts`、`tools/qa/season-rollover-regression.mjs`：生成可复用的测试存档，并在全新 Chromium 环境和单独数据库中验证完整保存链。

统一 Worker 故障处理替代了分散的终止代码，存档格式无需迁移。Worker 回退可能短暂占用主线程；10 秒是单个等待的期限，不保证整个年度切换一定小于 12 秒。所有测试使用独立存储，未读取、清空或覆盖用户浏览器存档。

## 保留的复现材料

默认目录：`reports/rollover-2026-10-02/`（本地 QA 产物，不提交存档正文）。生成器使用独占写入，已有复现文件不会被覆盖。

- `before-rollover.save.json`：2028-29 OFFSEASON，槽位 1，664 名球员、3 季历史；4,426,269 字节。
- `expected-after-rollover.state.json`：2029-30 OPTION_PHASE 的预期结果。
- `reproduction.json`：种子、大小与哈希。
- `browser-results.json`：浏览器耗时与故障恢复结果。

固定种子：`rollover-2028-29-reproduction`。切换前状态哈希 `b1367b8d894a8e1b`；预期切换后状态哈希 `6859e5f386389836`。

重新生成到新的目录：

```sh
node --import tsx tools/headless/create-rollover-repro.ts --output reports/rollover-new-run
```

在开发服务器运行时执行浏览器验证（Playwright 使用已有环境包）：

```sh
QA_BASE_URL=http://127.0.0.1:5184 QA_OUTPUT=reports/rollover-new-run \
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tools/qa/season-rollover-regression.mjs
```

## 实测结果

本机 Chromium 的第二轮独立测试，非手机真机数据；测量包含检查点、年度计算、新档保存，不包含 UI 动画及页面首次加载。

| 场景 | 检查点 | 年度计算 | 新档保存 | 总计 |
| --- | ---: | ---: | ---: | ---: |
| 正常 CPU | 603 ms | 191 ms | 1,383 ms | 2,176 ms |
| 6 倍 CPU 降速 | 1,162 ms | 1,418 ms | 2,249 ms | 4,830 ms |

新档、切换前检查点、前版备份与预期哈希一致，重载进入 2029-30 OPTION_PHASE；两个正常场景无页面错误。首次测试总耗时分别为 2,182 / 4,338 ms，说明运行间存在正常波动，不作为本次优化的 Before/After 对比。

实际浏览器将 Worker 替换为永不回复的实现：等待期间主档原文不变，约 11,032 ms 完成超时回退和两次保存；Worker 终止一次，最终哈希正确，后续 revision 为 3，pending 清理完成。

## 验证

- Worker / IndexedDB 定向回归：25 项通过。
- 保存、年度合同、季后赛调用链回归：95 项通过（补充连接关闭回归前）。
- TypeScript、生产构建和差异静态检查通过；项目未配置独立 lint 命令。
- 最终全量 Vitest：110 个文件 / 864 项全部通过。

仍需玩家原档及 iOS/Android 真机日志来确认线上反馈的具体触发条件；当前没有上传存档正文或调用线上反馈接口。
