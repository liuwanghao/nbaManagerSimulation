# TEST_MATRIX — 现状规则到测试的追踪矩阵

基线：2026-09-28 当前工作区。功能编号对应 `FEATURE_INVENTORY.md`，规则对应 `CURRENT_SPEC.md` 章节；`INV-*` 为 `INVARIANTS.md`。这是测试设计和执行记录，不把当前实现自动认定为已确认规则。

**判定口径**：`PASS`＝符合已确认规则或明确系统不变量；`BUG`＝违反该规则或产生可复现明显错误；`SPEC-UNKNOWN`＝产品选择不明确，登记 `UNKNOWN_RULES.md`，不修改逻辑。单纯“与当前代码一致”只能写“行为已观察”，不得写 PASS。已裁决的 `CONFLICT-001`～`005` 按 `CONFIRMED_RULES.md` 判定。

**场景码**：N 正常路径；B 边界；E 异常路径；T 状态切换；R 重复操作；X 跨模块影响；S 存档恢复。每行给出七类用例；括号内为已有自动化落点。`待补`表示目前只有测试用例设计，没有对应自动化，不能计为通过。UI 观察证据见文末。

| 功能 → 规则 | N / B / E / T / R / X / S 测试用例 | 自动化与当前结论 |
| --- | --- | --- |
| F01 新游戏槽位 → 规格 10 | N 空槽建档；B 第 3 槽；E 槽位清单读取失败；T 首页→序章；R 重复点击开始；X 初始球队与种子；S 重开读同槽。 | `SaveService.test.ts` 覆盖槽结构；UI 已观察空槽→序章；E2E 待补。 |
| F02 读取／继续 → 规格 10 | N 读指定槽；B 三槽最近更新时间并列；E 空槽／损坏档；T 恢复原阶段；R 重复读；X 迁移球队、球员与赛程；S 核心状态往返。 | `SaveService.test.ts`；UI 已观察赛后自动保存、“继续上次进度”恢复 2–0 战绩、游戏内读取空槽提示“暂无存档”；损坏档等 E2E 待补。 |
| F03 序章 → 规格 1 | N 四幕继续；B 最后一幕；E 素材失败回退；T 跳过入建队；R 反复选幕；X 扩军队位置；S 退出重入。 | UI 已观察“跳过序章”到建队；自动 E2E 待补。 |
| F04 建队 → 规格 2、INV-001 | N 合法名称建队；B 2/20 字素；E 纯数字／非法字／重名；T TEAM_CREATION→RIGHTS；R 同命令重发；X SEA/LVG 联盟归属和队徽；S 保存品牌。 | `ExpansionService.test.ts`；UI 已观察单字数字拒绝、合法名称接受。 |
| F05 权益 → 规格 2 | N A/B 二选一；B 另一队必得相反包；E 未选禁继续；T RIGHTS→TRADE；R 同命令重发；X 扩军/新秀顺位；S 重载方案。 | `ExpansionService.test.ts`；UI 已观察 A 选取与进入交易桌。 |
| F06 选项结算 → 规格 2、5 | N 执行/拒绝选项；B 到期合同；E 无效选项状态；T OPTION_PHASE→TRADE；R 不能重复结转；X 自由球员池和保护名单；S 保存结算。 | `ExpansionService.test.ts`、`ContractLifecycleService.test.ts`；UI 仅观察结算提示。 |
| F07 扩军交易 → 规格 2、INV-016 | N 指定选择/保护；B 第 5 笔和同来源队；E 失效报价；T 接受→锁定；R 同命令重发；X 球员和签位唯一归属；S 接受后重载。 | `ExpansionService.test.ts`；UI 已观察接受 1/5、报价 30→29、球员自动占位。 |
| F08 扩军选秀 → 规格 2、INV-001/016 | N 逐签完成 28 签；B 工资帽临界、14 人；E 重复球员/来源队；T DRAFT→ROOKIE_DRAFT_PENDING；R 重复选签；X 阵容/补偿签/帽表；S 中途恢复。 | `ExpansionService.test.ts`；UI 已观察第 1 签由协议履行，完整 E2E 待补。 |
| F09 扩军结果/检查点 → 规格 2、10、已确认 UNKNOWN-007 | N 查看两队名单与财务；B 空补偿；E 未确认禁准备选秀；T 确认后入新秀选秀；R 重复确认；X 回退资产守恒；S 摘要及确认状态往返。 | `AppExpansionSummary.test.ts`、`DraftService.test.ts`；开发 UI 已实操确认摘要与后续入口。 |
| F10 选秀准备/交易 → 规格 3、6 | N 准备选秀；B 首届/后续赛季；E 扩军未完；T PENDING→DRAFT；R 重复准备；X 选秀权交易与签序；S 重载选秀班。 | `DraftService.test.ts`、`TradeService.test.ts`；UI 待补。 |
| F10a 乐透公布 → 规格 3、CONFLICT-004 | N 点击开始后倒序公布；B 最后一签；E 未全部公布禁确认、视频未完播不得重抽；T 未展示→已确认；R 重播不改结果、完播重抽必须改结果、重复命令幂等；X 战绩与签位归属；S 重抽后存档重载可继续重抽。 | `DraftService.test.ts`、`DraftLotteryScreen.test.ts`、`rewardVideo.test.ts`；本地浏览器已核验按钮位置和未完播提示，虎扑激励视频待实测。 |
| F10b 乐透揭晓存档恢复 → 规格 3 | N 全部揭晓后返回主页再进入，直接显示已定顺位；B 仅揭晓、尚未确认选秀；E 未完成揭晓不误标为完成；T 重抽后重新揭晓；R 重播不改变已保存结果；X 不改变选秀硬门禁；S 保存并读取后完整顺位仍显示。 | `DraftLotteryScreen.test.ts`、`DraftService.test.ts`、`SaveService.test.ts`；自动化已通过。 |
| F11 新秀选秀 → 规格 3、INV-017/018 | N 玩家和 AI 逐签；B 第 64 签；E 非当前签/已选人；T DRAFT→POST_DRAFT；R 重复命令；X 合同/名单/权属；S 中途恢复。 | `DraftService.test.ts` 含 64 签唯一性、重放；UI 待补。 |
| F12 选秀结果 → 规格 3 | N 显示全部签；B 首三顺位与落选；E 球员资料缺失；T 选秀后可见；R 重开弹窗；X 新秀合同；S 保存后结果相同。 | `DraftService.test.ts` 服务；UI 组件自动化待补。 |
| F13 年度选项/滚动 → 规格 5、9 | N 处理球队选项；B 零待决/最后一项；E 非授权阶段；T OFFSEASON→PRE_DRAFT；R 同命令重发；X 成长、Bird、Cap Hold；S 待决重载。 | `ContractLifecycleService.test.ts`、`PlayerDevelopmentService.test.ts`；UI 待补。 |
| F14 RFA 资质报价 → 规格 5 | N 提交/放弃；B 最后一人；E 非本队 RFA；T 待决→市场可进；R 重复决定；X Bird hold/身份；S 决策重载。 | `FreeAgencyService.test.ts`；UI 待补。 |
| F15 休赛期市场浏览 → 规格 5 | N 搜索/筛选/详情；B 空结果；E 非市场阶段；T 开市/闭市；R 重复筛选；X 帽表和名单；S 重载筛选不要求保留、报价应保留。 | `MarketPages.test.ts`、`freeAgencySort.test.ts`；E2E 待补。 |
| F16 定制报价/撤回 → 规格 5、INV-022/023 | N 合法报价/撤回；B 最低/最高薪与期限；E 超帽/满员/非法选项；T ACTIVE→WITHDRAWN；R 同窗口再报；X cap reservation；S 报价重载。 | `FreeAgencyService.test.ts`、`FreeAgentOfferDialog.test.ts`。 |
| F17 市场逐日/RFA → 规格 5、CONFLICT-001、INV-027 | N 逐日结算与匹配；B 收到日 + 2、无合格报价 14 天宽限期及要价折扣上限；E 未决时推进、极低报价；T RFA_MATCHING→SIGNED、要价随累计日数变化；R 重复决策；X 签约/帽预留、AI 报价及既有报价重算；S 未决和要价天数重载。 | `FreeAgencyService.test.ts`、`FreeAgentDemand.test.ts`；引擎与存档回归已补。 |
| F18 赛季中市场 → 规格 5、CONFLICT-002、INV-027 | N UFA 报价和双价格展示；B 无 UFA/休息日、被裁球员要价重置；E RFA 不可报；T 下一日历日结算与要价更新；R 重复报；X 阵容、赛程与 AI 报价；S 报价及无合格报价天数重载。 | `RegularSeasonFreeAgency.test.ts`、`FreeAgentDemand.test.ts`、`FreeAgentOfferDialog.test.ts`、`MarketPages.test.ts`。 |
| F19 交易 → 规格 6、TRADE-001/002、INV-020/021/021A | N 默认我方筹码询价、目标球员询价和接受，结果显示总评；B 同队 1～3 目标、普通非卖品 0～3 名、四名指定球员即使超龄或同队聚集仍受保护、工资线/签位年限；E 跨队/重复/合同不可交易目标、非卖品询价及成交、无合法报价或失效报价；T 询价模式、动态非卖品名单和窗口开闭；R 重复询价/成交、成交后选择与筛选清空且 0 条报价、旧报价重放；X 名单、Bird、cap、未来签、AI 对 AI 交易；S 保存了目标询价的存档仍默认打开我方筹码页、已成交报价留历史但不再展示、非卖品判定稳定性。 | `TradeAvailabilityService.test.ts`、`TradeService.test.ts`、`AITradeService.test.ts`、`NBACompliance.test.ts`、`MarketPages.test.ts`；开发 UI 已实操目标询价→查看报价→成交→页面归零，以及目标总评、非卖品禁用和球队＋位置＋姓名联合筛选。 |
| F20 交易记录 → 规格 6 | N 玩家/AI 日志；B 空态；E 缺旧记录；T 成交后出现；R 重开；X GM 生涯交易数；S 日志重载。 | `CareerRecords.test.ts`、`MarketPages.test.ts`；E2E 待补。 |
| F21 训练 → 规格 4、9 | N 选择重点；B 同时 2 人；E 超额/不合法年龄；T 季前→锁名单；R 重选；X 年度成长；S 训练计划重载。 | `RosterService.test.ts`、`PlayerDevelopmentService.test.ts`；UI 待补。 |
| F22 季前裁员/锁名单 → 规格 4 | N 裁员后锁定；B 14/15/21 人；E 超上限/人数不足；T PRESEASON→REGULAR；R 重复锁；X 死钱、UFA、赛程；S 锁前后读档。 | `RosterService.test.ts`、`schedule.test.ts`；UI 待补。 |
| F23 轮换 → 规格 4、INV-014/015 | N 编辑/保存；B 240 分/40 分；E 重复首发/伤员；T 伤病后手动恢复；R 重复保存；X 比赛时间；S 轮换重载。 | `RotationPlanService.test.ts`、`RotationEditor.test.ts`、`SaveService.test.ts`。 |
| F24 概览/合同 → 规格 4、5 | N 查看战绩/帽表；B 负帽下空间/零场；E 缺历史统计；T 比赛后更新；R 切排序；X cap 与球员数据；S 重载同值。 | `CapSheetService.test.ts`、`ManagementPages.test.ts`；UI 已观察工资构成和 15 人数据。 |
| F25 常规赛裁员 → 规格 4 | N 裁标准合同；B 最低名单；E 非法阶段/缺人；T 队员→UFA；R 重复裁同人；X 死钱/市场/轮换；S 裁员后重载。 | `RosterService.test.ts`、`ManagementPages.test.ts`；UI 已见按钮未成交。 |
| F26 选秀权资产 → 规格 6 | N 展示年/轮；B 无资产；E 失效原队引用；T 交易后持有人变化；R 反复切换；X 新秀签序；S 签位重载。 | `TradeService.test.ts`、`DraftService.test.ts`；视图 E2E 待补。 |
| F27 开场事件 → 规格 1、9 | N 确认进入赛季；B 最后一条事件；E 阻塞事件；T PRESEASON→REGULAR；R 重复确认；X 通知/赛程；S 开场页读档。 | `EventService.test.ts`、`SeasonOpeningScreen.test.ts`。 |
| F28 赛季日历 → 规格 7 | N 月份/日期/对阵；B 首末日；E 无下一场；T FINAL 后比分；R 重复选日期；X 比赛详情；S 日历恢复。 | `schedule.test.ts`、`seasonCommandView.test.ts`；UI 已观察月份、赛果、下一场。 |
| F29 模拟下一场/推进 → 规格 7、INV-006～013 | N 下一场/一天/五场；B 最后比赛日；E 阻塞事件/伤病；T 日期和阶段；R 同日重结算；X 战绩、伤病、FA；S 赛后读档。 | `career.test.ts`、`invariants.test.ts`；UI 已点击推进一天（休息日 0 场）、模拟下一场（1 场）、回首页继续恢复结果；其他 E2E 待补。 |
| F30 更多模拟入口 → 规格 7 | N 至事件/季末；B 已完赛；E 遇阻塞；T REGULAR→OFFSEASON；R 重复季末；X 奖项/冠军；S 长模拟读档。 | `career.test.ts`；旧 UI 可见性待补。 |
| F31 比赛详情 → 规格 7、INV-012/013 | N 双队 box 切换；B 加时；E 缺明细；T 已赛才可开；R 重开；X 球员/球队统计守恒；S 保存后重开。 | `simulation.test.ts`、`GameDetailModal.test.ts`；UI 已实际切客/主队并核对分节 126/135。 |
| F32 伤病/紧急补员 → 规格 9 | N 不足 8 人补员、日历日恢复；B 5/8 人和最后恢复日；E 无可签人；T 休息日/休赛期自由市场日/季后赛日期推进；R 同日不重复推进；X 底薪、轮换、比赛、预计缺席场次；S 旧存档缺少剩余天数时转换、待决重载。 | `InjuryService.test.ts`、`EmergencyRosterService.test.ts`、`seasonCommandView.test.ts`、`SaveService.test.ts`；旧存档迁移和季后赛 UI 仍待专项验证。 |
| F33 随机事件 → 规格 9、INV-024 | N 选择效果；B 多事件队列；E 无效选项；T 阻塞→继续；R 同效果重复；X 士气/轮换/通知；S 待决重载。 | `EventService.test.ts`、`SaveService.test.ts`；UI 待补。 |
| F34 季后赛/对阵 → 规格 8、INV-019 | N 完整季后赛；B 4/7 场系列；E 常规赛未完；T 季末→OFFSEASON；R 重复结算；X 冠军/奖项/历史；S 对阵重载。 | `career.test.ts`、`AppPostseason.test.ts`；系列赛逐轮断言已增。 |
| F35 联盟排名 → 规格 7、INV-009/010 | N 东西部/分区排序；B 同胜场；E 空战绩；T 比赛后重排；R 切分区；X 对阵种子；S 战绩重载。 | `StandingsPanel.test.ts`、`career.test.ts`、`invariants.test.ts`。 |
| F36 榜单/奖项 → 规格 8 | N 数据前五/候选；B 10/41/65 场门槛；E 无候选；T 季末最终名单；R 重算幂等；X 球员荣誉；S 获奖重载。 | `AwardsService.test.ts`、`AwardRace.test.ts`、`LeagueLeadersPanel.test.ts`。 |
| F37 全联盟赛程 → 规格 7 | N 切换比赛日；B 休赛日/末日；E 空赛程；T SCHEDULED→FINAL；R 切回今日；X 对阵/比分；S 赛程重载。 | `LeagueSchedulePanel.test.ts`、`schedule.test.ts`。 |
| F38 球员/球队详情 → 规格 4、7 | N 打开详情；B 无画像/无统计；E 实体缺失；T 交易后球队变化；R 重开；X 合同/阵容/数据；S 资料重载。 | `TeamRosterPanel.test.ts`、`PlayerRatingService.test.ts`；UI 已观察扩军球员详情。 |
| F39 生涯分享 → 规格 9 | N 总览/分享；B 首季零历史；E 平台不可用；T 季后更新；R 重开/再分享；X 成就/交易史；S GM 累计恢复。 | `CareerPages.test.ts`、`careerShare.test.ts`；外部发帖 E2E 不在离线测试内。 |
| F40 成就 → 规格 9 | N 解锁/筛选；B 阈值前后；E 无效 ID；T 锁→解锁；R 幂等；X GM 王朝分；S 解锁重载。 | `AchievementService.test.ts`、`CareerPages.test.ts`、`SaveService.test.ts`。 |
| F41 历史/里程碑 → 规格 9 | N 历季战绩/荣誉；B 首赛季；E 缺旧球员资料；T 归档后可见；R 重复归档；X 冠军/奖项/统计；S 旧档迁移。 | `CareerRecords.test.ts`、`FranchiseStats.test.ts`、`HistoryCompressionService.test.ts`。 |
| F42 成长/退役/名人堂 → 规格 9、INV-003/004 | N 结转成长与退役；B 年龄/属性上下界；E 资料缺失；T 年度结转；R 重放；X 合同/名单/荣誉；S 结转重载。 | `PlayerDevelopmentService.test.ts`、`invariants.test.ts`；UI 摘要待补。 |
| F43 存读档/云冲突 → 规格 10、INV-025 | N 保存/读取；B 3 槽/3 检查点；E 损坏档/云冲突；T 本地→云；R 版本递增；X 全状态；S 字段往返。 | `SaveService.test.ts`；真实云端 UI 待补。 |
| F44 通知 → 规格 9 | N 标单条/全部已读；B 80 条；E 不存在 ID；T 未读→已读；R 重复标记；X 事件/FA；S 已读恢复。 | `TeamNotificationService.test.ts`、`SaveService.test.ts`；UI 已观察铃铛 1 条。 |
| F45 玩家反馈 → 平台规则 | N 输入并提交；B 1/2000 字；E 未登录/风控拒绝；T 成功/失败；R 重复提交；X 平台鉴权；S 不要求随存档恢复。 | `userFeedback.test.ts`；UI 已打开表单，空内容提交禁用、上限显示 2000 字；未提交，生产服务 E2E 待授权环境。 |

