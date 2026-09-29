# 已实现功能清单（现状规格重建）

> 范围：`src/app` 全部页面与入口，结合所调用的游戏服务、`package.json`、`public` 和 `docs` 识别可达流程。本清单是**代码观察**，不把 UI 文案、旧文档或现行实现当作已确认产品规则。除另行标注外，各项均为“代码已观察，UI 尚未逐项验证”；自动化脚本或单元测试的存在不等于端到端验证。正式判定见 `CURRENT_SPEC.md`、`RULE_CONFLICTS.md`、`UNKNOWN_RULES.md` 和 `TEST_MATRIX.md`。
>
> 入口分流：`src/main.tsx` → `Bootstrap.tsx` → `App.tsx`；游戏阶段决定显示 `ExpansionFlow.tsx`、`Stage4Flow.tsx`、赛季开场页或常规赛五栏导航。根目录没有 README；`docs/UI_PROTOTYPE_BRIEF_V1.5.md` 等仅作历史线索。`public/story`、`public/expansion-logos`、`public/team-logos`、`public/player-portraits` 是实际界面素材。`?fixture=` 为开发环境预览入口，非普通玩家流程。

扫描范围索引（`rg --files`）：`src/app` 75 文件、`src/game` 80、`src/data` 42、`src/config` 4、`src/platform` 3、`src/storage` 2，另有入口/样式 2 文件；`public` 71 文件、`docs` 10 文件、`tools/headless` 6 文件。`tools/data` 的 654 文件中 635 个为头像 PNG，其余为数据管线脚本和少量数据/说明文件；素材按路径及界面引用盘点，未把图片文件本身当作游戏规则。根目录配置、构建脚本和 `package.json` 一并核对。项目没有独立 `tests/` 目录，测试与源码并置。目录/文件被扫描不代表每条运行路径已通过 UI 验证，具体证据见 `TEST_MATRIX.md`。

下表“异常”包括界面禁用、空态与指令失败时的可见表现；服务内完整校验仍需以 `CURRENT_SPEC.md` 和测试为准。

## 启动、扩军与新秀选秀

