# CURRENT_SPEC — 当前代码行为基线

> 本文记录 2026-09-28 工作区中 TypeScript 引擎的**实际实现**，不把 README、历史文档或现有测试当作产品最终要求。金额单位为美元，`dateIndex` 从 0 开始。`代码已核对`表示已逐项读执行路径；`自动化已有`只表示仓库中存在对应测试，不能推论测试已通过；`UI 未核验`表示本文作者尚未实操该路径。出现矛盾或设计选择时，以 `RULE_CONFLICTS.md`、`UNKNOWN_RULES.md` 记录，不据此断定正确性。

## 1. 初始状态和阶段

- `createExpansionCareer(seed)` 以 2026-27 赛季、10 月 20 日开季、174 个日历索引（0～173）建立 32 队状态，再清空 SEA/LVG 两支扩军队名单和赛程，阶段置为 `TEAM_CREATION`。`createCareer` 本身可直接建立 `REGULAR_SEASON` 夹具。随机源为生涯与赛季种子及稳定哈希；初始存档 schema 为 18。见 `src/game/season/career.ts`、`src/game/random/`、`src/data/fixture.ts`。**测试状态：自动化已有；UI 未核验。**
- 可见扩军主线为 `TEAM_CREATION → EXPANSION_RIGHTS → OPTION_PHASE（内部）→ EXPANSION_TRADE → EXPANSION_DRAFT → ROOKIE_DRAFT_PENDING → DRAFT → OFFSEASON_POST_DRAFT → PRESEASON → REGULAR_PRE_DEADLINE → REGULAR_POST_DEADLINE → PLAY_IN → PLAYOFFS → OFFSEASON`。后续赛季 `OFFSEASON → OPTION_PHASE → OFFSEASON_PRE_DRAFT → DRAFT`。一些旧阶段值 `REGULAR_SEASON`、`POSTSEASON` 仍被函数接受。阶段门由 `assertPhaseAllowed` 和各服务的允许数组决定，不能单看类型名。见 `src/game/expansion/ExpansionService.ts`、`src/game/contracts/ContractLifecycleService.ts`、`src/game/draft/DraftService.ts`、`src/game/roster/RosterService.ts`、`src/game/season/career.ts`、`src/game/policy/TransactionPolicyService.ts`。**测试状态：自动化已有；UI 未核验。**
- 每个命令服务计算 `stableHash(type,payload)`，若 `commandId` 已记录且哈希相同则返回原状态；同 ID 异 payload 报错。阶段函数的直接调用不一定带命令回执。见各服务的 `execute*Command` 与 `GameState.commandReceipts`。**测试状态：多处自动化已有；UI 未核验。**

## 2. 扩军建队、权益、扩军交易、扩军选秀

- 玩家从 SEA 或 LVG 二选一；球队名称先 trim、NFKC 规范化，须 2～20 个字素，只接受汉字、英文字母、数字、空格、撇号和连字符，不能连续空格、纯数字、禁用品牌词或与现有队重名。Logo 必须来自预设；主辅色须在安全色板且不能相同。另一支扩军队的品牌、策略由种子决定；策略权重 `FUTURE_FIRST/BALANCED/WIN_NOW=40/40/20`。见 `src/game/expansion/ExpansionService.ts`、`src/data/expansionBrands.ts`、`src/config/balanceConfig.ts`。**测试状态：自动化已有；UI 未核验。**
- 权益抽签状态中的赢家在建队时直接设为玩家队。玩家选 A 或 B，另一队获得相反方案。A 在扩军选秀先手、新秀第 6 顺位；B 在新秀第 5 顺位。进入选秀准备时合同选项按固定种子以 70% 概率执行，未执行者转 UFA。老球队各保护 8 名符合条件的标准合同球员；UFA/RFA、紧急合同、到期或未执行选项者不进扩军池。见 `src/game/expansion/ExpansionService.ts`、`src/config/balanceConfig.ts`。**测试状态：自动化已有；UI 未核验。**
- 每个老球队只会损失 1 名球员；每支扩军队要从 14 支不同老球队各选 1 人，总计 28 签，顺序为两队交替且下一轮倒序。扩军交易可承诺保护某人或指定选择某人，单扩军队最多接受 5 笔，同一老球队至多一笔；AI 目标接受 2 笔。补偿资产是后续首/次轮签，先保留，履约时转移；池可完成性和承诺占位在接受时验证。选人后计入扩军工资限制 $164,961,000，计算含当前 cap sheet 和未满 12 人的底薪占位及已承诺人员；完成后进入 `ROOKIE_DRAFT_PENDING`。见 `src/game/expansion/ExpansionService.ts`、`src/game/cap/CapSheetService.ts`、`src/config/leagueFinance.ts`。**测试状态：自动化已有；UI 未核验。**