## 阶段 0 UI 实操证据

- 在 `http://127.0.0.1:5175/app.html` 的空存档槽位进入新游戏，经序章跳过、建队命名、A 权益、扩军交易、扩军选秀。输入 `1` 时提示“名称不可用”，输入 `测试新星` 可继续；一份指定选择协议接受后已接受数 0→1、报价数 30→29，扩军选秀初始为 1/14。
- 在开发 `?fixture=game` 赛季中心，实际打开 10 月日历、最近一场赛后详情，切换客队/主队 box score；打开管理概览与合同薪资、市场交易台及自由球员“当前/休赛期到期”视图。此夹具用于观察界面，不能作为真实扩军生涯 E2E 通过证据。
- 同一开发夹具的交易台中，实际进入“搜索目标球员”，用“波特兰开拓者＋C＋丹尼尔”筛出丹尼尔·戈登并询价；页面返回 3 条可查看报价，逐条显示对方索要的本队球员或次轮签。该操作验证 UI 到引擎的询价链路，未在夹具里点击最终成交。
- 在独立端口的同一开发夹具内，点击“推进 1 天”经过无比赛日，随后点击“模拟下一场比赛”结算 1 场；球队战绩变为 2–0，并自动保存到 1 号槽。返回首页点击“继续上次进度”后，战绩和已完成日历仍为 2–0。此为开发夹具的 UI 存读档冒烟验证。
- 同一夹具中切换联盟排名、五项数据榜单、奖项竞争、全联盟赛程（向前切到 10 月 23 日显示 10 场均已结束）；切换生涯总览、成就、历史、里程碑。设置→存读档面板可见 3 个槽；“读取存档”中点空的 2 号槽，界面提示“存档 2 暂无存档”；随后读取 1 号槽恢复。玩家反馈弹窗可打开，空内容提交按钮禁用、长度上限 2000 字。未触发对外分享或反馈提交。
- 最初根路径跳至 `h5/index.html` 静态包；独立端口的 `app.html` 为源码开发预览。生产静态包应忽略 `?fixture=`，见 `CONFLICT-005`。