| ID／功能 | 入口页面、相关代码 | 使用的数据；前置条件 | 操作流程与结果 | 异常情况；跨模块依赖 |
|---|---|---|---|---|
| F01 新游戏与存档槽位 | 首页“开始新游戏”；`src/app/Bootstrap.tsx`、`src/data/hupuRoster.ts`、`src/storage/SaveService.ts` | 打包球员数据、三存档槽摘要；进入首页 | 打开槽位弹窗→选空槽或二次确认覆盖→创建扩军状态→播放序章 | 读取槽位列表失败显示通知；覆盖旧槽是不可恢复操作；依赖存档和初始数据。 |
| F02 读档／继续进度 | 首页“读取存档”“继续上次进度”；`Bootstrap.tsx`、`GameChrome.tsx`、`SaveService.ts` | 本地槽位摘要、最近更新记录；存在有效存档 | 选槽或读取最近档→解析并恢复游戏阶段 | 游戏内存档面板允许点空槽并提示“暂无存档”；无最近存档、解析失败显示提示；依赖版本迁移与阶段分流。 |
| F03 序章播放 | 新游戏后；`src/app/ExpansionCinematic.tsx`、`public/story/*` | 场景静态素材、初始球队；新游戏 | 点击场景圆点／“继续”／“跳过序章”→进入球队创建 | 素材加载与移动端显示待 UI 验证；依赖素材路径。 |
| F04 创建扩军球队 | 扩军阶段“选择扩军城市”；`src/app/ExpansionFlow.tsx`、`src/game/expansion/ExpansionService.ts`、`src/data/expansionBrands.ts` | `teams`、扩军城市及品牌预设；`TEAM_CREATION` | 选西雅图或拉斯维加斯，填球队后半名，预览完整队名，点击创建→生成玩家球队并进入权益阶段 | 空名／名称校验失败禁用创建；指令失败状态不更新；依赖队徽、联盟球队、存档。 |
| F05 选择扩军权益 | 扩军“选择扩军权益”；`ExpansionFlow.tsx`、`ExpansionService.ts`、`src/config/balanceConfig.ts` | A/B 包权益、扩军抽签状态；已创建球队 | 选阵容优先或新秀优先→确认→另一个方案给电脑扩军队，进入合同选项／选秀准备 | 未选择不能继续，确认后不可再选；影响扩军签位和新秀顺位。 |
| F06 扩军合同选项结算 | 扩军“合同选项已经结算”；`ExpansionFlow.tsx`、`ExpansionService.ts` | 全联盟球员合同与选项；权益确认后 | 显示执行／拒绝／自由球员排除摘要→冻结保护名单 | 数据摘要可能只反映状态计数；错误由状态栏显示；依赖合同和扩军候选池。 |
| F07 扩军交易协议 | 扩军“扩军交易桌”；`ExpansionFlow.tsx`、`ExpansionService.ts` | 报价、保护名单、补偿选秀权；`EXPANSION_TRADE` | 按全部／指定选择／保护球员筛选，查看球员，接受协议，进入扩军选秀 | 达接受上限禁用；无报价为空态；协议入队或补偿签影响后续选秀和资产。 |
| F08 扩军选秀 | 扩军“扩军选秀大会”；`ExpansionFlow.tsx`、`ExpansionService.ts`、`src/app/PlayerListFilters.tsx` | 未保护球员、来源球队、薪资表、签位和协议；`EXPANSION_DRAFT` | 切换球队、搜索／位置／排序，查看球员及已选阵容，逐签选择；协议球员可自动入队；完成后切新秀阶段 | 薪资硬上限禁选、选秀池空态、协议自动选择失败可重试；依赖保护名单、薪资帽和存档检查点。 |
| F09 扩军结果和检查点 | 扩军结束摘要组件；`ExpansionFlow.tsx`、`App.tsx`、`SaveService.ts` | 两支扩军队名单、扩军前检查点；选秀完成 | 展示两队最终名单、阵容薪资、帽表占用与剩余空间；确认后进入新秀选秀准备，亦可重新进行扩军选秀 | 未确认摘要前，选秀服务拒绝准备指令；重复确认保持幂等。依赖存档检查点与薪资表。 |
| F10 新秀选秀准备与选秀前交易 | 第四阶段“首届／新赛季选秀”；`src/app/Stage4Flow.tsx`、`src/game/draft/DraftService.ts` | 扩军名单、赛季、持有选秀权、乐透权重和候选生成器；`ROOKIE_DRAFT_PENDING` 或 `OFFSEASON_PRE_DRAFT` | 查看扩军选秀回顾、本队持签与乐透概率；非首届可打开选秀前交易中心；确认名单／生成选秀班→进入乐透或选秀大厅 | 指令失败不推进；依赖扩军、年度滚动、交易、选秀权和检查点。 |
| F10a 非首届选秀乐透公布 | 选秀准备后乐透揭晓页；`src/app/DraftLotteryScreen.tsx`、`DraftService.ts` | 按战绩和抽签种子生成的首轮顺位及当前持有人；非首届、`DRAFT` 首签未选且未确认乐透 | 点击“开始抽签”后倒序揭晓；可公布全部、重播当前结果，或完播激励视频后生成并保存新的乐透顺位；确认后进入选秀大厅 | 未全部公布时确认按钮禁用，重抽结果须与前次不同；选人／AI 逐签／快进受引擎门禁；约减动画系统设置下点击开始后直接展示；依赖战绩、选秀权交易、虎扑激励视频和抽签服务。 |
| F11 新秀选秀大厅 | “NBA 选秀大会”；`Stage4Flow.tsx`、`DraftService.ts` | 签位顺序、新秀池、球探信息；`DRAFT` | 按位置筛选、打开候选详情、玩家签位选择；电脑签位自动／暂停模拟，或快进至玩家签；完成后生成新秀合同 | 非玩家回合选人禁用；重复签位由命令校验；候选球员可借激励视频解锁 OVR；依赖广告、选秀权和合同。 |
| F12 选秀结果 | 选秀后休赛期“查看完整选秀结果”；`Stage4Flow.tsx` | 已完成签位及球队球员；选秀完成 | 打开结果弹窗按顺位看球队、球员、前三顺位标识；同时查看本队新秀与薪资摘要 | 缺失球员用占位文字；依赖新秀合同和球员池。 |

