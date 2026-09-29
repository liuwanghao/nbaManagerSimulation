# INVARIANTS — 跨模块可判定不变量

基线日期：2026-09-28。这里列的是状态一致性和守恒约束，不用“代码恰好这样写”来证明产品规则正确。每条给出自动化落点；`已运行`仅表示本次已执行，完整套件结果另见 `TEST_MATRIX.md`。如果未来发现不变量本身存在合法例外，应先在 `UNKNOWN_RULES.md` 记录并限定适用阶段，再调整测试。

| ID | 不变量及适用范围 | 自动化测试 |
| --- | --- | --- |
| INV-001 | 每队名单 `playerIds` 无重复；同一球员不能同时在两队名单。 | `src/game/state/invariants.test.ts`（已运行）；`src/game/expansion/ExpansionService.test.ts` |
| INV-002 | 名单内球员必须存在，且其 `teamId` 指向该队；若 `teamId` 指向正常球队，必须恰好在该队名单。 | `src/game/state/invariants.test.ts`（已运行） |
| INV-003 | `RETIRED` 球员不能留在任何正常球队名单。 | `src/game/state/invariants.test.ts`（已运行）；`src/game/development/PlayerDevelopmentService.test.ts` |
| INV-004 | 球员年龄、合同薪资及帽表每个金额必须是有限数；薪资不得为负。 | `src/game/state/invariants.test.ts`（已运行） |
| INV-005 | 帽表总额等于现役薪资、死钱、cap hold、有效报价预留、空位占位及当季最低工资差额之和；帽下空间等于当季工资帽减总额。允许负空间。 | `src/game/state/invariants.test.ts`（已运行）；`src/game/cap/CapSheetService.test.ts` |
| INV-006 | 同一赛季赛程 `game.id` 唯一；比赛双方存在且不能相同。 | `src/game/state/invariants.test.ts`（已运行）；`src/game/schedule/schedule.test.ts` |
| INV-007 | `FINAL` 比赛双方得分必须确定、有限且不平；胜队必须是高分队。 | `src/game/state/invariants.test.ts`（已运行）；`src/game/simulation/simulation.test.ts` |
| INV-008 | 一场常规赛只能结算一次；再次请求相同日期不得再添结果或改动战绩。 | `src/game/state/invariants.test.ts`（已运行） |
| INV-009 | 胜负和主客胜负非负且自洽；队伍胜+负不能超过当前赛程中已完成的该队比赛数。 | `src/game/state/invariants.test.ts`（已运行）；`src/game/season/career.test.ts` |
| INV-010 | 同分区比赛也是同联盟比赛，故 division 胜负不能超过 conference 胜负。 | `src/game/state/invariants.test.ts`（已运行） |
| INV-011 | 日期只可通过合法赛季推进，不超过该赛季 finalDateIndex；新建生涯模拟后日期前进。 | `src/game/state/invariants.test.ts`（已运行）；`src/game/season/career.test.ts` |
| INV-012 | 同一场比赛重放相同状态、种子、配置得到相同输出；球队比分等于球员得分之和，各项命中不超过出手。 | `src/game/simulation/simulation.test.ts` |
| INV-013 | 球员出场秒数加总为 14,400 秒，每次加时增加 1,500 秒；每节得分相加等于总分。 | `src/game/simulation/simulation.test.ts` |
| INV-014 | 常规赛轮换五名首发唯一、有效计划目标分钟总计 240；重复首发或重复替补顺序必须被拒绝且输入保持不变。 | `src/game/roster/RotationPlanService.test.ts` |
| INV-015 | 阵容不足时的降级轮换仍不能凭空产生超过限制的个人时间。 | `src/game/simulation/simulation.test.ts`；`src/storage/SaveService.test.ts` |
| INV-016 | 扩军选秀球员与来源球队各不重复；完成后两支扩军队各 14 人，薪资不超过扩军限制。 | `src/game/expansion/ExpansionService.test.ts` |
| INV-017 | 一届新秀选秀顺位号唯一、被选球员唯一；被选者不能仍标记为自由球员；已选球员不能再次进入可选池。 | `src/game/state/invariants.test.ts`（已运行）；`src/game/draft/DraftService.test.ts` |
| INV-018 | 相同选秀命令不能重复消费签位；当前签位、归属与候选状态不符时应拒绝。 | `src/game/draft/DraftService.test.ts` |
| INV-019 | 同赛季只能记录一个总冠军；季后赛一轮仅一个晋级者，四胜后系列赛结束。 | `src/game/state/invariants.test.ts`（冠军唯一）；`src/game/season/career.test.ts`（15 轮逐场计数） |
| INV-020 | 交易不能包含重复球员或签位、不能转移非己资产；同一命令 ID 重试不重复过户。 | `src/game/trade/NBACompliance.test.ts`；`src/game/trade/TradeService.test.ts` |
| INV-021 | 一笔交易同时转移两队球员、签位并保持资产唯一归属；失败不产生半提交。 | `src/game/trade/NBACompliance.test.ts`；`src/game/trade/TradeService.test.ts` |
| INV-021A | AI 球队当前被判定为非卖品的球员不能通过任何交易命令过户；绕过 UI、旧报价重放和 AI 自动交易都须受最终交易校验约束。 | `src/game/trade/TradeAvailabilityService.test.ts`；`src/game/trade/TradeService.test.ts`；`src/game/trade/AITradeService.test.ts` |
| INV-022 | 同一球员同一市场窗口，每队同时最多一份 `ACTIVE` 报价；撤回后可留下历史记录并重新报价。球员不能完成两笔同时生效的签约，失效报价的帽预留必须释放。 | `src/game/freeAgency/FreeAgencyService.test.ts` |
| INV-023 | 自由市场命令重复提交不能重复签约/扣帽；不合法报价不改变原状态。 | `src/game/freeAgency/FreeAgencyService.test.ts` |
| INV-024 | 玩家需决策的事件效果仅执行一次；同一事件选择命令重试不重复影响数值。 | `src/game/events/EventService.test.ts` |
| INV-025 | 存档同版本往返后关键状态与保存前一致；revision 单调增长，损坏存档不能静默当有效档载入。旧版迁移允许有明确记录的字段变化。 | `src/storage/SaveService.test.ts` |
| INV-026 | 同一种子整季赛程、模拟、选秀及成长结果可重放。 | `src/game/schedule/schedule.test.ts`；`src/game/season/career.test.ts`；`src/game/draft/DraftService.test.ts`；`src/game/development/PlayerDevelopmentService.test.ts` |
| INV-027 | 自由球员当前要价必须有限，且不低于当季底薪；同一球员无合格报价天数不能为负，合格报价存在时不增长；要价变化后活跃报价效用与新要价一致，存档恢复后保持。 | `src/game/freeAgency/FreeAgentDemand.test.ts` |

## 测试边界

- `INV-019` 按季后赛两队组合归并系列赛；只对本季季后赛轮次断言，附加赛三场另由赛制测试覆盖。
- `INV-022` 目前由自由市场服务测试覆盖单市场窗口和输家预留；跨多个连续赛季的同球员多次合法签约不在“同时生效”的判定范围内。
- 测试中的 fixture 生涯不等于真实扩军入口；扩军路径和 UI 操作需单列 E2E 证据。