## 正式测试批次

阶段 0 文档与 UI 探索完成后启动正式批次。以下 `通过` 仅指断言和不变量成立；产品含义仍须按上文三态口径判断。

| 批次 | 执行命令／实际操作 | 结果与边界 |
| --- | --- | --- |
| Unit / Integration | `npm test`；`npm run test:data-sync`；补强后定向运行 `npm test -- src/game/freeAgency/FreeAgencyService.test.ts` | 全套件 77 个测试文件、433 项测试通过；数据同步管线 8 项通过。新增的跨模块不变量测试 2 项、季后赛系列赛断言所在的 `career.test.ts` 4 项均在全套件中通过；自由市场多队竞争测试补加唯一接受、唯一名单归属、预留释放断言后 21 项通过。 |
| 静态与构建 | `npm run typecheck`；`npm run build`；`git diff --check`；`node --check tools/data/sync_player_data.mjs` | 均通过。生产包体积提示为非失败警告：`game.js` 约 3.81 MB。项目未定义 `lint` 脚本。 |
| E2E UI 冒烟 | 浏览器操作源码 `app.html` 和独立端口夹具，详见上一节 | 新建→建队→权益→扩军交易→扩军选秀首签的前段流程可达；夹具中日推进、赛后详情、自动保存和继续恢复可达。尚未完整走通 28 签扩军、64 签新秀、完整休赛期与跨赛季的浏览器流程，因此这些用例不标 PASS。 |
| 扩军模拟 | `node --import tsx tools/headless/run-expansion.ts --seeds 10` | 10 个种子均完成 SEA/LVG 各 14 人和承诺资产检查。原 `npm run headless:expansion -- --seeds 10` 在当前沙箱因 `tsx` IPC pipe `EPERM` 未能启动；等价的 Node import 命令成功。 |
| 管理循环模拟 | `node --import tsx tools/headless/run-stage4.ts --seeds 2 --through-season2` | 2 个种子均经过 64 签新秀、自由市场第 4 日、交易接受、1312 场常规赛与第二赛季经理循环。 |
| 多赛季模拟 | `node --import tsx tools/headless/run-seasons.ts --seeds 3 --seasons 2` | 3 个种子各 2 季，即 6 个赛季当量通过；冠军和赛季记录生成。 |
| Stress | `node --import tsx tools/headless/benchmark.ts --season-equivalents 10 --seasons-per-career 5 --progress-every 2` | 2 条生涯各 5 季，累计 10 个赛季当量通过；历时 354.8 秒，平均每季 35.5 秒；季后赛 895 场、新秀流入 640 人、退役 294 人、严重一致性错误 0。最大原始存档 4.04 MB，存储后 0.66 MB；进程 heap 增量约 175.9 MB。该数值只描述本机此次运行，尚无产品性能阈值可判定。 |