## 3. 新秀选秀

- 每届 80 名候选、两轮共 64 签；2026 使用精选真实候选和官方顺序，扩军队插入首轮 5/6、次轮 37/38；后续赛季按战绩和乐透组成签序。选秀只能由当前签位所有者选未被选走的候选；AI 可逐签推进或快进至玩家签，64 签完成后余下 16 人转 UFA。夹具的 2026 数据分支还会把部分生成落选秀改成 `UNDRAFTED`。见 `src/game/draft/DraftService.ts`、`src/data/real2026Draft.ts`、`src/config/balanceConfig.ts`。**测试状态：自动化已有；UI 未核验。**
- 后续乐透候选具体取东西部排名 11～16、9～10，再加存档中的 7/8 附加赛败者（缺记录时取每区第 8）；其中排名 11～16 中最差的 3 队被标记降位。抽签球数按候选类型为 1～3；最近一年状元队不能再拿状元，连续两年进前 5 的队下一年不能在前 5，降位队到抽签后段有强制抽取条件。2026 选秀创建时 `lotteryPresented=true`；以后赛季初始为 false，需要调用 `ACKNOWLEDGE_DRAFT_LOTTERY` 才标记为已展示，但逐签引擎函数自身并不检查该标记。未来新秀有隐藏潜力、发展率和侦察误差；2027 起每届最多 3 名历史球星“原型”，选择顺序使用历史记录排序。见 `src/game/draft/DraftService.ts`、`src/config/balanceConfig.ts`。**测试状态：自动化已有；UI 未核验。**
- 首轮首年工资为该顺位 rookie scale × 1.2，四年薪资系数 `[1,1.05,1.10,1.16]`、前两年保障、第三四年球队选项。次轮首年为底薪，两年 `[1,1.05]`、首年保障、第二年球队选项。签约须不超过休赛期 21 人；AI 满员时先裁人并生成保障死钱。见 `src/game/draft/DraftService.ts`、`src/config/leagueFinance.ts`。**测试状态：自动化已有；UI 未核验。**

## 4. 名单、角色、训练、轮换和裁员

- 休赛期名单上限 21，常规赛上限 15；开季锁名单时玩家不能超过 15，低于 14 须确认，随后自动从 UFA 中按公开球员价值签底薪至 14；AI 同样规整至 14～15。当前裁员接口禁止玩家名单降至 8 人及以下，裁后球员转 UFA、Bird 信息清空，剩余保障按赛季进入死钱；若可用球员至少 5 人，会重排轮换。见 `src/game/roster/RosterService.ts`、`src/config/leagueFinance.ts`。**测试状态：自动化已有；UI 未核验。**
- 球队角色可在休赛期、季前赛与常规赛设定；`FRANCHISE_CORE` 最多 3 人。训练重心仅季前赛可设，同时最多 2 人。轮换设定于季前赛/常规赛/季后赛等阶段；须 5 个不同且健康可用的首发、所有人分钟为非负整数、合计 240、5～12 人有正分钟，常规赛个人最多 40 分、季后赛验证允许 42 分。默认轮换自动优化五位置首发，给前 10 人分配基于 `[34,34,33,32,31,26,18,14,10,8]` 的 240 分钟。见 `src/game/roster/RosterService.ts`、`src/game/roster/RotationPlanService.ts`、`src/config/balanceConfig.ts`。**测试状态：自动化已有；UI 未核验。**
- 主/副位置比赛错位罚分为 0；非副位置按主位置距离使用 `[0,1.5,4,8,14]`。自动首发分配额外把副位置当作 2 点偏好罚分、其他错位乘 3。人工计划因伤缺首发时会先保留其余人工指定首发，再补空位。见 `src/game/roster/RotationPlanService.ts`、`src/game/simulation/ratings.ts`。**测试状态：自动化已有；UI 未核验。**

