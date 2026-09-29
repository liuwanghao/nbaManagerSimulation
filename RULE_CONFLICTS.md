# 项目内部规则冲突与裁决

本清单保留最初在界面、引擎及不同业务路径中发现的分歧。2026-09-28 产品方已裁决 CONFLICT-001～005；裁决后的规则见 `CONFIRMED_RULES.md`，代码实际行为见 `CURRENT_SPEC.md`。历史实现不代表正确需求。

## CONFLICT-001：RFA 匹配期限

- **规则：** 原球队收到 RFA Offer Sheet 后的匹配期限。
- **涉及文件：** `src/app/Stage4Flow.tsx`；`src/game/freeAgency/FreeAgencyService.ts`。
- **原实现 A：** 页面显示“第 N 天截止”，引擎记录 `matchingDeadline` 和待决定项的 `deadline`，但按收到市场日加 1。
- **原实现 B：** 待决定项存在时，自由市场不能推进；玩家匹配或放弃时无现实时间超时检查。
- **可能影响：** 截止日提示、RFA 状态和存档恢复。
- **已确认规则：** 匹配期限为 2 个自由市场日（收到日 + 2）。待决定事项强制暂停市场推进，玩家必须逐份匹配或放弃，同日多份不能互相覆盖；不实现现实时间倒计时或自动放弃。`deadline` 用于状态校验和存档恢复。
- **核验：** `FreeAgencyService.test.ts` 中检查期限、暂停、决定及旧存档恢复。

## CONFLICT-002：赛季中自由球员报价结算时点

- **规则：** 赛季中 UFA 报价何时结算。
- **涉及文件：** `src/app/RegularSeasonFreeAgents.tsx`、`src/app/FreeAgentOfferDialog.tsx`；`src/game/season/career.ts`。
- **原实现 A：** 界面称“下一比赛日”或“后续比赛日”。
- **原实现 B：** 引擎按日历日推进并结算自由市场，包含玩家无比赛的休息日。
- **可能影响：** 报价撤回窗口、球员入队日期和操作预期。
- **已确认规则：** 下一日历日结算，休息日同样计入。引擎行为保留，界面文案修正。
- **核验：** `FreeAgentOfferDialog.test.ts`、`MarketPages.test.ts` 和赛季中自由市场引擎测试。

## CONFLICT-003：Bird 年限连续性

- **规则：** 本队续约、RFA 匹配和交易后是否延续连续 Bird 年限。
- **涉及文件：** `src/game/contracts/ContractLifecycleService.ts`、`src/game/trade/TradeService.ts`、`src/game/freeAgency/FreeAgencyService.ts`。
- **原实现 A：** 年度结转累加同队年限；交易把 `birdTeamId` 改为新队而保留年限。
- **原实现 B：** 自由市场签约一律将 `birdYears` 重置为 1，包括本队续约与匹配。
- **可能影响：** 后续 Bird Rights、Cap Hold、帽上续约资格。
- **已确认规则：** 本队续约和匹配保留年限，下一赛季按合同年度正常累加；交易保留年限且转移权利到新球队；只有以自由球员身份加盟另一队才从 1 重新累计。
- **核验：** `FreeAgencyService.test.ts`、`NBACompliance.test.ts`。

## CONFLICT-004：乐透确认的引擎门禁

- **规则：** 非首届选秀确认乐透前能否提交选秀指令。
- **涉及文件：** `src/app/DraftLotteryScreen.tsx`、`src/app/Stage4Flow.tsx`、`src/game/draft/DraftService.ts`。
- **原实现 A：** UI 在 `lotteryPresented=false` 时要求先揭晓和确认。
- **原实现 B：** 逐签、AI 逐签和快进服务原先未检查该标记，脚本能绕过 UI。
- **可能影响：** 旧存档、脚本入口和选秀状态恢复。
- **已确认规则：** `lotteryPresented=false` 时任何选秀指令均不可执行；必须先 `ACKNOWLEDGE_DRAFT_LOTTERY`，再进入选秀。旧存档缺少确认标记也应受门禁保护。
- **核验：** `DraftService.test.ts`。

## CONFLICT-005：生产环境夹具参数

- **规则：** `?fixture=` 是否能改变生产 H5 启动流程。
- **涉及文件：** `src/app/Bootstrap.tsx`、`h5/assets/game.js`。
- **原实现 A：** `createFixturePreview` 受 `import.meta.env.DEV` 保护。
- **原实现 B：** `qaFixture` 判断原先未受 DEV 保护，生产包带参数时跳过首页。
- **可能影响：** 分享链接和生产首页／存档入口。
- **已确认规则：** 参数仅在 DEV 环境生效；生产环境无论是否带参数都按正常首页／存档流程启动。
- **核验：** `Bootstrap.test.ts`、生产 H5 构建。