## 合同、自由市场、交易和阵容

| ID／功能 | 入口页面、相关代码 | 使用的数据；前置条件 | 操作流程与结果 | 异常情况；跨模块依赖 |
|---|---|---|---|---|
| F13 年度合同选项和滚动 | 赛季结束“进入下一联盟年度”→第四阶段球队选项；`App.tsx`、`Stage4Flow.tsx`、`src/game/contracts/ContractLifecycleService.ts` | 合同年表、球队／球员选项、Bird 年限、球员成长和退役；`OFFSEASON` | 滚动联盟年→对待决球队选项执行或放弃→全部处理后完成选项阶段 | 待决项存在时完成按钮禁用；事务失败停留原状态；影响自由市场、Cap Hold、新秀阶段和球员生命周期。 |
| F14 RFA 资质报价 | 选秀后“资质报价决策”；`Stage4Flow.tsx`、`src/game/freeAgency/FreeAgencyService.ts` | 待决 RFA、资质报价金额、Bird／Cap Hold；选秀结束且尚未开启市场 | 逐人“提交 QO”或“不提交”→全部决定后可进入自由市场 | 未处理完不能进入市场；决定影响 RFA 匹配权、自由球员状态与帽占用。 |
| F15 休赛期自由球员浏览 | 第四阶段“自由球员签约”；`Stage4Flow.tsx`、`PlayerListFilters.tsx`、`FreeAgencyService.ts` | 自由球员、参考估值、随无合格报价天数变化的当前要价、实时薪资表、报价状态；市场已开启 | 搜索、位置／当前要价排序，查看详情、阵容和近期交易动态 | 球员不在市场、名单满、RFA 匹配等待等会禁用报价；空态显示；依赖合同、名单、Cap Hold。 |
| F16 定制合同报价、撤回 | 休赛期球员行“发起报价”及报价弹窗；`Stage4Flow.tsx`、`src/app/FreeAgentOfferDialog.tsx`、`FreeAgencyService.ts` | 年限、首年薪资、涨幅、保障比例、末年选项、承诺角色及报价预览；球员可报价 | 调参数看即时校验和年表→提交→行内显示待决定／期限；已提交可撤回 | 预览非法时提交禁用；过期／拒绝显示状态；依赖工资帽、阵容、球员偏好和市场决策。 |
| F17 自由市场逐日结算与 RFA 匹配 | 休赛期“结算今日”和底部 RFA 决策；`Stage4Flow.tsx`、`FreeAgencyService.ts` | 当前市场日、报价集合、累计无合格报价天数、RFA 决策；市场开放 | 每日结算推动签约、拒绝和到期，并按需求变化重算活跃报价；有原队匹配请求时选匹配／放弃；匹配期限为收到日 + 2，可结束市场并撤回待定报价 | 待决 RFA 时日结算和关闭按钮禁用；依赖薪资及名单名额。 |
| F18 赛季中自由市场 | 常规赛“市场→自由球员”；`src/app/RegularSeasonFreeAgents.tsx`、`FreeAgentOfferDialog.tsx`、`FreeAgencyService.ts` | 当前 UFA、当前要价与参考估值、将到期球员预测、现有报价；赛季期 | 切当前／休赛期到期，搜索／位置／当前要价排序，查看详情；仅当前 UFA 可发或撤回报价，下一日历日（含休息日）结算 | RFA 不可赛季中报价；名单满禁用；预测到期视图只读；依赖日期推进和合同。 |
| F19 交易询价与接受 | 常规赛“市场→交易”；`Stage4Flow.tsx` 的 `TradeDesk`、`src/app/TradeOfferDetail.tsx`、`src/game/trade/TradeService.ts`、`TradeAvailabilityService.ts` | 本队球员和可交易选秀权、对方球员、AI 报价、工资匹配、球队适配度；交易窗口开放 | 可编辑我方筹码获取报价；也可按球队、位置、姓名搜索对方球员，查看总评，勾选同队最多 3 人，让对方提出索要我方资产的报价；非卖品显示“无法询价”；目标球员列表随整页滚动，选中球员后报价按钮保持在底部导航上方；目标询价的每条回应使用该方案中对方索要的我方最高总评球员头像；仅索要选秀权时显示签位占位符；打开方案查看合法性与影响，接受后提交交易 | 空筹码、跨队目标、过期合同、非卖品、失效报价、交易窗口关闭或规则不合法不能成交；刷新报价需激励视频；依赖工资帽、名单、选秀权、AI 估值。普通非卖品由公开能力、价值和球队方向计算；字母哥、库里、伦纳德、詹姆斯、杜兰特、恩比德、杰伦·布朗在 AI 球队时优先保护；固定名单不会挤掉球队原本公开估值最高的非卖品。最终成交及 AI 交易同样受硬门禁约束。 |
| F20 交易记录 | “市场→交易记录”；`src/app/MarketTradeRecords.tsx` | 用户交易史与 AI 交易日志；常规赛导航可用 | 列出既往交易；只读 | 无交易显示空态；依赖交易服务和生涯记录。 |
| F21 季前训练重点 | 第四阶段季前准备；`Stage4Flow.tsx`、`src/game/roster/RosterService.ts`、`src/game/development/PlayerDevelopmentService.ts` | 球员年龄、训练名额和 `trainingPlan`；`PRESEASON` | 在球员行选择综合／专项／不指定→保存训练计划，年末参与成长结算 | 名额满或结算时满 30 岁的选项禁用；依赖成长、年龄和年度滚动。 |
| F22 季前裁员与开季名单锁定 | 季前准备；`Stage4Flow.tsx`、`RosterService.ts` | 球队阵容、名单上下限、保障金额；`PRESEASON` | 查看阵容，确认弹窗裁员，名单满足上限后锁定并进入赛季开场 | 人数低于最低值时裁员禁用；超上限不能锁定；底层可能自动补齐最低人数；依赖死钱和自由球员池。 |
| F23 赛季阵容与轮换 | “管理→阵容轮换”；`App.tsx`、`src/app/RotationEditor.tsx`、`src/game/roster/RotationPlanService.ts` | 球员可用状态、首发、替补顺位、目标分钟；常规赛／季后赛 | 两人点击互换位置或顺位，逐人加减或输入分钟，自动匹配或保存方案 | 240 分钟／首发／个人上限不合法时保存禁用；可用球员不足时显示补员提示；伤病手动调整需要保存才能解除事件；依赖比赛模拟。 |
| F24 管理概览、合同和薪资 | “管理→概览／合同薪资”；`src/app/ManagementPages.tsx`、`src/game/cap/CapSheetService.ts` | 战绩、总评、适配、球员赛季统计、合同年表、死钱及帽占用；常规赛 | 概览按位置和分钟／得分／OVR 排序，点球员看详情；合同页查看帽线、构成、球员合同 | 无统计空态；帽上空间可显示负数；属于只读视图，依赖比赛、合同和帽规则。 |
| F25 常规赛裁员 | “管理→合同薪资→裁员”；`ManagementPages.tsx`、`RosterService.ts` | 球员合同和剩余保障金额；仅常规赛交易阶段开放 | 打开确认弹窗→裁员→球员转自由球员、保障额计死钱 | 名单处于紧急目标下限时禁用；其他阶段按钮不显示；依赖工资帽与自由市场。 |
| F26 选秀权资产 | “管理→选秀权”；`ManagementPages.tsx` | `draftPicks`、原属球队、现持有人、承诺标记；常规赛 | 按年份查看首轮／次轮签及是否已承诺；只读 | 无资产空态；依赖交易和选秀。 |

