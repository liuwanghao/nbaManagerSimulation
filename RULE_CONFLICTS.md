# 当前规则冲突

本清单只记录同一项目的界面与引擎、或不同业务路径之间可指认的分歧。它不指定哪一方是产品需求，也不把旧文档当作裁决依据。核查基于 2026-09-28 工作区源码；运行结果须在正式测试中另行验证。

## CONFLICT-001：RFA 匹配期限是否真的到期

- **规则：** 原球队收到 RFA 报价单后的匹配决定期限。
- **涉及文件：** `src/app/Stage4Flow.tsx:679,732`；`src/game/freeAgency/FreeAgencyService.ts:555-564,608-613,666-675`。
- **实现 A：** 界面显示“第 N 天截止”；引擎也写入 `matchingDeadline = currentDay + 1` 和待决定项的 `deadline`。
- **实现 B：** 引擎处理用户决定时不检查 `deadline`；待决定项存在时，市场每日结算被拒绝，界面结算和结束市场按钮均禁用。按当前入口，用户可在任意实际耗时后决定，游戏中的市场天数也不会越过截止日。
- **可能影响：** 期限提示的含义、超时默认匹配或放弃、RFA 状态机与存档恢复后的处理。
- **建议核实：** “截止”是仅供提示的阶段门禁，还是需要可推进的倒计时和超时决策？确认前按现有可执行路径做状态测试，不据此判 BUG。

## CONFLICT-002：赛季中自由球员报价的结算时点

- **规则：** 赛季中 UFA 报价何时结算。
- **涉及文件：** `src/app/RegularSeasonFreeAgents.tsx:68`；`src/game/season/career.ts:188-222,230-245`。
- **实现 A：** 市场页写“下一比赛日结算”。
- **实现 B：** `simulateNextGameDay` 从当前日期逐日调用 `simulateLeagueDay`，后者每一天（包括玩家无比赛的休息日）都调用 `advanceFreeAgencyDay`。因此报价可能在下一场玩家比赛之前的休息日结算。
- **可能影响：** 报价撤回窗口、球员入队日期、用户对跨日模拟提示的理解。
- **建议核实：** 产品所称“比赛日”指下一场玩家比赛、下一次联盟比赛，还是下一次日历推进？分别用有多个休息日的赛程测试真实表现。

## CONFLICT-003：同队续签或匹配后的 Bird 年限连续性

- **规则：** 原球队续签（包括匹配 RFA 报价）是否延续已累积的 Bird 年限。
- **涉及文件：** `src/game/contracts/ContractLifecycleService.ts:111-119`；`src/game/trade/TradeService.ts:146-147`；`src/game/freeAgency/FreeAgencyService.ts:303-317,555-571,666-674`；`src/app/Stage4Flow.tsx:424`。
- **实现 A：** 合同年度结算在 `birdTeamId === teamId` 时累加 `birdYears`；交易仅改 `birdTeamId`，保留 `birdYears`；界面说明未提交资质报价时已有 Bird Rights 仍保留。
- **实现 B：** 所有自由市场签约均执行 `birdYears = 1`，包括球员留在原队、原队匹配报价单的路径。
- **可能影响：** 再次到期时是否生成 Bird UFA Cap Hold、原队续约年限与涨幅规则，以及多年生涯中权利状态。
- **建议核实：** 同队续签和 RFA 匹配后是否应保留连续年限；另确认交易后的连续年限规则。决定前不自动改动。

## CONFLICT-004：未来赛季乐透结果确认是否为选秀硬门禁

- **规则：** 2027 年起的选秀，应否先确认乐透揭晓才能提交第一笔选秀选择。
- **涉及文件：** `src/app/Stage4Flow.tsx:113-117`；`src/app/DraftLotteryScreen.tsx:58-60`；`src/game/draft/DraftService.ts:661,674-681,702-754,783-815`；`docs/DRAFT_LOTTERY.md:9-11`。
- **实现 A：** 当 `lotteryPresented=false` 且选秀游标为 0 时，界面只显示乐透页；“进入选秀大厅”按钮在揭晓完成后提交 `ACKNOWLEDGE_DRAFT_LOTTERY`。
- **实现 B：** `advanceRookieDraftAiPick`、`fastForwardRookieDraft`、`draftPlayer` 和 `validateRookieDraftState` 均未检查 `lotteryPresented`。直接调用选秀指令可在未确认乐透时提交顺位。
- **复现证据：** 以 `createCareer("lottery-gate-probe")` 构造 2027 年 `OFFSEASON_PRE_DRAFT` 状态，调用 `prepareRookieDraft` 后标记为 `false`、游标为 0；直接执行第一签的 `ADVANCE_ROOKIE_DRAFT_AI_PICK`，游标变成 1，标记仍为 `false`（2026-09-28，本地 `node --import tsx`）。
- **可能影响：** 脚本、旧存档恢复、未来其他调用入口绕开乐透确认；确认指令此后又要求游标为 0，可能无法补确认。
- **建议核实：** 确认乐透是剧情展示还是引擎状态门禁。正式测试应分别检查 UI 和服务入口；确认前不自动修改。

## CONFLICT-005：开发夹具 URL 在静态包中的启动页面

- **规则：** `?fixture=<mode>` 链接是否只在开发模式改变启动流程。
- **涉及文件：** `src/app/Bootstrap.tsx:27,70-75,170-194`；`h5/assets/game.js`（已构建静态包）。
- **实现 A：** `createFixturePreview` 的场景夹具均受 `import.meta.env.DEV` 保护；生产构建里的对应分支被移除，静态包仍按默认状态创建游戏。
- **实现 B：** `qaFixture = fixtureMode() !== null` 不受 DEV 保护；生产静态包中仍可查到 `new URLSearchParams(...).get("fixture")` 与“有参数即进入 game”的分支。因此同一 `?fixture=free-agency` 链接在开发服务打开自由市场，在 H5 包中直接跳过首页进入默认开档。
- **可能影响：** 分享或误带测试参数的生产链接、H5 验收路径、首页存档入口。
- **建议核实：** 生产环境是否应忽略 `fixture` 参数；若是，应将启动页分支也限制在 DEV。静态包与源码在此启动分支上一致，尚无“此处静态包落后于源码”的证据。
