# 已确认产品规则

2026-09-28，产品方确认了原 `UNKNOWN-001`～`UNKNOWN-007`，并裁决 `CONFLICT-001`～`CONFLICT-005`。本文件记录期望规则；`CURRENT_SPEC.md` 记录代码实况。违反这些规则的结果归类为 `BUG`。

| 编号 | 已确认规则 | 验证入口 |
| --- | --- | --- |
| UNKNOWN-001 | 主自由市场固定 120 天，每天结算一次。第 120 天结算后自动结束。玩家可提前结束，但必须先结算当前日，随后撤回仍为 `ACTIVE` 的报价。若当日产生待处理的 RFA 匹配决定，处理完后再关闭。 | `src/game/freeAgency/FreeAgencyService.test.ts`；`src/game/roster/RosterService.ts` |
| UNKNOWN-002 | `expiresDay` 当天报价仍有效；当日结算后仍未接受的报价在进入次日时转 `EXPIRED`。 | `src/game/freeAgency/FreeAgencyService.test.ts` |
| UNKNOWN-003 | 持有 Bird Rights 的本队 UFA 可以用 Bird Exception 帽上续约，首年薪资最高为该球员允许的顶薪。 | `src/game/freeAgency/FreeAgencyService.test.ts` |
| UNKNOWN-004 | 最低球队工资为财务约束，不阻止开季。锁定开季名单时记录 `salaryFloorShortfall`，差额计入球队工资/支出。最低工资线为当季工资帽的 90%。 | `src/game/roster/RosterService.test.ts`；`src/game/cap/CapSheetService.test.ts` |
| UNKNOWN-005 | 第 105 日开始出现交易截止日事件，玩家在当日模拟结束前仍能交易；当日模拟后进入 `REGULAR_POST_DEADLINE`，第 106 日起禁止交易。 | `src/game/season/career.test.ts` |
| UNKNOWN-006 | 以 2026 赛季财务配置为基数，此后每赛季工资帽、最低工资、税线、两条土豪线及相关 Exception 金额（包括交易工资匹配的金额缓冲）同比分上涨 7%。最低球队工资始终等于当季工资帽 × 90%。 | `src/config/leagueFinance.test.ts`；`src/game/trade/NBACompliance.test.ts` |
| UNKNOWN-007 | 扩军选秀完成后必须进入扩军结果摘要；摘要展示两支扩军队最终阵容、薪资及剩余空间。玩家确认后才能准备新秀选秀；恢复选秀前检查点是次级的“重新进行扩军选秀”操作。 | `src/app/AppExpansionSummary.test.ts`；`src/game/draft/DraftService.test.ts` |

| 编号 | 已确认规则 | 验证入口 |
| --- | --- | --- |
| CONFLICT-001 | RFA 外队 Offer Sheet 给原队 2 个自由市场日的匹配期限（收到日 + 2）。待处理事项强制暂停市场，玩家须逐份匹配或放弃后才能继续；没有现实时间倒计时或自动放弃。`deadline` 用于状态校验和存档恢复。 | `src/game/freeAgency/FreeAgencyService.test.ts`；`src/app/Stage4Flow.tsx` |
| CONFLICT-002 | 赛季中 UFA 报价于下一日历日结算，休息日也计入。 | `src/app/FreeAgentOfferDialog.test.ts`；`src/app/MarketPages.test.ts`；赛季中自由市场测试 |
| CONFLICT-003 | 本队续约或匹配 RFA 不重置 `birdYears`；下一赛季合同年度完成后正常累加。交易保留年限，并将 `birdTeamId` 转给新队；以自由球员身份加盟另一队时才重新从 1 累计。 | `src/game/freeAgency/FreeAgencyService.test.ts`；`src/game/trade/NBACompliance.test.ts` |
| CONFLICT-004 | 非首届乐透须先执行 `ACKNOWLEDGE_DRAFT_LOTTERY`。确认前任何选人、AI 逐签或快进指令均由引擎拒绝，拒绝不改变状态。 | `src/game/draft/DraftService.test.ts` |
| CONFLICT-005 | `?fixture=` 只在 DEV 生效，生产 H5 带任何夹具参数仍进入正常首页／存档流程。 | `src/app/Bootstrap.test.ts`；生产 H5 构建 |
| TRADE-001 | AI 球队可有多名非卖品，通常为 2～3 人，明星密集球队可更多；非卖品绝对不能通过任何交易成交，也不能获得目标询价报价。此规则对旧报价、直接交易命令及 AI 球队之间的交易同样生效。具体判定阈值是当前版本的平衡参数，而非产品方确认的固定数值。 | `src/game/trade/TradeAvailabilityService.test.ts`；`src/game/trade/TradeService.test.ts`；`src/game/trade/AITradeService.test.ts` |
| TRADE-002 | 扬尼斯·阿德托昆博、斯蒂芬·库里、科怀·伦纳德、勒布朗·詹姆斯、凯文·杜兰特、乔尔·恩比德、杰伦·布朗在 AI 球队有效合同名单中时必须列为非卖品；年龄与球队方向的普通筛选不能排除他们，普通候选也不能把他们挤出非卖品名单。 | `src/game/trade/TradeAvailabilityService.test.ts` |

新发现的产品歧义仍应登记在 `UNKNOWN_RULES.md`，按 `SPEC-UNKNOWN` 判定。