## 赛程、比赛、事件与联盟

| ID／功能 | 入口页面、相关代码 | 使用的数据；前置条件 | 操作流程与结果 | 异常情况；跨模块依赖 |
|---|---|---|---|---|
| F27 赛季开场 | 锁定名单后开场页；`src/app/SeasonOpeningScreen.tsx`、`src/game/events/EventService.ts` | 开场事件、赛季和名单；开场事件待确认 | 点击“进入常规赛”→确认事件并显示赛季中心 | 忙碌时禁用；依赖事件队列。 |
| F28 赛季中心与日历 | 五栏“赛季”；`App.tsx`、`src/app/seasonCommandView.ts` | 赛程、日期、战绩和近期赛果；常规赛 | 逐月、今天、选日期、看下一场对阵、首发对位、近期赛果和伤病 | 已结算比赛可打开详情；无下一场则显示季后赛／年度切换；依赖赛程和比赛结果。 |
| F29 日期和比赛模拟 | 赛季中心“模拟下一场比赛”“推进 1 天”“连续模拟 5 场”“模拟至选定日期”；`App.tsx`、`src/game/season/career.ts`、`src/game/simulation/*` | 当前日期、未结算赛程、轮换、事件和伤病；常规赛未完 | 逐日模拟并播放日历动画→更新比赛、战绩、统计、事件并自动保存 | 阻塞事件／重伤决策／紧急名单时禁用或停止；没有可推进日期给状态提示；依赖全联盟比赛和存档。 |
| F30 更多模拟入口 | 赛季旧版区块“更多模拟选项”；`App.tsx`、`career.ts` | 下一经理事件、赛程完成状态；常规赛 | 模拟到下一事件或完成常规赛→进入季后赛结算准备 | 事件和伤病阻塞时禁用；该区块带 `legacy-season-block`，实际可见性需 UI 验证。 |
| F31 比赛详情 | 日历已赛场次／近期赛果／生涯历史；`App.tsx` 的 `GameDetailModal` | `userGameDetails`、球队、球员、分节和 box score；存在详细赛果 | 打开全屏赛后页，看比分、节次、MVP、两队球员数据并切换球队 | 旧档缺分节／box 数据时显示占位；全联盟赛程只给轻量比分，不一定可打开完整详情。 |
| F32 伤病与紧急补员 | 赛季伤病卡／紧急名单告警；`App.tsx`、`src/game/simulation/injuries.ts`、`src/game/injuries/EmergencyRosterService.ts` | 伤病剩余日数、赛程预计缺席场次、可用球员、当前名单；模拟触发不足 | 查看伤病球员与预计恢复时间，日历日和休赛期自由市场日自动恢复，点击自动补齐最低可用人数→继续模拟 | 补员失败状态不更新；旧存档按缺阵场数估算剩余日数；依赖自由球员、底薪、轮换重排和存档。 |
| F33 随机事件决策 | 自动弹出事件卡；`App.tsx` 的 `EventCard`、`src/game/events/EventService.ts`、`src/data/events.ts` | 事件队列、事件选项和影响；有待决事件 | 选确认或多选项→立即更新士气、状态、球迷支持、声望或日志；逐个处理队列 | 强制事件不可 Escape 关闭；伤病手动调整需转管理页保存轮换；指令失败弹错误；依赖模拟推进。 |
| F34 季后赛结算与对阵图 | 常规赛末“结算季后赛”及“查看季后赛对阵图”；`App.tsx`、`src/app/SeasonResultsPanel.tsx`、`src/app/seasonResultsView.ts`、`src/game/season/career.ts` | 联盟战绩、附加赛与系列赛、奖项候选；全部常规赛已完成 | 常规赛完结后可预览奖项及东／西部、总决赛对阵席位；一次触发季后赛模拟→生成冠军和系列赛最终比分，弹窗可切对阵分栏 | 未完成赛程无结算按钮；事务失败不更新；历史赛果资料缺项时可能显示待定；依赖排名、比赛、奖项、生涯历史。 |
| F35 联盟排名与球队详情 | “联盟→联盟排名”；`src/app/StandingsPanel.tsx`、`App.tsx` | 东西部和分区战绩、胜率、落后场次、连胜；常规赛导航 | 切东部／西部／分区，点击球队打开阵容弹窗；本队可跳阵容管理 | 排名统计无比赛时仍需展示；依赖赛程战绩和球队名单。 |
| F36 联盟数据榜单、奖项候选 | “联盟→数据榜单／奖项竞争”；`src/app/LeagueLeadersPanel.tsx`、`src/app/LeagueAwardsPanel.tsx` | 球员赛季数据、战绩、奖项候选；常规赛导航 | 看五项数据前五名与奖项候选，点击球员看详情；正式奖项在季末结算 | 无有效球员显示空态；依赖比赛统计与奖项服务。 |
| F37 全联盟赛程赛果 | “联盟→赛程赛果”；`src/app/LeagueSchedulePanel.tsx` | 全部赛程、轻量结果和当前日期；常规赛导航 | 前后切比赛日或回当前日→看当天双方及比分，玩家比赛优先排列 | 无赛程为空态；只读，不提供全联盟比赛详情。 |
| F38 球员／球队详情 | 各球员行、对阵和排名；`src/app/ReferencePlayerCard.tsx`、`src/app/TeamRosterPanel.tsx`、`App.tsx` | 球员属性、身高体重、合同、肖像、球队轮换；有可选实体 | 打开详情弹窗，球队阵容按首发／轮换／其他和位置筛选，点球员继续看资料 | 球员肖像失败回退；无可用球员时首发推算受限；依赖球员评分与阵容计划。 |