## 5. 薪资、Bird 权利、选项与自由市场

- 当前统一财务配置：工资帽 $164,961,000；最低球队工资 $148,465,000；奢侈税线 $200,428,000；第一土豪线 $209,015,000；第二土豪线 $221,686,000；普通及新秀底薪 $1,272,870。签约最高首年工资按服务年限 0～6/7～9/10+ 分别为工资帽 25%/30%/35%；非母队最多 4 年、逐年涨幅最多 5%；母队最多 5 年、涨幅最多 8%。见 `src/config/leagueFinance.ts`、`src/game/freeAgency/FreeAgencyService.ts`。**测试状态：配置和服务自动化已有；UI 未核验。**
- Cap sheet 的 `activeContractSalary` 是现役标准合同工资（不含紧急合同当季名义薪资）加按比赛日实际计提的紧急工资；另加当季死钱、cap holds、报价预留的超出同球员 hold 的部分、至 12 个占位的底薪。`total` 为以上之和，`availableCapSpace = salaryCap − total`，可为负。Bird UFA 需原队连续年数至少 3，hold 为前薪 × 1.5，与底薪取大、最高薪取小；RFA hold 为前薪 × 1.5 与资质报价取大，资质报价为前薪 × 1.25 与底薪取大。见 `src/game/cap/CapSheetService.ts`、`src/game/contracts/ContractRules.ts`、`src/game/contracts/ContractLifecycleService.ts`。**测试状态：自动化已有；UI 未核验。**
- 赛季结转先做成长/退休，再推进合同。球员在队且赛季名单天数至少 41 才新增服务年；Bird 年数对同队累加，否则设置新队与至少 1 年；合同结束时仅满四年的首轮新秀转 RFA，其余到期转 UFA。玩家球队选项必须逐个决定，AI 依球员价值、薪资、年龄和角色计算；球员选项按当前选项工资与预计市场价、人格、伤病及固定随机波动判断。随后创建 cap hold，才能进入选秀前阶段。见 `src/game/contracts/ContractLifecycleService.ts`、`src/config/balanceConfig.ts`。**测试状态：自动化已有；UI 未核验。**
- 选秀结束、进入自由市场前，玩家必须处理自身 RFA 资质报价；拒绝后转 UFA。自由市场允许每个球员同时最多 5 个活跃报价，每队在同一报价窗口只能提交一次（撤回也占已提交记录）。报价首年须底薪至最高薪、期限合法、逐年薪资与年涨跌幅合法、保障比例 0～100%；球队名单必须留位且工资空间须覆盖首年薪资减该人 hold，但持有自身 RFA 权利时可走豁免。球队选项末年不算入可保障金额。见 `src/game/freeAgency/FreeAgencyService.ts`。**测试状态：自动化已有；UI 未核验。**
- 报价有效 3 天，球员决策窗口为 3 天；市场效用由首年薪资、保障、年限、承诺角色、战绩、争冠度、球队吸引力、市场偏好、老东家关系、年龄阶段加权，并加固定种子 ±3 的扰动。最优报价效用 ≥85 可提前接受；到截止日 ≥60 可接受，否则拒绝。每日先生成 AI 报价（每队最多 3 个），再结算球员，最后 `currentDay += 1`。RFA 接受外队报价后进入匹配窗口，玩家原队必须匹配或拒绝，未处理时禁止推进；AI 按名单、cap/hold 和价值阈值自动决定。常规赛可向 UFA 报价，常规赛比赛日末也调用自由市场每日结算；RFA 只在休赛期。见 `src/game/freeAgency/FreeAgencyService.ts`、`src/game/season/career.ts`、`src/config/balanceConfig.ts`。**测试状态：自动化已有；UI 未核验。**