**待补的自动化范围**：表内 46 个功能（含 F10a）的 N/B/E/T/R/X/S 用例已设计，但不少 UI 交互、云端同步和生产服务依赖场景尚无自动化。现有通过数不能外推为每个格子已验证。`UNKNOWN-001`～`007` 和 `CONFLICT-001`～`005` 均已确认并形成回归场景。

**待确认项**：紧急短合同的 Bird 年限记法见 `UNKNOWN_RULES.md` 的 `UNKNOWN-013`，对应正确性暂标 `SPEC-UNKNOWN`，不影响普通签约和交易路径的回归判定。

## 已确认规则新增回归场景

以下编号沿用原 UNKNOWN 编号，产品决定见 `CONFIRMED_RULES.md`。每项均按正常、边界、异常、状态切换、重复、跨模块、存档恢复七类设计；已执行证据以测试输出为准，未自动化的类别继续标“待补”。

| 功能 → 已确认规则 | N / B / E / T / R / X / S 场景 | 自动化落点 |
| --- | --- | --- |
| F17 自由市场时长 → 001 | N 日结算；B 第 120 日；E 先结算后提前关；T 市场→季前；R 同命令重放；X RFA 待决定时延迟关；S 第 120 日前恢复。 | `FreeAgencyService.test.ts`；S 待补。 |
| F16 报价到期 → 002 | N 有效期内接受；B `expiresDay` 当天；E 次日过期；T ACTIVE→EXPIRED；R 重结算；X 释放预留；S 到期前恢复。 | `FreeAgencyService.test.ts`；S 待补。 |
| F16 Bird UFA → 003 | N 本队帽上报价；B 首年顶薪；E 无资格/无 Hold 拒绝；T 签约；R 重放；X 帽表/名单；S 续约前后恢复。 | `FreeAgencyService.test.ts`；S 待补。 |
| F22 开季最低工资 → 004 | N 达标无差额；B 略低于 90%；E 极低工资仍可开季；T 锁名单生成差额；R 重锁；X 帽表/支出；S 读档保留差额。 | `RosterService.test.ts`、`CapSheetService.test.ts`；S 待补。 |
| F19 截止日 → 005 | N 第 105 日事件后仍可交易；B 第 105/106 日；E 截止后交易拒绝；T PRE→POST；R 事件不重复；X AI 交易/通知；S 事件前后恢复。 | `career.test.ts`、`EventService.test.ts`；S 待补。 |
| F24 年度财务 → 006 | N 2027 起递增；B 2026 基数；E 非法赛季；T 结转；R 同年查询稳定；X 合同/交易/新秀工资/紧急合同；S 跨年存档重算。 | `leagueFinance.test.ts`、`CapSheetService.test.ts`、`NBACompliance.test.ts`、`DraftService.test.ts`；S 待补。 |
| F09 扩军摘要 → 007 | N 两队名单/财务；B 补偿为空；E 未确认禁选秀；T 确认后准备；R 重复确认/重选；X 帽表/新秀入口；S 摘要状态往返。 | `AppExpansionSummary.test.ts`、`DraftService.test.ts`；开发 UI 已实操。 |
| F17 RFA 匹配 → CONFLICT-001 | N 收到后匹配/放弃；B 收到日 + 2；E 未决强制暂停；T 待决定→已处理；R 重复决定；X 名单/Bird/帽表；S 旧待决存档恢复。 | `FreeAgencyService.test.ts`；界面待交互 E2E。 |
| F18 赛季中报价 → CONFLICT-002 | N 下一日历日结算；B 休息日；E 非法 RFA 报价；T ACTIVE→结算；R 同日重复；X 玩家下场比赛前签约；S 报价恢复。 | `RegularSeasonFreeAgency.test.ts`、`FreeAgentOfferDialog.test.ts`、`MarketPages.test.ts`。 |
| F16/F19 Bird 连续性 → CONFLICT-003 | N 本队续约；B RFA 匹配；E 外队 FA 重置；T 年度累加；R 重复匹配/交易；X 交易转移年限；S 存档保留年限。 | `FreeAgencyService.test.ts`、`NBACompliance.test.ts`。 |
| F10a 选秀门禁 → CONFLICT-004 | N ACK 后选人；B 2026 首届已确认；E 未 ACK 禁止手选、AI 选、快进；T false→true；R 重复指令；X 生涯年度循环；S 缺字段旧档恢复。 | `DraftService.test.ts`、存档迁移和生涯测试；UI 待交互 E2E。 |
| F01 启动入口 → CONFLICT-005 | N 无参数生产启动；B 任意 fixture 参数；E 未知夹具；T 首页→存档；R 刷新；X DEV 预览不受影响；S 存档继续入口。 | `Bootstrap.test.ts`；生产包浏览器实操待补。 |