## 生涯、存档与平台

| ID／功能 | 入口页面、相关代码 | 使用的数据；前置条件 | 操作流程与结果 | 异常情况；跨模块依赖 |
|---|---|---|---|---|
| F39 生涯总览与分享 | “生涯→生涯总览”；`src/app/CareerPages.tsx`、`src/app/careerShare.ts` | GM 战绩、王朝分、球队纪录；常规赛导航 | 看 GM 等级、荣誉与经营数字；点击“一键发帖分享”调起虎扑发帖编辑器 | 平台能力失败可能提示；依赖赛季历史和 App 容器。 |
| F40 成就系统 | “生涯→成就系统”；`CareerPages.tsx`、`src/game/career/AchievementService.ts` | 成就解锁状态、分类和进度；常规赛导航 | 按全部／已解锁／未解锁筛选并看达成条件、进度 | 无匹配项为空态；依赖扩军、胜场、季后赛等跨模块事件。 |
| F41 球队历史、里程碑、荣誉 | “生涯→球队历史／里程碑”；`CareerPages.tsx`、`src/game/career/CareerRecords.ts`、`FranchiseStats.ts` | 历季战绩、冠军、获奖者、关键比赛、队史球员累计统计；已有生涯状态 | 按赛季看战绩与赛果、点比赛或球员；里程碑时间线和历季获奖者 | 首季未结束时历史内容有限；缺失球员资料时显示留存名称；依赖比赛和年度结算。 |
| F42 球员成长、衰退、退役、名人堂 | 年度合同选项摘要及本队总评变化；`Stage4Flow.tsx`、`src/app/SeasonOverallChanges.tsx`、`src/game/development/PlayerDevelopmentService.ts` | 球员年龄、潜力、训练计划、生涯累计数据；年度滚动 | 系统年度结算成长／衰退／退役，摘要显示人数与联盟 OVR 均值；本队在队球员展示前后 OVR 和提升／下降／持平；符合条件者记录名人堂 | 无直接玩家操作按钮；详细公式和入堂资格需独立规则文档；依赖训练、合同与生涯。 |
| F43 游戏内存／读档与云冲突 | 顶部“设置→存/读档”及阶段页底部；`src/app/GameChrome.tsx`、`App.tsx`、`src/storage/SaveService.ts` | 本地三槽、云端存档、检查点、状态哈希；任何游戏阶段 | 保存／覆盖、读取指定槽或最近进度；自动提交后自动保存；冲突时选择保留本机或云端 | 空槽、旧虚构阵容档不兼容、云同步失败、本地／云冲突有提示；选择云端前备份本地冲突档。 |
| F44 球队通知 | 顶部铃铛；`GameChrome.tsx`、`src/game/notifications/TeamNotificationService.ts` | 未读和待处理通知；第四阶段与常规赛 | 打开通知抽屉、单条／全部标已读、待处理跳到相应页面 | 扩军界面未传通知入口；保存失败保留原状态；依赖事件、RFA 与存档。 |
| F45 玩家反馈 | 顶部“设置→玩家反馈”；`src/app/UserFeedbackDialog.tsx`、`src/app/userFeedback.ts` | 用户输入、虎扑登录态、风控与反馈接口；App 容器 | 输入 1–2000 字→鉴权与内容审核→提交反馈 | 未登录、非虎扑 App、审核拒绝、服务异常均提示；依赖平台能力。 |