## 6. 交易与 AI 经理

- 玩家交易窗口是选秀前、选秀后、季前赛、交易截止前常规赛；常规赛第 105 日之后关闭。报价包可为球员和/或选秀权，但双方各须有资产，球员和签位不能重复且必须实际归属。可交易签位范围为该赛季或下一赛季起至当前年份 +7；不能移动被扩军承诺占用的签；交易后双方未来不能连续两个年份没有首轮。交易后名单不能超阶段上限或少于 5 人，紧急合同及到期合同不可交易。见 `src/game/trade/TradeService.ts`、`src/config/balanceConfig.ts`。**测试状态：自动化已有；UI 未核验。**
- 工资匹配先算交易后的完整 cap total，若 ≤工资帽+$250,000 则直接通过。否则按交易前/后 `activeContractSalary + deadMoney` 较高值分土豪线：第二土豪线不得入薪超过出薪且禁止以多份出薪换一份更高薪；第一线不得入薪超过出薪；以下采用扩展同时交易例外 `max(min(2×出薪+$250k, 出薪+按工资帽缩放的 $7.752m), 1.25×出薪+$250k)`。Cap hold 不计入分档的上述实际薪资。见 `src/game/trade/SalaryMatchValidator.ts`、`src/config/leagueFinance.ts`。**测试状态：自动化已有；UI 未核验。**
- 刷新交易询价增加询价计数并影响报价价值，最多呈现 3 个。接受后原报价其他项失效，球员、选秀权、轮换和经理交易史同步变更；交易中的球员 `birdTeamId` 改为新队。AI 之间的交易每 7 天评估且截止日前最后一周每日评估，每队每赛季最多 3 笔，不涉及玩家球队。见 `src/game/trade/TradeService.ts`、`src/game/trade/AITradeService.ts`、`src/config/balanceConfig.ts`。**测试状态：自动化已有；UI 未核验。**

## 7. 赛程、比赛和排名

- 锁开季名单时生成 32 队、每队 82 场（主客各 41）、全联盟 1312 场、174 天赛程。首日 3 场、圣诞 5 场、末日 16 场；日程含 10 个休赛日、每队 12～16 次背靠背、不得同日双赛或三天三赛、主场连战至多 6、客场至多 5。同分区 4 战、跨分区 2 战，同区不同分区按轮转为 3 或 4 战。生成后 `validateSchedule` 不通过会抛错。见 `src/game/schedule/schedule.ts`、`src/config/balanceConfig.ts`。**测试状态：自动化已有；UI 未核验。**
- `simulateLeagueDay` 只取给定日仍为 `SCHEDULED` 的比赛，依 ID 排序后模拟、写入最终比分/胜队、排名和球员赛季数据。球队比赛后球员才累计合同名单天数；赛后更新疲劳、伤病、粉丝/士气、事件；日期最多推进到 173。赛前若有待处理的阻塞事件、重大伤病或用户紧急名单决策则暂停。日期达到 105 后切为 `REGULAR_POST_DEADLINE`；交易 AI 评估在此前进行，最后进行自由市场结算。见 `src/game/season/career.ts`、`src/game/injuries/EmergencyRosterService.ts`。**测试状态：自动化已有；UI 未核验。**
- 比赛使用 `stableHash(seasonSeed,"game",game.id)` 独立确定结果。节奏夹在 92～106，基准 99.5；双方进攻效率从联盟 114 起，叠加进攻/对手防守、球星、适配、状态、士气、主场 `+0.9`/客场 `-0.9` 及噪声，比分为 `max(65, round(pace×Ortg/100))`；平局进入 5 分钟加时直到分胜负。分差至少 18 且无加时触发垃圾时间，首发最多减少 3 分钟并分给替补。球员 box score 和每节得分由总比分生成，最后生成伤病。见 `src/game/simulation/simulateGame.ts`、`src/game/simulation/config.ts`、`src/game/simulation/boxScore.ts`。**测试状态：自动化已有；UI 未核验。**
- 排名胜负、主客、同分区、同分区所属联盟、相互战绩及净胜分随每场更新。同胜场排序依次看同组彼此交手胜率、若同组同分区则分区胜率、分区所属联盟胜率、净胜分、固定种子抽签；多队平手逐名移除再算剩余。见 `src/game/standings/standings.ts`。**测试状态：自动化已有；UI 未核验。**