## 2026-09-28 已确认规则实现后的验证

- Unit / Integration：`npx vitest run --testTimeout 120000`，80 个测试文件、456 项测试通过。最初与经理循环并行的默认超时运行有 3 个长用例超时；在无压力脚本争用时重跑对应 3 个文件，38/38 通过，随后全套 456/456 通过。构建后的事件文案更改不影响规则逻辑。
- 静态与构建：`npm run typecheck`、`npm run build`、`git diff --check` 均通过；H5 离线构建成功。ZIP `unzip -tq` 通过，逐一比对 74 个打包文件与 `h5` 相同。
- H5 UI：开发夹具 `?fixture=expansion-summary` 实操显示两支扩军队各 14 人、名单与财务信息；确认后到新秀选秀准备页。真实玩家从建队到 28 签的整条浏览器流程仍待补。
- Simulation：`node --import tsx tools/headless/run-stage4.ts --seeds 1 --through-season2` 通过；两个赛季都完成 64 签新秀、自由市场、交易与常规赛经理循环。连续 5 赛季压力基准已完成，逐季数据见下一条。

- Stress（确认规则修复后）：`node --import tsx tools/headless/benchmark.ts --season-equivalents 5 --seasons-per-career 5 --progress-every 1` 通过；逐季耗时约 22.7、32.0、94.7、86.0、102.6 秒，总计 338.0 秒；454 场季后赛、320 名新秀流入、159 人退役，严重一致性错误 0；最大原始存档 4.10 MB，压缩存储 0.67 MB。此前尝试的 10 年单档运行无逐季进度输出且长时间未完成，主动中止，不计入通过数。