## 观察范围和待补的 UI 证据

### 页面菜单与弹窗索引

| 界面区域 | 已盘点的控制与弹窗 | 功能编号／源码 |
| --- | --- | --- |
| 首页 | 新游戏、读取槽位、继续最近进度、覆盖确认；序章继续/跳过 | F01～F03；`Bootstrap.tsx`、`ExpansionCinematic.tsx` |
| 扩军与选秀 | 建队、权益、交易协议、名单筛选、候选详情、选签、检查点恢复；乐透开始/逐签揭晓/全部公布/重播/激励视频重抽/确认；新秀选秀大厅与结果弹窗 | F04～F12；`ExpansionFlow.tsx`、`DraftLotteryScreen.tsx`、`Stage4Flow.tsx` |
| 常规赛底栏 | 赛季、管理、市场、联盟、生涯五个一级菜单 | F18～F44；`GameChrome.tsx`、`App.tsx` |
| 赛季页 | 日历今天/前后月/选日期、首发对位弹窗、推进一天/模拟下一场/连续五场/指定日/下一事件/季后赛、赛后详情及客主数据切换 | F28～F31、F34；`App.tsx`、`StarterMatchup.tsx` |
| 管理页 | 概览、阵容轮换、合同薪资、选秀权；球员与球队详情、轮换编辑、裁员确认 | F23～F26、F38；`App.tsx`、`ManagementPages.tsx`、`RotationEditor.tsx` |
| 市场页 | 交易、自由球员、交易记录；筹码选择、询价、报价详情、签约参数弹窗、当前/到期筛选 | F16～F20；`App.tsx`、`TradeAssetPicker.tsx`、`TradeOfferDetail.tsx`、`FreeAgentOfferDialog.tsx` |
| 联盟页 | 排名西/东/分区、数据榜单、奖项竞争、全联盟赛程；球队与球员详情 | F35～F38；`App.tsx`、`StandingsPanel.tsx`、`LeagueLeadersPanel.tsx`、`LeagueAwardsPanel.tsx`、`LeagueSchedulePanel.tsx` |
| 生涯页 | 生涯总览、成就系统、球队历史、里程碑、分享 | F39～F42；`App.tsx`、`CareerPages.tsx` |
| 全局层 | 设置→存读档/玩家反馈、球队通知标记已读、云冲突保留本机/使用云端、随机事件选择、重大伤病/紧急补员 | F32、F33、F43～F45；`GameChrome.tsx`、`App.tsx`、`UserFeedbackDialog.tsx` |