## 8. 附加赛、季后赛与奖项

- `simulatePostseason` 一次完成两区附加赛和全部季后赛，并立刻把阶段置 `OFFSEASON`。每区第 7/8 名争 7 号种子，第 9/10 名负者淘汰，其胜者与首场负者争 8 号种子；前 6 直接晋级。每区八强首轮对阵 1-8、4-5、2-7、3-6；全部系列赛七战四胜，主客顺序为高种子 `2-2-1-1-1`，达到四胜立即结束。总决赛主场优势看常规赛胜场，平手看净胜分（相等时西部优先）。赛后写冠军、季后赛逐场记录与赛季归档。见 `src/game/season/career.ts`。**测试状态：自动化已有；UI 未核验。**
- 常规赛结束先定全明星和 MVP、DPOY、ROY、MIP、第六人；基本候选至少 10 场，得分/篮板/助攻/抢断/封盖/失误加权产值，再乘最多 65 场的出勤系数。MVP 仅限东西部各前 6 队并将球队胜场贡献加倍；ROY 要服务年限≤1 且生涯未计完整赛季；MIP 至少 41 场、前一赛季至少 20 场，产值进步至少 2。各区全明星 12 人。总决赛 MVP 从冠军队决赛 box score 累计产值中选取。见 `src/game/awards/AwardsService.ts`、`src/config/balanceConfig.ts`。**测试状态：自动化已有；UI 未核验。**

## 9. 成长、伤病、随机事件、成就和生涯

- 赛季结转时先累计当前赛季个人生涯数据、按下一赛季 10 月 20 日计算年龄，再按年龄曲线、隐藏潜力差、发展率、上场分钟、角色、健康、篮球智商和训练重心逐属性成长/衰退，单属性年度变化夹在 -6～+4、绝对属性夹在 25～99。随后按年龄、OVR、合同、首发、伤病评级、人格和失业时长决定退休；退休球员从球队名单移除、状态改 `RETIRED`。名人堂分数由荣誉及产值/巅峰/年资组成，达到 75 且数据合格入选。见 `src/game/development/PlayerDevelopmentService.ts`、`src/config/balanceConfig.ts`。**测试状态：自动化已有；UI 未核验。**
- 单人单场基础受伤概率 0.0035，严重程度权重小/短/中/长/赛季结束为 55/23/13/7/2，缺阵场数分别为 1～3/4～8/9～20/21～45/60～99，概率再受健康、分钟、年龄、疲劳、历史伤病影响。受伤队赛前不足 8 个可用球员时触发紧急补员；绝对比赛下限 5 人。紧急工资按被锁定比赛日计提。见 `src/game/simulation/injuries.ts`、`src/game/injuries/EmergencyRosterService.ts`、`src/config/balanceConfig.ts`。**测试状态：自动化已有；UI 未核验。**
- 玩家比赛后按连续胜负里程碑及每 6 场的动态事件逻辑加入事件队列；动态事件触发概率配置为 1，分类受 32 分爆发、士气 35 以下及胜负影响，定义由 `src/data/events.ts` 提供。需经理选择的事件阻塞推进；信息事件可自动执行效果并转队伍收件箱/联盟日志；效果有独立执行 ID 防重复。队伍通知最多保留 80 条。见 `src/game/events/EventService.ts`、`src/game/notifications/TeamNotificationService.ts`、`src/config/balanceConfig.ts`。**测试状态：自动化已有；UI 未核验。**
- 成就含扩军完成、职业胜场、单季胜场、附加赛、季后赛、系列赛、总决赛/冠军、奖项和王朝等固定阈值；解锁后增加 dynasty score，GM 生涯数据由赛季历史重建，另记录玩家选秀与交易。见 `src/game/career/AchievementService.ts`、`src/game/career/CareerRecords.ts`、`src/game/season/career.ts`、`src/config/balanceConfig.ts`。**测试状态：自动化已有；UI 未核验。**