## CONFLICT-001～005 修复后的验证

- Unit / Integration：`npx vitest run --testTimeout 120000`，81 个测试文件、466 项测试通过。
- 类型与构建：`npm run build` 通过，生产 H5 静态资源已重新生成；`git diff --check` 通过。
- Simulation：`node --import tsx tools/headless/run-stage4.ts --seeds 1 --through-season2` 通过；首届及第二赛季均完成 64 签选秀、自由市场、交易与开季名单锁定。第二赛季脚本经正式乐透确认指令进入选秀。
- Stress：`node --import tsx tools/headless/benchmark.ts --season-equivalents 3 --seasons-per-career 3 --progress-every 1` 完成 3 个连续赛季（约 102.9 秒），270 场季后赛、160 名新秀流入、37 人退役，严重一致性错误 0；最大原始存档 3.16 MB、压缩存储 0.51 MB。
- 发布包：`release/篮球经理_联盟扩军时代.zip` 已更新；包内 74 个文件与 `h5` 目录逐字节一致。生产构建中不存在 `qaFixture`，夹具字符串只出现在数据标识中。
- 生产浏览器入口实操：本次浏览器安全策略拒绝打开本地 `file://` H5 页面，未绕过限制；CONFLICT-005 由 `Bootstrap.test.ts` 的生产分支测试及构建产物检查验证，真实浏览器入口仍待补。