该索引覆盖代码中的页面级菜单和有业务状态后果的控制。视觉状态、按钮禁用条件、每个弹窗的异常分支按对应功能行与 `TEST_MATRIX.md` 追踪；表内 UI 尚未逐项实际点击的项目不得当作 E2E 通过。

- 已逐页检查普通玩家可达的 `Bootstrap`、`ExpansionFlow`、`Stage4Flow`、`App` 及主要弹窗组件；`src/app/*.test.ts` 用作现有测试线索，未把断言视为产品确认。
- `docs/GAME_CONFIG.md`、`docs/TRADE_RULES.md`、`docs/UI_PROTOTYPE_BRIEF_V1.5.md`、数据管线文档与 `package.json` 已纳入来源索引；规则冲突应单独登记，不在本清单裁决。
- **UI 实操状态：部分已验证。** 阶段 0 已实际点击 F01、F03～F08 的前段，以及开发夹具中的 F24、F28、F31 和 F18 浏览视图；逐步证据见 `CURRENT_SPEC.md` 的“阶段 0 UI 实操补证”与 `TEST_MATRIX.md`。F09 摘要及确认跳转已用开发 UI 实操；F30 旧版区块显示、F43 云冲突及 F45 App 容器反馈仍待 UI 验证。
- “买断”在 `src/app` 未发现按钮或页面入口；不列为已实现可操作功能。Bird Rights、Cap Hold、工资帽、附加赛、选秀乐透、成长／退役主要为引擎状态及展示，不应被误读为已有独立操作页。