## 10. 存档与恢复

- 支持 1～3 号生涯槽。每次保存增加 revision，记录 parent revision、状态稳定哈希、时间戳和待同步标记；先写 `:pending` 并回读校验，再替换主键，保留前一个有效版本。读取时先验状态哈希，再进行旧数据迁移，包括补字段、签位、角色/轮换、球员资料与事件、奖励等；因此旧存档加载后的状态可能与保存原样不同。每槽最多保留 3 个命名 checkpoint，另有冲突备份。见 `src/storage/SaveService.ts`、`src/platform/storage/StorageAdapter.ts`。**测试状态：自动化已有；UI 未核验。**
- 云同步按本地/云端 hash、revision、同步基线判定同一、单边前进或冲突；冲突不会自动合并。选择云端前会备份本地状态并校验备份；选择本地会写入新的 revision。见 `src/storage/SaveService.ts`。**测试状态：自动化已有；UI 未核验。**

## 核验边界

本文所有“当前规则”以列出的执行代码为证据，未将这些规则提升为产品已确认规则。静态代码核对尚不能证明游戏 UI 中各按钮可达、服务实际运行成功、测试通过或长赛季稳定性；这些需在阶段 0 的 UI 实操和随后正式测试中补证。`RULE_CONFLICTS.md` 应另列实现冲突，`UNKNOWN_RULES.md` 应另列产品意图不明处。

## 阶段 0 UI 实操补证

本节是 2026-09-28 对源码开发入口 `app.html` 的实际浏览器操作，不将开发夹具视为生产流程的全程证据。

- 首页三个存档槽可见；选空槽后出现四幕序章，“跳过序章”进入 SEA/LVG 建队。命名输入 `1` 时显示不可用且创建按钮禁用；输入 `测试新星` 时按钮可用，创建后进入权益页。权益 A 显示扩军第 1 签、新秀首轮第 6 签、次轮第 38 签；确认后进入扩军交易桌。
- 扩军交易桌显示 30 份报价和 0/5 已接受。打开球员详情可见属性与合同；接受一份“指定选择”后显示 1/5、可用报价 29 份。锁定协议进入扩军选秀，球员已占 1/14，播报记录指定选择与 AI 连续签位；池可搜索、按位置和 OVR 排序，并显示实时工资帽。
- 在 `?fixture=game` 页面实际看到赛季日历、下一场、三种模拟入口和近期结果；点击近期赛果进入赛后页，比分 126–135、分节合计一致，客/主队球员统计 tab 可切换。管理页概览显示 15 人赛季数据，合同页显示工资帽、占用构成与裁员按钮；市场交易页空筹码时询价禁用，自由球员页可切“当前 0 人／休赛期到期 126 人”只读视图。
- 独立端口夹具中从 1–0 开始，先推进一个休息日（0 场），再模拟下一场（1 场），球队变为 2–0；自动保存后回首页“继续上次进度”可恢复相同战绩。联盟四个子页和生涯四个子页均可从底部菜单切换；联盟赛程切到已完成的 10 月 23 日显示 10 场均已结束。设置内“读取存档”可点击空槽，显示“存档 2 暂无存档”。这些是观察到的行为，尚不等于每个子页的数值和产品规则已经确认。
- 未经 UI 实操确认的路径仍以各节原标注为准；上述观察不覆盖完整 28 签扩军、64 签新秀、跨赛季、生涯、云同步或反馈提交。
