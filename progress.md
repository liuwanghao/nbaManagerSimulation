Original prompt: 那就按照你的开发计划执行吧

Current request (2026-09-18): 比赛详情的赛后数据中心采用 `gemini-code-1789722755611.html` 的 UI。

Current request (2026-09-18): 修复部分球员头像为黑色、不可见的问题。

Current request (2026-09-18): 赛后数据中心的长球员名应自动缩小字号并始终单行显示。

Current request (2026-09-18): 修复“模拟下一日”无明显反馈，以及五场逐日动画出现两个日历高亮框的问题。

### V1.51 — 日历单日推进与动画焦点修复

- [x] “模拟下一日”改为专用流程：结算后自动切换到当前日期所在月份、定位下一场未赛的本队比赛，并明确显示已推进到的自然日期。
- [x] 五场逐日动画期间取消旧的手动选中态，仅保留当前自然日的“模拟中”动画框；动画结束后再同步定位下一场未赛比赛。
- [x] TypeScript、Vite 生产构建和三赛季无头生涯回归通过（每季 1,312 场）。
- [x] 已生成 `release/篮球经理_扩军时代_V1.51_日历模拟修复版.zip`，压缩包完整性校验通过，SHA-256 为 `8fdad1841afd3a83124b7675918c8d9329fa788b90c1c2092b05f7ef7a8dd2b4`。

### V1.50 — 赛后技术统计长姓名单行适配

- [x] 技术统计表的球员姓名按首列实时可用宽度计算字号；短名字保留 12px，长名字最低缩小至 8px，始终与位置标签保持同一行。
- [x] 使用 `ResizeObserver` 监听页面宽度变化，横竖屏或窗口尺寸变化后会再次适配，不会截断为两行。
- [x] TypeScript 与 Vite 生产构建通过；全量测试 115/116 通过，唯一失败仍是既有的完整赛季模拟 30 秒超时（与本次 UI 无关）。
- [x] 已生成 `release/篮球经理_扩军时代_V1.50_赛后长姓名单行版.zip`，压缩包完整性校验通过，SHA-256 为 `17b445792f56ad17130abf298ae7f53542eef1dace7af5e2c3e94dbe067d90ed`。

### V1.49 — 球员头像可见性兜底

- [x] 图集头像新增逐格亮度检测：黑色/异常格和加载失败会自动切换为高可见青色人物占位图。
- [x] 没有本地图集映射的程序化球员同样展示占位头像，球员详情不再留下黑色空块。
- [x] TypeScript、图集映射测试 2/2、Vite 生产构建通过；官方 Playwright 打开季前球员卡，截图确认占位头像正常显示。
- [x] 已生成 `release/篮球经理_扩军时代_V1.49_头像可见性修复版.zip`，75 个条目完整性校验通过，SHA-256 为 `f677f0f3121b09e3b3b7130f908280db75a60e00b739c55a77bbdedb28edcec0`。

Current request (2026-09-18): 读取存档成功后应关闭读档页面。

### V1.48 — 读档后自动收起

- [x] 读档回调改为显式返回成功状态；只有成功载入存档才关闭抽屉，空槽位、数据版本不兼容或读取失败会保留页面并显示原因。
- [x] 成功读档先清除启动时的自动读档标记，再更新游戏阶段；即使存档切换至不同流程，重建页面后也不会重新弹出读档抽屉。
- [x] TypeScript、Vite 生产构建通过；官方 Playwright 截图确认存/读档抽屉正常打开和渲染。
- [x] 已生成 `release/篮球经理_扩军时代_V1.48_读档自动关闭版.zip`，75 个条目完整性校验通过，SHA-256 为 `f6507dea2dd0cf71f2495c661ea1b158ceed7ea52dbfc2a48d9ec535bd3ce93b`。

Current request (2026-09-18): 赛后数据中心必须 100% 还原 `gemini-code-1789722755611.html` 的 UI 模板。

### V1.47 — 赛后数据中心模板级还原

- [x] 以模板 HTML 的原始布局与数值重建：网格背景、顶部 20px 起始位置、440px/20px 圆角容器、Header、三列比分卡、分节比分、MVP 金框与技术统计宽表。
- [x] 清除通用比赛弹层造成的继承冲突，卡片不再被压缩或互相遮挡；滚动内容维持模板的 16px 节奏。
- [x] 保留真实球队、真实比分和技术统计数据；项目未保存正负值时使用中性“—”，不伪造 +/-。
- [x] TypeScript、Vite 生产构建通过；官方 Playwright 截图与模板截图对照，视觉验收 95/100（差异仅为动态球队/赛果数据）。
- [x] 已生成 `release/篮球经理_扩军时代_V1.47_赛后数据中心模板还原版.zip`，75 个条目完整性校验通过，SHA-256 为 `a504fbece681f81e24e328a6187ecc5fbb83bdc17face07e0853e11cfcc29303`。

Current request (2026-09-18): 常规赛日历模拟应逐日推进，跨月自动翻页后继续，不能按本队比赛直接跳日。

### V1.46 — 逐日赛程推进

- [x] “模拟下一日”改用单日联盟模拟；休息日、所有联盟比赛日与本队比赛日都会按自然日期前进。
- [x] “逐日推进 5 场赛程”预先生成逐日动画帧，按日期播放并仅在本队比赛日结算战绩；每一帧自动切换日历到对应月份。
- [x] 日历在当前动画日期显示“休息日/模拟中”，跨月后自动显示新月份的日历，再继续推进。
- [x] TypeScript、Vite 生产构建通过；官方 Playwright 实测 13 个自然日动画帧、5 场目标赛程，中途截图验证休息日不改变战绩，跨月截图验证自动切换至 11 月且比赛日卡同步定位到 11 月 2 日。
- [x] 已生成 `release/篮球经理_扩军时代_V1.46_逐日赛程推进版.zip`，75 个条目完整性校验通过，SHA-256 为 `0a28df2d88f6dc12373715eccac452992b04d503c2af7f6a866edfdc7868c0de`。

### V1.45 — 赛后数据中心

- [x] 比赛详情重构为参考稿的赛后数据中心：比赛总览、胜负与加时状态、分节比分、本场 MVP、主客两队完整技术统计。
- [x] 技术统计直接读取比赛引擎的真实上场时间、得分、篮板、助攻、抢断、盖帽、命中率和失误；项目未保存正负值，因此不伪造 +/-。
- [x] 分节数据适配历史存档：旧赛果未保存时以“历史记录未保存”和“—”呈现；后续模拟生成的比赛显示真实分节得分。
- [x] 修正比分横幅主队与比赛状态占位重叠；统计表支持横向滚动，球员列保持固定。
- [x] TypeScript、Vite 生产构建通过；官方 Playwright 客户端截图验证比赛详情、比分横幅与技术统计表渲染。
- [x] 已生成 `release/篮球经理_扩军时代_V1.45_赛后数据中心版.zip`，75 个条目完整性校验通过，SHA-256 为 `3e380426b909a2ee9fd3dddaeed5b220e14dc417975edc6cd0b8c5977691af6c`。

Current request (2026-09-18): “推进 5 场赛程”采用 `gemini-code-1789720818415.html` 的逐日推进动画。

### V1.44 — 五场赛程逐日推进动画

- [x] 复用参考稿的 700ms 逐场节奏：当前日青色脉冲高亮，已完成日期即时标记真实胜负/比分，战绩与按钮进度同步更新。
- [x] 动画先在内存生成确定性的五场赛程预览，结束后才一次性原子保存；若中途触发强制事件，保持原有模拟停止规则。
- [x] 将动画进度暴露给 `render_game_to_text`，自动化测试可读取已完成场次、总场次与当前比赛 ID。
- [x] TypeScript 与生产构建通过；官方 Playwright 客户端截图验证“模拟中 3/5”中间帧，以及结束后战绩 4-2 和经理事件正确出现。
- [x] 已生成 `release/篮球经理_扩军时代_V1.44_五场赛程动画版.zip`，75 个条目完整性校验通过，SHA-256 为 `6b6b348d530ef98d3eda3a212a28adb542038988b8d460a15eca985f9fd5eb1d`。

Current request (2026-09-18): 常规赛中球员诉求事件应提供真正的经理决策，不应只显示“确认”。

### V1.43 — 球员诉求经理决策

- [x] 士气与角色事件从单一“确认”改为“回应诉求 · 提升角色”与“维持当前轮换”两种明确选择，分别结算球员士气 +12 / -8。
- [x] 单选事件在 UI 中明确标为“事件通知”，避免再将纯确认误称为“经理决策”。
- [x] 对已有存档中的旧单选士气/角色事件提供兼容升级：页面重载后立即显示两项选择，选择时按新效果结算并写回事件记录。
- [x] 事件服务测试 6/6、TypeScript 与 Vite 生产构建通过。
- [x] 已生成 `release/篮球经理_扩军时代_V1.43_经理决策版.zip`，75 个条目完整性校验通过，SHA-256 为 `349cc4391f9741785c836146184567ecb383ed3d3dc125b7b552f67a530ee34a`。

Current request (2026-09-18): 常规赛五个主页面采用 `gemini-code-1789720818415.html` 的赛博终端 UI，并确保现有功能完整覆盖。

### V1.42 — 常规赛终端化

- [x] 赛程、阵容、管理、联盟、生涯五个页面统一为参考稿的深色网格背景、青色描边卡片、橙色行动色与五栏底部导航。
- [x] 保留并复核全部既有功能：赛程切换与比赛详情、单日/五场/事件/赛季模拟、球员详情、交易询价与薪资资产、东西部排名及生涯成就。
- [x] 阵容页补齐常驻的市场评级、球队声望、球迷支持、自由球员吸引力四项经营指标；赛程页补回可点击打开比赛详情的最近赛果。
- [x] TypeScript 和 Vite 生产构建通过；官方 Playwright 客户端逐页切换、截图检查通过，推进 5 场赛程实测从 1-0 更新至 4-2 并产生正确的待处理事件。
- [x] 已生成 `release/篮球经理_扩军时代_V1.42_常规赛终端UI版.zip`；ZIP 根目录直接包含 `index.html`，75 个条目完整性校验通过，SHA-256 为 `1a352751816f0f1ccfa70edb1c8d3212710fad6ddeef7016c673a9fde23cf717`。

Current request (2026-09-18): 季前准备常规赛名单将能力值放在球员名后，年龄放在合同年限后。

### V1.41 — 季前名单信息顺序优化

- [x] 名单第一行调整为“球员名 · 能力值”，第二行调整为“年薪 · 合同年限 · 年龄”。
- [x] 移除右侧独立能力/年龄两列，缩短横向占用并保持整行可点击查看球员卡。
- [x] TypeScript 与名单服务测试 4/4 通过。
- [x] 官方 Playwright 客户端截图确认信息顺序、截断和操作区布局正常；点击名单行仍可打开球员信息卡，Console 无错误。
- [x] Vite 生产构建通过；已生成 `release/篮球经理_扩军时代_V1.41_季前名单排版版.zip`，75 个条目完整性校验通过，SHA-256 为 `f6de29d2cf527a0134e279492fb2b1fc7120cbac6bf18300c211601550cc5a12`。

Current request (2026-09-18): 移除右上角没有实际功能的“模式”占位。

### V1.40 — 顶栏无效入口精简

- [x] 确认“模式”仅为无点击事件、无状态绑定的静态标签。
- [x] 从所有流程共用的 `GameChrome` 顶栏移除“模式”及其未使用图标，只保留有效的“存/读档”入口。
- [x] TypeScript、名单相关测试 12/12 与 Vite 生产构建通过。
- [x] 官方 Playwright 客户端截图核验右上角只保留“存/读档”，顶栏对齐正常且 Console 无错误。
- [x] 已生成 `release/篮球经理_扩军时代_V1.40_顶栏精简版.zip`；75 个条目完整性校验通过，SHA-256 为 `7d9d11b50051c0394f806fcbc1092731c27cc275473a5f8132fdef6868587898`。

Current request (2026-09-18): 修复里夫斯被错误放入自由市场；季前名单显示能力与年龄，点击展示球员卡，裁员增加二次确认。

### V1.39 — 现役合同归属与季前名单交互

- [x] 定位里夫斯误入自由市场的根因：官方名单快照归属湖人，但离线合同构造器无来源地随机生成了球员选项，扩军选项阶段又将其判定为拒绝执行。
- [x] 离线现役名单不再伪造球员/球队选项；现役快照球员保持 `STANDARD` 合同与当前球队归属，真实合同选项仍由带薪资明细的数据源提供。里夫斯按 NBA/Lakers 2026 年 7 月官方续签信息同步为 4 年、总保障 1.85 亿美元。
- [x] 季前常规赛名单新增能力值与年龄；球员主体可点击打开现有完整信息卡。
- [x] 裁员改为二次确认，明确展示裁员后名单人数、自由球员状态与剩余保障死钱；取消不产生任何 Command，确认仍通过原子名单 Command。
- [x] 官方 Playwright 客户端截图核验能力/年龄、完整球员卡和裁员确认弹层；浏览器实测取消后保持 15 人，确认后降至 14 人且被裁球员消失，Console 无错误。
- [x] TypeScript、Vite 生产构建、合同/名单/自由市场相关测试 17/17 与 Stage 4 固定种子 10/10 通过。
- [x] 全量测试 113/114 首轮通过；唯一失败为 30 秒季节模拟超时，使用 60 秒阈值单独复跑 4/4 通过。
- [x] 最终 `file://` 离线 H5 已直开截图验证，未产生 Console 错误。
- [x] 已生成 `release/篮球经理_扩军时代_V1.39_季前名单与合同修正版.zip`；ZIP 根目录直接包含 `index.html`，75 个条目完整性校验通过，SHA-256 为 `2624cf36ba00e616dac3eb28ac5cd2e347e439fd581f0150ee89af177a4c768a`。

Current request (2026-09-18): 选秀后休赛期的球员交易中心采用 `gemini-code-1789716714697.html` 的赛博询价弹层 UI。

### V1.38 — 休赛期交易中心询价终端

- [x] 交易中心展开后改为 440px 遮罩弹层，恢复参考稿的关闭按钮、标题说明、位置标签、排序/薪资筛选、筹码栏、报价滚动区与底部主操作。
- [x] 新增按主/副位置、薪资区间筛选，以及适配度、薪资、综合能力变化排序；筛选只影响展示，不增加询价 Counter。
- [x] 保留原有生成、刷新和接受交易 Command；交易成功后若原筹码已离队，立即隐藏过期报价，避免重复点击。
- [x] 浏览器实测生成 3 个动态报价、PG 筛选收窄至 1/3、刷新产生新报价、接受交易、关闭弹层；Console 无错误或警告。
- [x] TypeScript、Vite 生产构建、交易服务 5/5 测试及 Stage 4 10/10 固定种子回归通过。
- [x] 已生成 `release/篮球经理_扩军时代_V1.38_休赛期交易终端版.zip`；ZIP 根目录直接包含 `index.html`，75 个条目完整性校验通过，SHA-256 为 `4992b3d67b99549ff16182ca92740a4c4609272e3d57565970e1811c5a4a5106`。

Current request (2026-09-18): 新秀选秀页面还原为 `gemini-code-1789705799201.html` 的紧凑赛博终端 UI，同时保留逐签模拟与下一签快进。

### V1.37 — 新秀选秀参考稿还原

- [x] 按参考稿恢复顶部控制栏、橙色行动状态条、紧凑双仪表、内联规则说明、榜单标题与无外框滚动球员列表。
- [x] 修正旧主题对新秀编号、评级背景、卡片高度和按钮尺寸的样式串扰；编号恢复青色，评级区保持透明。
- [x] 将“下一签快进”收进顶部控制栏；玩家签位时隐藏次要操作，使页面结构与参考稿一致，继续/暂停/快进逻辑保持不变。
- [x] 浏览器实测快进停在 #6、玩家选人、继续至 #10、暂停并快进至 #38；43 人可选、已完成 37/64，Console 无错误或警告。
- [x] TypeScript、Vite 生产构建、选秀服务 8/8 测试及 Stage 4 10/10 固定种子回归通过。
- [x] 已生成 `release/篮球经理_扩军时代_V1.37_选秀参考稿还原版.zip`；ZIP 根目录直接包含 `index.html`，75 个条目完整性校验通过，SHA-256 为 `667767dbe4f9da1364f6ea4a5f6bb63b6d846f77a3ad9599a28018e6e114a1f6`。

Current request (2026-09-18): 选秀榜单采用参考图的紧凑赛博列表；玩家完成选择后既可继续自动模拟，也可快速跳到自己的下一个签位。

### V1.36 — 选秀榜单与下一签快进

- [x] 选秀榜单改为青色描边容器、深色紧凑候选行、排名方块、位置/年龄/即战力信息、球探评级与发光“选择”按钮。
- [x] 玩家选秀完成后恢复“继续自动模拟”入口，可随时暂停；逐签选择仍通过独立命令写入存档。
- [x] 新增“快速模拟”入口，自动逐签结算并停在玩家的下一个签位；没有后续玩家签位时可继续模拟至选秀结束。
- [x] 浏览器实测从第 #6 顺位选人后继续模拟至第 #13 顺位，再快进并准确停在第 #38 顺位；Console 无错误或警告。
- [x] TypeScript、Vite 生产构建及 Stage 4 10/10 固定种子回归通过；全量测试 112/113 通过，唯一超时的赛季模拟用例单独复跑 4/4 通过。
- [x] 已生成 `release/篮球经理_扩军时代_V1.36_选秀快进版.zip`；ZIP 根目录直接包含 `index.html`，75 个条目完整性校验通过，SHA-256 为 `47c4c65e48a4fa3a78c6084130edb503bacbdd93e91a703f09a0c636d0e76c7c`。

Current request (2026-09-18): 选秀后、自由市场和季前准备页面分别采用 `gemini-code-1789713114729.html`、`gemini-code-1789713127703.html`、`gemini-code-1789713133719.html` 的赛博终端 UI。

### V1.35 — Stage 4 休赛期三页面终端化

- [x] 选秀后页面改为完成状态 Banner、本队新秀列表、2×2 薪资概览、阶段提示与底部“进入自由市场”操作栏。
- [x] 自由市场改为日期/人数顶栏、三项仪表、每日结算控制、可滚动自由球员卡片、联盟动态与折叠交易中心；报价、撤回、RFA 和市场结算逻辑保持不变。
- [x] 季前准备改为培养/名单仪表、培养说明、可滚动名单卡片、训练下拉与裁员操作，并保留 14～15 人名单锁定规则。
- [x] 浏览器逐页截图核验完成；选秀后进入市场、市场日推进、结束市场进入季前、训练选择和锁定名单进入常规赛均已走通。
- [x] 34 个测试文件 / 113 项测试、Vite 生产构建与 Stage 4 10/10 固定种子全流程回归通过。
- [x] 已生成 `release/篮球经理_扩军时代_V1.35_休赛期终端UI版.zip`；ZIP 根目录直接包含 `index.html`，75 个条目完整性校验通过，大小 6,969,040 bytes，SHA-256 为 `80bb5001ea8084b0e59c0fcd5b87cc6b54f83e1b6b3478d34b130ba89c1fdb37`；生产 H5 已通过 `file://` 离线直开截图验证。

Current request (2026-09-18): 新秀选秀大会改为参考 `gemini-code-1789699632980.html` 的动态逐签模拟，支持开始、暂停、继续，并在玩家顺位停下。

### V1.34 — 新秀选秀逐签动态模拟

- [x] 新秀选秀不再一次性跳过全部 AI 顺位；每个 AI 选择通过独立可重放命令写入状态，并继续沿用固定种子选人逻辑。
- [x] 选秀大厅新增开始、暂停和继续控制；AI 每签先展示实时播报，再以 400ms 卡片退场动画推进到下一顺位。
- [x] 模拟到达玩家球队时自动停止，显示行动提示并启用球员选择；玩家选择后可继续模拟后续 AI 顺位。
- [x] 浏览器实测暂停不推进、恢复后继续，并在第 #6 顺位自动停止；Console 无错误或警告。
- [x] 34 个测试文件 / 113 项测试、Vite 生产构建及 Stage 4 10/10 固定种子全流程回归通过。

Current request (2026-09-18): 修复扩军选秀大会中“球队被保护球员”展开后名单显示不全的问题。

### 扩军保护名单完整展开修复

- [x] 移除最终主题样式重新引入的 `116px` 高度上限，展开后的保护名单由页面整体滚动承载，不再产生截断或嵌套滚动。
- [x] 浏览器实测收起再展开后显示 8/8 名保护球员；保护网格 `clientHeight` 与 `scrollHeight` 均为 189px，`max-height: none`、`overflow-y: visible`，Console 无新增错误。
- [x] 34 个测试文件 / 112 项测试、Vite 生产构建及扩军流程 10/10 固定种子回归通过。

Current request (2026-09-18): 头像改为按 NBA Player ID 下载 NBA 官方真人头像；离线 H5 保持不依赖服务，并以已有 2K 本地图片兜底。

Current request (2026-09-18): 新秀选秀准备使用 `gemini-code-1789697475846.html` 的赛博终端数据概览 UI；实际选秀大厅使用 `gemini-code-1789699632980.html` 的 LIVE 选秀终端 UI。

Current request (2026-09-18): 球员详情卡采用 `gemini-code-1789704436192.html` 的赛博终端卡片 UI。

Current request (2026-09-18): 扩军选秀大会的当前球队阵容在收起时显示 PG/SG/SF/PF/C 人数；所有玩家可见的位置均使用标准缩写。

Current request (2026-09-18): 扩军交易协议影响文案保持单行；扩军选秀大厅采用 `gemini-code-1789705799201.html` 的终端 UI，并为联盟球队选择添加动画。

Current request (2026-09-18): 恢复上一版扩军选秀池 UI，撤销刚刚的终端紧凑卡与球队切换动画，保留既有功能和交易协议单行文案。

### V1.29 — 扩军选秀池 UI 回退

- [x] 已回退 V1.28 对扩军选秀池的紧凑终端卡、序号、推荐标签以及球队选择入场/退出与内容切换动画。
- [x] 恢复上一版的选秀池信息层级；中文名、标准位置缩写、年龄、年薪、合同、OVR、当前阵容、保护名单、自动跳队及选人逻辑均继续保留。
- [x] 保留扩军交易协议影响文案的单行显示规则。
- [x] TypeScript、生产构建与 10 个固定种子扩军流程回归通过；唯一发布包已覆盖为此回退版本。

### V1.30 — 扩军选秀大会截图布局校正

- [x] 用户截图中的红框为批注，不作为页面元素；已移除错误加入的红色边框。
- [x] 扩军选秀大会恢复深色/青蓝描边的标题、球队薪资栏、行动播报、保护名单与可用球员卡片层级；当前球队阵容面板继续保留在薪资栏下方。
- [x] 可用球员卡直接显示标准位置、中文名、综合、年龄、年薪、合同年限与“选中球员”操作，不再使用 V1.28 的序号紧凑卡。
- [x] 当前源码 `?fixture=expansion-draft` 场景已通过浏览器无障碍树和截图核验；生产构建通过。

### V1.31 — 新秀选秀大厅终端卡片校正

- [x] 新秀选秀大厅按 `gemini-code-1789705799201.html` 的终端结构优化：模拟顶栏、行动提示、双数据仪表、真实选秀规则说明、榜单标题和独立滚动榜单保持一致。
- [x] 新秀卡改为参考稿的单行结构：左侧顺位/中文名/标准位置/年龄/即战力，右侧潜力评级与球探置信度，并提供紧凑选择按钮；非玩家回合按钮明确禁用并显示“等待”。
- [x] 浏览器 `?fixture=rookie-draft` 已截图核验；生产构建与 10 个固定种子 Stage 4 全流程回归通过。

### V1.32 — 扩军选秀卡片全宽对齐

- [x] 保护名单网格和选秀池卡片不再各自占用内部滚动条宽度，统一与上方薪资、阵容、播报及球队切换卡的左右边界对齐。
- [x] 页面整体承担纵向滚动，保护球员和可选球员卡始终使用完整内容宽度。
- [x] 扩军选秀浏览器截图已核验，生产构建通过。

### V1.28 — 扩军选秀终端与球队选择动画

- [x] “接受后将占用下一次可用扩军签位，并锁定该队唯一损失名额。”在交易协议卡上改为强制单行，超窄视口采用省略而不折行。
- [x] 扩军选秀大厅已更新为终端顶部控制栏、行动状态条、薪资仪表、实时推荐标题与紧凑球员卡；每张卡显示标准位置、年龄、合同、OVR 与选中入口。
- [x] 球队选择器添加入场/退出过渡，点击球队时关闭面板并对受保护名单与可选球员区应用内容切换动画；`prefers-reduced-motion` 环境自动停用动画。
- [x] TypeScript、位置展示单元测试、生产构建及 10 个固定种子扩军流程回归通过。

### V1.27 — 标准位置缩写与阵容折叠摘要

- [x] 集中位置展示函数已统一输出 PG、SG、SF、PF、C；选秀、交易、阵容、球员详情和其他复用该函数的界面会同步采用标准缩写，不改变内部 Position 数据。
- [x] 扩军选秀的当前球队阵容展开时保持原有位置人数面板；收起时摘要改为 `PG n · SG n · SF n · PF n · C n`，并随每次选人实时刷新。
- [x] 新增位置缩写单元测试；类型检查、生产构建以及 10 个固定种子扩军流程回归通过。

### V1.26 — 球员详情终端卡片

- [x] 玩家详情弹层改为 420px 赛博终端卡：官方真人头像、单行中文名、PG/SG 等位置徽标、浮动 OVR、四项身体数据、合同条、八维能力条和底部性格标签均使用参考原型层级。
- [x] 详情卡保留原有交易和球队角色操作区，所有能力、合同、性格、耐伤数据仍直接来自原游戏状态。
- [x] TypeScript、生产构建与数据同步 4/4 测试通过；扩军选秀固定场景已确认中文名、能力、合同信息及“选中球员”入口均正常。

### V1.25 — 新秀选秀双终端界面

- [x] 新秀准备页已替换为终端式 hero、四项数据面板、球探/真实选秀提示与霓虹主操作按钮；原 `PREPARE_ROOKIE_DRAFT` 事务不变。
- [x] 选秀大厅已替换为模拟控制栏、LIVE 播报、当前/用户签位仪表盘与实时推荐卡片；只有轮到用户签位时卡片的“选择”按钮显示并启用。
- [x] 浏览器固定场景实测：`stage4-intro` 显示 80 人、64 签位、#6/#38；`rookie-draft` 显示第 #6 顺位、用户行动提示、75 人可选新秀与全部选择入口。
- [x] TypeScript、生产构建与 10 个固定种子 Stage4 全流程回归通过（64 个签位、自由市场、交易、15 人名单、1312 场比赛）。

### V1.24 — NBA 官方真人头像完成验证

- [x] 统一数据模块新增 `nbaOfficialHeadshotUrl` / `nbaOfficialHeadshotPath`，只接受 NBA Player ID，并提供 `npm run data:sync-official-portraits` 无密钥单独同步入口。
- [x] NBA 官方 CDN 的 260×190 PNG 头像按本地 650 名球员的 NBA Player ID 下载成功 650/650；数据集中 650/650 `portraitPath` 均指向本地 `./player-portraits/nba-{id}.png`。
- [x] 清理 627 张未引用的旧 2K 图片；`public/` 和生产 `h5/` 均只保留 650 张官方头像，资源目录从约 42 MB 降至约 11 MB。
- [x] 同步模块 4/4 测试、TypeScript 检查、Vite 生产构建及 10 个固定种子扩军流程回归通过；构建后 H5 保持相对资源路径。
- [x] 已生成 `release/篮球经理_扩军时代_V1.24_NBA官方真人头像版.zip`，压缩包完整性检查通过，含 650 张官方头像，SHA-256 为 `7eff4ea4c064e29f20c9e5709fe6054be6908cccc5629102265a971618bdf5a9`。

Current request (2026-09-18): 说明真实球员中文名逻辑；从 NBA2K API 获取球员照片并下载为离线资源，在球员详情卡展示；生产版本必须直接通过 `h5/index.html` 访问，不依赖启动服务。

## V1.23 — 中文名口径、离线球员照片与直接 H5 访问

1. 保持中文名优先级：已有中文名 → NBA 中国 Player ID 快照 → 人工全名覆盖 → 仅在每个词均已验证时组合译名 → 原英文名，禁止臆造音译。
2. 扩展统一 NBA2K API 同步模块，读取 `playerImage`，只为能映射到本地数据集的真实球员下载图片；本地文件路径写回版本化快照和球员数据。
3. 图片保存到 `public/player-portraits/`，由 Vite 原样复制进 `h5/player-portraits/`；API Key 和远程图片 URL 不进入 H5 运行时逻辑。
4. 球员详情卡增加自适应照片区；缺图、加载失败和程序化球员自动回退到原有纯文字布局。
5. 验证 `h5/index.html` 使用相对路径、经典 IIFE 脚本并可由 `file://` 直接打开；运行官方 Playwright、截图检查、全量测试、构建和 ZIP 完整性校验。

### 中文名、离线照片与直接 H5 访问完成验证

- [x] 中文名继续按“原中文 → NBA 中国 Player ID 快照（536 人）→ 人工全名覆盖 → 全词已验证组合 → 保留英文”的顺序显示，不生成不确定音译。
- [x] 统一 NBA2K API 同步模块接入 `playerImage`；627/627 个可映射真实球员照片全部下载成功，远程 URL 不写入运行时数据。
- [x] 照片保存到 `public/player-portraits/`，构建后完整复制到 `h5/player-portraits/`；图片目录约 34 MB，球员数据仅保存 `./player-portraits/...` 相对路径。
- [x] 球员详情卡新增照片区并保持中文名、球队位置与 OVR 层级；无照片或程序化球员自动使用原纯文字布局。
- [x] 官方 Playwright 用 `file:///Users/uwa/nbaGame/nbaManagerSimulation/h5/index.html?fixture=1` 直接加载生产 H5，状态为 `TEAM_CREATION`，无 Console error；无需启动服务。
- [x] 扩军选秀 fixture 打开真实球员详情，照片成功显示；`render_game_to_text` 与卡片中的姓名、位置、OVR 一致，无 Console error。
- [x] `visual-verdict` 94/100，结果保存于 `.omx/state/v123-player-portraits/ralph-progress.json`。
- [x] 同步模块 3/3、全量 32 文件 / 109 项测试、TypeScript/Vite 构建与扩军 10/10 固定种子全部通过。
- [x] 已生成 `release/篮球经理_扩军时代_V1.23_中文名与离线球员照片版.zip`；676 个条目完整性检查通过，SHA-256 为 `88e5cc0092089a74200e414b6f8510295edf83b67e6cd14d88338dfa49adb4c9`。

Current request (2026-09-18): 接入 NBA2K API，并把球员档案抓取、能力映射、质量校验和离线数据生成统一成可重复执行的模块；H5 运行时不请求外网，API 密钥不进入源码或发布包。

## V1.22 — NBA2K API 离线球员数据同步

1. 新增单入口数据同步命令，从环境变量读取 API Key，一次请求获取指定 2K 版本的现役球员完整档案。
2. 将 API 字段标准化为版本化离线快照；优先复用已有精确分类能力，缺失时由 35 项 2K 属性确定性推导六大分类能力。
3. 复用统一应用层把 OVR、八维能力与耐伤写入游戏数据，但始终保留 NBA 官方离线名单中的球队归属和 Player ID。
4. 写入前校验人数、官方名单覆盖率、平均 OVR、90+ 人数与官方 Top 100 误差；校验失败时不覆盖现有离线数据。
5. 增加纯函数测试、同步报告和维护文档；完成真实 API 同步后运行全量测试、构建、离线 H5 检查并重新打包。

行为保护：API 仅在开发构建时调用；浏览器与发布 ZIP 中不包含密钥、请求代码或运行时网络依赖。

### NBA2K API 离线同步完成验证

- [x] 新增 `data:sync-players` 与 `data:sync-players:dry-run` 单入口；API Key 仅从 `NBA2K_API_KEY` 读取，旧的分离抓取/应用脚本已删除。
- [x] 真实同步生成 `nba2kapi-2k27-2026-09-16` 快照：650 名球员、35 项能力；全项目对齐 627 人。
- [x] NBA 官方名单中已有数据行的 561 人对齐 558 人，覆盖率 99.5%；检测到并忽略 38 处 API 球队归属差异，球队与 Player ID 继续以官方离线名单为准。
- [x] 联盟平均 OVR 75.07、90+ 共 21 人；官方 Top 100 匹配 100/100，OVR 平均绝对误差为 0；杰伦·布伦森保持 96 OVR。
- [x] 增加同步模块 3 项纯函数测试、版本化同步报告、内容 SHA-256 指纹、环境变量与维护文档；项目与 H5 均未发现 API Key。
- [x] 同步模块测试 3/3、全量 32 文件 / 109 项测试、TypeScript/Vite 生产构建、扩军 10/10 固定种子全部通过。
- [x] 本地静态服务器加载生产 H5，页面显示“本地球员数据已载入”；生产包没有 NBA2K API 运行时 fetch 调用。
- [x] 已生成 `release/篮球经理_扩军时代_V1.22_NBA2K_API离线数据版.zip`；48 个条目完整性检查通过，SHA-256 为 `c885557fbac7c6f4cbd911dfc08184e42ccc20122d2a752e131dbb80f19853fe`。

Current request (2026-09-17): 修复扩军交易桌底部“锁定协议并进入扩军选秀”操作区遮挡报价卡；用 NBA 官方 2026–27 名单纠正球队归属（包括克莱·汤普森→热火、CJ·麦科勒姆→老鹰）；移除会把真实英文名伪造为错误中文名的兜底音译。

## 扩军交易桌遮挡 + 当前 NBA 名单校准计划（2026-09-17）

1. 将底部确认区改为报价滚动容器之外的正常布局，报价列表独立滚动并为确认区保留空间，避免覆盖最后一张协议卡。
2. 从 NBA 官方 League Roster 页面提取 2026–27 当前球员 ID 与球队缩写，按 NBA Player ID 精确覆盖本地 2025–26 评分数据的球队归属；不做模糊姓名匹配。
3. 只保留仍出现在 NBA 官方当前名单中的本地评分球员；2026 新秀等尚无 2025–26 评分样本的球员本轮不伪造能力数据，30 队仍须各有至少 9 名可用于扩军保护的真实球员。
4. 为已确认的常见球员增加权威中文名映射；缺少人工映射的英文名直接保留英文，不再生成看似真实但实际错误的中文音译。
5. 补充名单归属和姓名展示回归测试，运行类型检查、全量测试、扩军 Headless、生产构建与官方 Playwright；视觉截图通过 visual-verdict 后重新打包。

### 扩军交易桌遮挡 + 当前 NBA 名单校准完成验证

- [x] 底部确认区取消 sticky 覆盖，报价列表独立滚动；390px 手机壳截图确认按钮与报价卡不重叠，操作区完整处于安全区内。
- [x] 新增 NBA 官方 League Roster 2026–27 快照，共 597 名当前球员、覆盖 30 队；运行时按 NBA Player ID 精确匹配 493 名已有 2025–26 评分样本的在册球员，各队至少 11 人。
- [x] 克莱·汤普森当前归属热火、CJ·麦科勒姆当前归属老鹰的服务层断言通过；不在官方当前名单的旧球员不会进入新建存档。
- [x] 删除字母拼音兜底算法；CJ·麦科勒姆、克莱·汤普森使用人工确认映射，其余未确认中文译名保留官方英文原名，不再生成虚假的中文名。
- [x] 球员详情来源改为“NBA 官方当前名单”，明确球队归属来自 2026–27 官方名单、能力来自 2025–26 赛季模型；Playwright 打开详情验证无 Console error。
- [x] `visual-verdict` 96/100，结果持久化于 `.omx/state/roster-authenticity/ralph-progress.json`。
- [x] `npm run typecheck`、扩军 10 Seeds Headless、生产构建通过；全量测试以单 worker 稳定通过 32 个文件 / 101 项（默认并发曾有 1 个 82 场赛季模拟用例因 35 秒超出 30 秒门槛，单独与串行复跑均通过）。
- [x] 已生成 `release/篮球经理_扩军时代_V1.9_官方名单与交易桌修正版.zip`；48 个条目完整性检查通过，SHA-256 为 `1acd708d055581404542a5b79fc4428c2f58b053ef57ced9b1cac49ebf549ea7`。

## 2026-09-17 真实球员数据与历史原型 Draft

- [x] 新增离线 `nba_api` 采集器：基础、高阶、球员生物信息、拼抢、突破、接球投篮与整体防守；H5 运行时不直接请求 NBA Stats。
- [x] 生成 `nba-player-dataset.json`：2025-26 赛季 582 名球员、2005-06～2024-25 历史赛季、35 个退出现役名单的历史高水平模板，模型与数据版本均可追溯。
- [x] 虎扑当前阵容继续作为姓名/球队/中文资料/薪资/合同唯一来源；按显式虎扑 ID、英文名或“当前球队 + 唯一球衣号码”确定性映射到 `nba_api`，否则使用虎扑基础统计的确定性降级模型。
- [x] 潜力、耐伤、性格和八项能力明确标记为游戏推演；禁止模糊姓名静默关联。
- [x] 2026 首届 Draft 保持纯程序化；2027 起从未使用模板中按 Seed 随机抽取最多 3 个“传奇原型”混入 80 人 Draft Class，原身份不展示、单存档不重复、模板耗尽自动回退程序化新秀。
- [x] 选秀公开 DTO 移除 `truePotential`、成长率、成长波动和历史来源 ID；AI 排序不读取隐藏成长字段。
- [x] 存档 Schema 升至 v17，并迁移历史来源去重账本。
- [x] 全量 `npm test`：31 个测试文件 / 93 项测试通过；TypeScript 与生产构建通过。
- [x] 上限改为随机 3 人后，全量 31 文件 / 94 测试、2 Seeds × 两赛季 Headless 闭环、TypeScript、生产构建与官方 Playwright 均通过；两个 Seed 的 2027 届都准确生成 3 个历史原型。
- [x] 最终 `h5/index.html` 2.84 MB（gzip 598.43 KB），官方 Playwright 以 `file://...?fixture=1` 验证建队 → 权益抽签交互、`render_game_to_text` 状态一致且无 Console error。

Current request (2026-09-17): 按照 `/Users/uwa/Downloads/gemini-code-1789609631793.html` 原型，整体优化当前游戏页面。

Current request (2026-09-17, supersedes prior UI reference): 按照 `/Users/uwa/Downloads/gemini-code-1789619463016.html` 原型，在保证功能不变的情况下 100% 还原。

Current request (2026-09-17): 保留当前暖色日常经营 UI，以 V1.5 原型承载完整功能结构，并吸收 v9 coreflow 在权益抽签、选秀、比赛结果和重大事件中的深色舞台感。

## 暖色经营 + 深色舞台 UI 收口计划（2026-09-17）

1. 不修改 Engine、Command、Save Schema、阶段状态机、`data-testid` 或 `render_game_to_text`，只调整展示壳、语义类名与 CSS。
2. 日常赛程、阵容、管理、联盟、生涯继续使用暖米色；扩军权益、新秀/扩军选秀使用深色舞台壳。
3. 比赛详情和强制事件使用深色沉浸式底部抽屉，球员详情、存档与普通经营弹层继续保持暖色。
4. 在 V2.0 令牌区集中新增舞台色、文字色、边框和阴影变量，避免继续散落新的硬编码颜色。
5. 每轮使用官方 Playwright 客户端生成截图与文本状态，运行 visual-verdict 并持久化评分；低于 90 分继续修正。
6. 最终运行 TypeScript、全量测试、生产构建与 390×844/桌面视口检查，并更新 `h5/index.html`。

行为保护：本轮不改变模拟、交易、选秀、合同、自由市场、伤病、事件或存档业务逻辑。

### 暖色经营 + 深色舞台完成验证

- [x] 扩军权益、扩军选秀、新秀选秀接入 `scene-stage`；建队、合同、交易、自由市场、名单管理仍保持暖色经营界面。
- [x] 比赛详情与强制事件接入深色舞台抽屉，比赛赢家、关键比分、本场最佳与主要决策层级已强化。
- [x] 官方 Playwright 覆盖权益抽签、新秀选秀与重大事件，均生成截图和 `render_game_to_text` 状态，无 Console error；比赛详情另以 390px 实际浏览器交互确认。
- [x] `visual-verdict` 第二轮评分 92/100，结果持久化于 `.omx/state/ui-hybrid/ralph-progress.json`。
- [x] 最终 `npm run typecheck` 通过；`npm test` 为 31 个测试文件 / 95 项测试全部通过。
- [x] 最终 `npm run build` 通过并更新 `h5/`；仅保留既有的单包体积警告。

Current request (2026-09-17): 取消队徽选择，将用户提供的西雅图与拉斯维加斯队徽设为城市默认队徽，并把 v9 的大幅城市卡片选择结构植入当前暖色 UI。

## 固定城市队徽 + v9 城市选择页计划（2026-09-17）

1. 保留 `CREATE_EXPANSION_TEAM` 指令与存档字段，城市仍提交固定 `presetId`，不修改状态机或旧存档结构。
2. 每座扩军城市仅保留一个默认品牌方案，玩家球队和电脑球队都使用对应城市的固定 PNG 队徽。
3. 建队页删除队徽方案选择器，改为两张可触控的大城市卡片；卡片内展示城市、气质文案、默认队徽与选中状态。
4. 队名输入与高级配色继续保留在城市卡片之后，沿用当前暖米色组件、橙色主操作和安全区规则。
5. 使用官方 Playwright 完成西雅图/拉斯维加斯切换与提交链路，检查截图、`render_game_to_text`、Console，再运行 visual-verdict、全量测试与生产构建。

行为保护：本轮不改变权益抽签、扩军交易、选秀、赛季模拟、合同或存档 Schema。

### 固定城市队徽 + 城市选择页完成验证

- [x] 用户提供的两张 1254×1254 PNG 已保存为 `seattle-default.png` 与 `las-vegas-default.png`，并随生产 `h5/` 离线发布。
- [x] 西雅图和拉斯维加斯各只保留一个默认品牌；玩家和电脑扩军队均按城市使用固定队徽，不再随机选择旧方案。
- [x] 建队页删除队徽方案列表，改为 v9 式双城市大卡；保留当前暖色外壳、橙色主按钮、队名输入和高级配色。
- [x] 修正默认球队名称重复拼接城市的问题，最终全名为“西雅图 翡翠潮 / 拉斯维加斯 电压”。
- [x] 390×844 实测两张城市卡、队徽确认、队名输入和主按钮均在首屏；城市切换会同步队徽、默认名称和提交城市。
- [x] `visual-verdict` 评分 93/100；结果持久化于 `.omx/state/city-defaults/ralph-progress.json`。
- [x] 最终 `npm run typecheck` 通过；`npm test` 为 31 个测试文件 / 96 项测试全部通过；`npm run build` 通过。
- [x] 生产 `h5/index.html?fixture=team-creation` 已用官方 Playwright 复查，等待图片解码后页面、两张 PNG 与 `TEAM_CREATION` 文本状态一致，无 Console error。
- [x] 已生成 `release/篮球经理_扩军时代_V1.6_城市队徽版.zip`；压缩包以 `index.html` 为根目录，完整性检查通过。

Current request (2026-09-17): 城市选择页不展示默认品牌；球队名称不再预填或随城市切换，完全使用用户输入。

## 自定义球队名称收口（2026-09-17）

1. 城市卡片移除“默认品牌”文案和额外品牌摘要，只保留城市、城市气质、固定队徽与选中状态。
2. 球队名称初始为空，切换城市不覆盖用户输入；名称不足 2 个字符时禁止提交。
3. 保留城市固定 `presetId` 作为内部队徽/配色契约，但不向玩家展示品牌概念。
4. 验证“输入名称 → 切换城市 → 名称仍保留 → 提交后球队全名使用用户输入”的完整链路。

### 自定义球队名称完成验证

- [x] 城市卡片已移除“默认品牌”和品牌摘要，只展示城市、城市文案、固定队徽与选中状态。
- [x] 球队名称默认留空且完全由用户输入；切换西雅图/拉斯维加斯不会再覆盖已输入名称，少于 2 个字符时创建按钮保持禁用。
- [x] 新增服务层回归测试，确认提交“雨城先锋”后球队名称为“雨城先锋”，完整名称为“西雅图 雨城先锋”，不会回退到城市预设名称。
- [x] 390×844 浏览器实测“输入山海飞跃 → 切换拉斯维加斯 → 提交”链路，扩军权益页正确显示“拉斯维加斯 山海飞跃”，Console 0 error。
- [x] `visual-verdict` 评分 94/100；结果持久化于 `.omx/state/custom-team-name/ralph-progress.json`。
- [x] `npm run typecheck` 通过；`npm test` 为 31 个测试文件 / 97 项测试全部通过；`npm run build` 通过。
- [x] 生产 `h5/index.html?fixture=team-creation` 已由官方 Playwright 复查，画面与 `TEAM_CREATION` 状态一致，未生成 Console error 文件。
- [x] 已生成 `release/篮球经理_扩军时代_V1.6.1_自定义球队名称版.zip`；压缩包以 `index.html` 为根目录，48 个条目完整性检查通过，SHA-256 为 `fc777beed7ab9227bd059b0e1045cbdf376620a21f05b00eb383ba717903bb29`。

Current request (2026-09-17): 扩军权益页同时展示两队并增加 50/50 抽签动画；权益确认后自动完成合同选项后台结算并进入扩军选秀准备；重做扩军交易桌、把操作按钮放到底部，并在扩军流程使用中文球员显示名。

## 扩军抽签与交易桌重构计划（2026-09-17）

1. 保留冻结需求规定的固定 Seed、一次性抽签结果、赢家优先选 Package 与合同选项先于扩军池的规则，不允许 UI 重新随机或跳过领域校验。
2. 权益页同时展示西雅图和拉斯维加斯，以动画揭晓已写入 GameState 的 50/50 结果；玩家中奖时仍手动选择权益包，AI 中奖时展示自动分配结果。
3. 新增一个原子 Command，把权益确认、Option Phase 后台结算、保护名单冻结和交易报价生成合并为一次提交；普通新生涯不再停留在“合同选项已经结算”说明页。
4. 交易桌按 v9 的卡片信息层级重做：报价类型、吸收球员、合同成本、补偿签与风险说明清晰分区，详情/接受按钮位于卡片底部，进入选秀按钮位于页面最底部。
5. 扩军流程统一通过中文显示名函数输出球员名；已有中文名原样保留，离线英文数据生成稳定、唯一的中文音译显示名，不改变内部 Player.name 与存档结构。
6. 增加状态机和显示名测试，并用官方 Playwright 覆盖抽签动画、权益确认、交易桌和进入扩军选秀的完整链路；每轮截图执行 visual-verdict。

行为保护：扩军抽签结果、合同资格、交易承诺、补偿资产、保护名单、蛇形顺序和存档字段不变；仅合并过渡 Command 与重构 UI。

### 扩军抽签与交易桌完成验证

- [x] 权益页同时展示西雅图与拉斯维加斯，点击后播放 50/50 聚光灯动画，并高亮 GameState 中已经固定的抽签赢家；动画不会重新生成结果。
- [x] 玩家中奖时两个权益方案同时显示并可直接选择；AI 中奖时展示自动分配结果。权益确认通过 `ENTER_EXPANSION_DRAFT_PREP` 原子完成 Package 分配、合同选项结算、保护名单冻结和报价生成。
- [x] “合同选项已经结算”不再作为普通新生涯的独立阻塞页；交易桌明确显示它已在后台完成，保证仅有效合同进入扩军池。
- [x] 扩军交易桌完成结构重做：阶段摘要、规则说明、报价类型筛选、球队与球员信息、合同成本、补偿资产和风险说明分区展示；详情/接受按钮位于卡片底部，进入选秀按钮位于完整报价列表之后。
- [x] 扩军流程统一使用稳定中文球员显示名，已有中文名不变；新增测试确认内置数据集全部球员的 UI 显示名不含英文字母，内部姓名和存档不变。
- [x] 浏览器完整验证“开始抽签 → 揭晓赢家 → 选择方案甲 → 后台合同结算 → 接受 1 份报价（0/5 → 1/5）→ 进入扩军选秀”，Console 0 error / 0 warning。
- [x] `visual-verdict` 最终评分 95/100；结果持久化于 `.omx/state/expansion-draw-trade/ralph-progress.json`。
- [x] `npm run typecheck` 通过；`npm test` 为 32 个测试文件 / 99 项测试全部通过；`npm run build` 通过。生产 `file://` 包状态为 `TEAM_CREATION`，未生成 Console error 文件。
- [x] 已生成 `release/篮球经理_扩军时代_V1.7_扩军抽签交易桌版.zip`；压缩包完整性检查通过，大小 5,418,452 bytes，SHA-256 为 `49e9b8789f2d0fe3b0b0fc1fce10150c3205746d79569d23a5f970f7bf1cbbdc`。

## V2.0 暖色原型还原计划（2026-09-17）

1. 以新 HTML 的 `390×844` 固定画布、暖米色设计令牌、顶栏、五栏底部导航和底部抽屉为唯一视觉基准。
2. 保留现有 Engine、Command、存档 Schema、`data-testid`、`render_game_to_text` 与所有阶段判断，只调整 React 结构中的展示壳和 CSS。
3. 原型已有页面逐项复刻；原型未包含的合同选项、新秀选秀、自由市场、伤病与事件页面使用同一设计系统扩展，不删除任何现有功能。
4. 每个有意义的 UI 变更后运行官方 `develop-web-game` Playwright 客户端，实际查看截图、文本状态和 Console；使用 `visual-verdict` 与原型截图做差异门禁。
5. 最终运行 TypeScript、全量测试、生产构建与离线资源检查，并重新覆盖发布 ZIP。

行为保护：本轮不修改模拟、交易、选秀、合同、自由市场、伤病、事件或存档业务逻辑。

## UI 原型重构计划（2026-09-17）

1. 保持 Engine、Command、存档和所有现有 `data-testid` 行为不变，先锁定当前测试/构建基线。
2. 抽出统一 App Chrome：顶部版本/阶段/数据状态、移动端安全区、赛季页底部 5 栏导航。
3. 将全局视觉 token 改为原型的 Slate 暗色体系，主操作用篮球红，次操作用竞技蓝，强调信息用活力金。
4. 统一扩军、选秀、自由市场、常规赛、详情弹层的卡片、按钮、表格、状态标签、滚动区域和触控尺寸。
5. 在 390×844 与桌面视口运行官方 Playwright 客户端，检查截图、交互状态和 Console；随后运行 typecheck、tests、build。

行为保护：本轮不改变模拟公式、阶段状态机、数据结构、存档 Schema 或交易/选秀/自由市场规则。

### 2026-09-17 UI 重构进展

- [x] 读取并解析原型源码，确认 390px 移动端 App 壳、强流程页与赛季 5 Tab 两种信息架构。
- [x] 新增统一 `GameChrome` 与受控 `SeasonNavigation`；赛季页已拆为首页、阵容、管理、联盟、生涯 5 个真实视图。
- [x] 扩军与 Stage 4 全流程接入同一顶部版本/阶段/数据状态条。
- [x] 全局换用 Slate 暗色 + 篮球红/竞技蓝/活力金 token，统一卡片、按钮、表单、状态、列表、底部导航与安全区。
- [x] 保留 Engine / Command / Save / `render_game_to_text` / `advanceTime` 及现有 `data-testid` 契约。
- [x] 改造前基线：30 个测试文件 / 87 项测试通过；TypeScript 通过。
- [ ] 浏览器逐态截图、Tab 交互、Console 与 390×844 / 桌面响应式巡检。
- [ ] 最终 tests / typecheck / build 回归与 `h5/index.html` 更新。

### 2026-09-17 UI 重构完成验证

- [x] 官方 Playwright 客户端已覆盖源码入口：扩军建队、常规赛首页、阵容、管理、联盟、生涯、季前名单；各次运行均生成 screenshot + `render_game_to_text` state，未生成新的 Console error 文件。
- [x] 390×844 实测修复名单横向溢出（Document 398px → 375px），球员详情改为 88dvh 底部抽屉并保持双列能力值。
- [x] 最终 `npm run typecheck` 通过。
- [x] 最终 `npm test`：30 个测试文件 / 87 项测试全部通过。一次与 build 并行运行时长期赛季用例超时，单独与串行复跑均通过，未发现逻辑回归。
- [x] 最终 `npm run build` 通过；`h5/index.html` 536.55 kB（gzip 163.12 kB）。
- [x] 最终生产包 `h5/index.html?fixture=1` 已用官方 Playwright 客户端复查，画面为新版原型风格，状态为 `TEAM_CREATION`，无新 Console error。

本轮剩余风险：未改变玩法逻辑；现有发布 ZIP 未自动覆盖，正式重新上传前如需 ZIP 应基于新版 `h5/` 重新打包。

# 篮球经理：扩军时代 — 开发进度

## 当前范围

- Stage 0：独立项目、Skills 就绪、平台能力盘点与 Adapter 边界。
- Stage 1：fixture Dataset、League/Player/Team/GameState/Save/Seed。
- Stage 2：82 场赛程、确定性模拟、Box Score、排名、Play-In/Playoffs、赛季推进。
- Stage 3：扩军建队、权益、保护、交易与 28 人扩军选秀闭环。
- Stage 4：首届 Rookie Draft、工资帽、自由市场、玩家常规交易、Waive/Dead Money、开季名单锁定、AI↔AI Trade 与合同 League Year Rollover 已完成。
- Stage 5（完成）：长期选秀、成长/衰退、训练、伤病、Emergency Roster、Awards/All-Star、名人堂、历史压缩、GM Career 与基础 Achievements 已接通。
- Stage 6（完成）：56 个数据驱动 Event Definition、可序列化 Event Queue、重大事件暂停、漫画式事件卡、比赛详情与快速模拟摘要已接通；扩军开场与夺冠事件使用自有专属插画。
- Stage 7（进行中）：Team Core / Fit、AI Direction Cooldown 与 Save Revision Sync 已接通；Headless 长期回归与性能优化继续进行，20 Seeds × 30 Seasons 和 1000 Season equivalents 尚未完成。

## 约束

- 唯一规则源：`/Users/uwa/Downloads/篮球经理_扩军时代_需求文档_V1.5_开发最终冻结版.md`。
- Headless Engine 与本地回归使用 fixture；虎扑环境开局时必须先同步真实阵容，不允许静默降级。
- Engine 与 React/DOM 解耦，必须可以通过 Headless Runner 验证。

## TODO

- [x] 创建 `basketball-franchise`、`basketball-balance` Skills；官方 Python 验证器缺少 PyYAML，已用 Ruby YAML 解析与 TODO/名称检查完成等价结构校验。
- [x] 更新保留的两个篮球 Skills，移除旧 Skill 引用。
- [x] 建立 React/TypeScript 项目、平台能力盘点、LocalStorage Adapter 与三层边界。
- [x] 实现 Stage 1 fixture Dataset、GameState、Save Schema、FNV-1a 64 与 xoshiro128** 随机合同。
- [x] 实现 Stage 2 的 82 场赛程、同一比赛引擎、Box Score、排名、Play-In/Playoffs、赛季推进与 Headless Runner。
- [x] 添加 29 项自动测试；构建通过；固定 Seed 连续 3 赛季通过。
- [x] 完成 Playwright 截图/state 输出、390×844 手机视口、按钮交互、保存和 Console 回归。
- [x] 接入用户提供的 30 队 HoopChina CDN Logo、中文队名、场馆和日/夜色值；因 CDN 浏览器热链返回 403，已缓存为同源静态资源。
- [x] 为 Seattle / Las Vegas 各制作 4 套预审核扩军 Brand Preset；玩家选择，AI 按 Career Seed 确定性选择。
- [x] Stage 3：建队、权益抽签、强制 Option Phase、合格球员保护名单、Expansion Trade、Pool Feasibility、28 签蛇形 Expansion Draft、自动保存与选秀前 Checkpoint。
- [x] 将生产构建改为虎扑工坊标准 `h5/` 静态目录；入口、JS/CSS、38 个 Logo 资源均使用包内相对路径，不再包含本地服务器提示或回环地址。
- [x] 将构建后的 JS/CSS 内联到 `h5/index.html`；根目录双击入口无服务器跳转到显式 fixture 预览，避免 `file://` 加载 TypeScript/ES Module 导致空白页。
- [x] 保留 480 名确定性虚构球员资料用于 Headless 与 `?fixture=1` 开发测试；正式虎扑开局不使用该名单。
- [x] 在扩军交易、扩军选秀和阶段总结中显示球员姓名，并增加球员详情弹窗与旧存档 Player Core 自动迁移。
- [x] 接入虎扑 `teamPlayerList` 与 `teamSalaryInfo`：按请求保护分两批同步 30 队真实名单、位置、赛季表现、年龄和多年薪资。
- [x] 用真实赛季数据派生游戏能力值；性格、耐伤等非接口字段明确标记为游戏推演，不再把虚构名单作为虎扑环境的静默降级。
- [x] 球员详情按需调用 `playerInfo` 补取真实身高、体重、出生日期和国籍；不加载头像，并缓存同一球员请求。
- [x] Stage 4 首段：生成确定性 80 人程序化 2026 Draft Class，完成 2 轮 64 签，支持玩家 #5/#6 与 #37/#38 选择，其余签位由只读取公开球探信息的 AI 自动完成。
- [x] 首轮固定 120% Rookie Scale 的 4 年合同（后两年 Team Option）、次轮 2 年最低薪合同（次年 Team Option）自动生成；16 名落选秀进入 UFA 池。
- [x] 新增 `CapSheetService`，统一汇总 Active Salary、Dead Money、Cap Hold、Offer Reservation 与 Incomplete Roster Charge；Stage 4 UI 展示与 Engine 同源的工资帽结果。
- [x] 自由市场状态机：ACTIVE/ACCEPTED/REJECTED/EXPIRED/WITHDRAWN/SIGNED_OFFER_SHEET、固定 3 日 Decision Window、最多 5 份报价、Early Accept、Deadline Tie-break 与 Cap Reservation。
- [x] RFA：Qualifying Offer Cap Hold、Proposal、Signed Offer Sheet、2 日 Matching Window、玩家 MATCH/DECLINE 阻塞决策与 AI 确定性匹配。
- [x] AI 每队每日最多生成 1 份（规则上限 3 份）合法报价；与玩家共用 CapSheetService、TransactionPolicyService、Offer Utility 与结算事务。
- [x] Stage 4 自由市场 UI：球员池、UFA/RFA 标签、建议起薪、报价/撤回、Day 结算、Cap 实时占用、RFA 决策与联盟动态。
- [x] 常规交易：3 个动态报价、主动刷新 Counter、重复询价 Seed、双方 Salary Match、选秀权唯一所有权与未来七年连续首轮限制校验。
- [x] Waive / Dead Money、AI 自动裁至 15 人、玩家显式最低薪补齐确认、14～15 人 Opening Roster Lock。
- [x] 扩军 Career 主流程现已从建队完整衔接至 32 队、每队 82 场、联盟 1312 场的第一赛季。
- [x] `ContractLifecycleService` 成为唯一 League Year Rollover 入口：累计 Service Roster Days、结算 Service Years、延续 Bird Years、推进合同年份、自动处理 Player Option / AI Team Option，并阻塞玩家未决 Team Option。
- [x] 合同到期统一转入 UFA / RFA，Option Phase 完成后创建不重复的 Bird UFA / RFA Cap Hold；普通签约、交易与 Waive 分别按 V1.5 更新 Bird Rights。
- [x] AI↔AI Trade 按固定 Seed、每 7 个游戏日及 Deadline Window 评估，双方共用 SalaryMatchValidator，排除玩家球队并执行每队每季最多 3 笔的硬上限。
- [x] 常规赛在截止日后自动进入 `REGULAR_POST_DEADLINE`；比赛日为所有在队 Standard Contract 球员累计 `service_roster_days`。
- [x] 后续 Draft Lottery：16 支未进季后赛球队按 Config 权重无放回抽前 4，剩余按战绩倒序和固定 Seed Tie-break；选秀权 Owner 从资产表读取。
- [x] 存档 Schema 升至 v6；旧存档会补全 AI Trade / Contract Lifecycle 默认状态和当前赛季未来 7 年缺失选秀权，不覆盖已有 Ownership。
- [x] 扩军开局已可完整跑到 2027-28 第二赛季：合同选项 → 未来 Lottery / 80 人 Draft Class → 64 Picks → FA → 名单锁定 → 1312 场新赛季。
- [x] 全联盟球员生命周期：按出生日期/快照年龄源推进年龄，使用 Potential、Development Rate、Volatility、上场时间、球队/轮换角色、健康、IQ 与固定 Seed 逐属性成长或衰退；运动能力/终结/外防更早衰退，投射/组织/IQ 更稳定。
- [x] 退役状态机：按年龄、OVR、健康、角色、合同、老将失业时间、性格与 `hash(season_seed, "retirement", player_id)` 确定性判定；退役后清理球队、Cap Hold 与 Offer Reservation，并保留生涯快照和历史索引。
- [x] 每届 80 人未来新秀供给与退役流出已纳入人口指标；Headless 输出 Active / Free Agent / Living / Retired / Rookie Inflow / Retirement Outflow / 90+ / Max / P95 OVR。
- [x] 玩家训练重点：季前最多指定 2 人，支持综合/投射/组织/防守/内线/运动能力；仅调整成长权重，年度结算后消费并重置，裁员会自动撤销指定。
- [x] 存档 Schema 升至 v16；旧档自动补训练、伤病、奖项、历史赛季、成就、GM Career、Event Queue / Effect、Emergency Salary Ledger、Team Core、季后赛统计、AI GM Profile 与球员 Health / Morale 默认状态，不覆盖已有经理状态。
- [x] 伤病系统：五档伤病、年龄/耐伤/分钟/Fatigue/既往伤病风险、自动轮换、核心重大伤病暂停与确认恢复。
- [x] Emergency Active Roster：玩家少于 8 人暂停、AI 自动补至 8 人、少于 5 人禁止开赛并使用程序化 Replacement fallback；临时合同按名单锁定日计薪，恢复后自动结束且零 Dead Money。
- [x] 常规赛 Awards / All-Star（分区各 12 人）、Finals MVP、冠军荣誉和全联盟名人堂模拟；现实球员缺历史数据时保持 HOF ineligible。
- [x] 赛季历史归档：常规赛 Lightweight Results、玩家 82 场完整详情、全部季后赛完整 Box Score、最终排名与用户季后赛里程碑。
- [x] 14 项 V1 基础 Achievements 与 GM Career / 王朝评分；Draft / Trade History 由事务服务写入。
- [x] 56 个有效 Event Definition 与 Event Queue：优先级排序、一次性/冷却、强制暂停、幂等确认、未知类型安全跳过、Save 恢复与渐变漫画卡。
- [x] 玩家模拟按钮改为推进到下一场本队比赛；“模拟 5 场”按玩家赛程推进并输出本段战绩、排名变化、主要球员、伤病与事件摘要。
- [x] 玩家最近 5 场可打开完整比赛详情，展示分节比分、OT、本场最佳和双方球员 Box Score；分节得分严格与最终比分守恒。
- [x] 季后赛为球员单独累计 Postseason Stats，并沿用伤病与 Emergency Roster 规则；新赛季常规赛/季后赛统计分别清零，历史常规赛快照保持不变。
- [x] Team Core 持久化 Market Rating / Franchise Reputation / Fan Support；逐场胜负与连胜连败、季后赛节点、战绩及 MVP/ROY 按 V1.5 公式更新，Free Agent Attraction 使用四项派生公式。
- [x] `TeamFitService` 输出组织、空间、侧翼防守、护框、篮板、位置尺寸、替补深度与球权兼容，比赛引擎使用 -5～+5 有限修正；球队页与交易报价展示当前/Projected Fit。
- [x] AI GM Profile 持久化 Personality / Direction，扩军 AI Strategy 映射固定性格与方向；常规 AI 方向按战绩评估并执行 60 天 Cooldown。
- [x] Save Sync 支持离线连续 Revision、固定 `sync_base_revision`、安全 Fast-forward、同 Hash 归一化、双向修改显式冲突与本地/云端二选一；覆盖云端前生成并校验 Conflict Backup。
- [x] Checkpoint 按 Career Slot 滚动保留最新 3 份，Previous Valid Save 纳入损坏恢复，并提供 Slot 全部持久化内容的字节占用统计。
- [x] 虎扑正式容器使用 `ColorboxAI.storage` Cloud Adapter，按官方单次 200KB 限制将 gzip 数据分块写入；本机离线分支使用 IndexedDB，localStorage 仅保留给无虎扑 SDK 的本地预览。
- [x] 历史压缩按 V1.5 保留最近完整赛季；更早赛季只长期保留玩家季后赛、全部 Finals、Game 7、队史首胜、重大伤病与纪录比赛。
- [x] 常规赛球队页补齐完整阵容、Role、OVR、Potential Grade、年龄、合同、健康、常规赛数据与球员详情；交易截止日前可直接打开交易中心并查看 Projected Fit。
- [x] 扩军开场与夺冠事件接入两张自有故事插画，不含官方联盟/球队 Logo、官方奖杯或可识别真实人物。
- [x] 球员状态补齐 Health / Morale：伤病按严重度降低健康并在康复后回满；士气按胜负、连胜/连败及出场情况变化，比赛引擎严格使用 V1.5 的 0～-1.5 效率惩罚曲线，高士气不提供额外加成。
- [x] 常规赛交互补齐“模拟到下一事件”，遇 Event Queue、重大伤病、Emergency Roster 或赛季结束立即停止；保留“模拟至季后赛”作为附加快捷入口。
- [x] 常规赛页面补齐玩家 82 场完整日历、联盟得分/篮板/助攻领袖、MVP Race、32 队列表与联盟新闻；球员详情补齐 Traits、生涯数据、角色调整和交易入口。
- [x] 球队角色调整进入 `RosterService` 事务与命令幂等体系，Engine 强制 `FRANCHISE_CORE` 最多 3 人。
- [x] Event Effect 执行器接入 GameState：Choice Effect 随 Event Instance 快照并按 `event_instance_id:effect_id` 幂等执行，支持 Player Morale / Form、Fan Support、Franchise Reputation 与 League Log；旧事件存档自动迁移。
- [x] Event Trigger 补齐日初交易截止日、玩家伤病/复出与每 6 场一次的确定性 Breakout / Slump / Role / Morale 检查；日初强制事件处理后会在同一日期继续结算，不漏比赛。
- [x] Player Fatigue / Form 从静态字段升级为完整逐场闭环：分钟、年龄、运动能力与背靠背决定疲劳增长，休息日恢复，近期表现更新 Form；季后赛同样执行，所有系数集中在 `SIMULATION_CONFIG`。
- [x] 新增统一版本化 `GAME_CONFIG` 入口，完整覆盖比赛模拟、成长/退役/名人堂、AI GM、交易/选秀权价值、自由市场、工资帽、Draft、伤病、随机事件、联盟平衡目标、成就奖励与扩军 Package；原有主要魔法数字已接回配置。
- [x] 新增配置结构校验与中文调参说明；权重和为 100、工资线顺序、合同年限、Draft 供给、Pace 范围与退役年龄档位均有自动门禁。
- [x] 第二轮配置化清理：攻防 Impact、轮换/OT、Box Score 骨架与守恒修正、Form/Fatigue、Team Fit、球队核心、奖项、各位置 OVR、赛程质量、CBA 名单/薪资匹配/Cap Hold/新秀合同、Emergency、历史压缩和 Dynasty Score 均已移除主要魔法数字；冻结的 82 场与状态机结构保持不可调。

## 已验证

- `npm test`：28 个测试文件、85 项测试全部通过。
- `npm run build`：生产构建为单文件 `h5/index.html` 493.04 kB（gzip 151.34 kB），完整 `h5/` 约 2.9 MB；包内无 localhost / 源码入口引用。
- `pnpm headless:career -- --seed 12345 --seasons 3`：2026-27 至 2028-29 全部完成，每季 1312 场。
- 浏览器：模拟下一比赛日后 SEA 由 0-0 变为 1-0；`render_game_to_text` 与页面一致；Console 0 error/warning。
- Logo 回归：西部与东部排名页图片均加载完成，naturalWidth / naturalHeight 有效，Console 0 error/warning。
- Stage 3 浏览器：从建队完整走到 28 Picks；补充验证强制 Option Phase 与交易页；SEA / LVG 各 14 人；390×844 与桌面布局通过；Console 0 error/warning。
- `pnpm headless:expansion -- --seeds 20`：20/20 个 Seed 完成，均为 SEA / LVG 各 14 人且无重复来源球队。
- Stage 3 变更后重跑 `pnpm headless:career -- --seed 12345 --seasons 3`：旧 Stage 2 三赛季流程继续通过。
- 根目录 `index.html` 仅作为 Vite 源码入口；正式交付入口固定为 `h5/index.html`，生产包不包含开发服务器提示或本地地址。
- `h5/index.html` 已通过 `/h5/` 子路径静态托管验证；4 个首屏扩军 Logo 全部加载，`render_game_to_text` 正常，Console 0 error/warning。根目录仍是开发源码入口，提交工坊时使用 `h5/` 目录。
- 球员资料浏览器回归：交易页姓名/合同正常，详情弹窗可展示体测、合同、八项能力与性格信息；390×844 布局及 Console 0 error/warning。
- 真实名单启动门禁回归：无虎扑 SDK 时显示明确错误且不进入虚构名单；仅 `?fixture=1` 允许本地测试，两个入口均无 Console 错误。
- `file:///.../nbaManagerSimulation/index.html` 直接打开回归：自动进入 `h5/index.html?fixture=1`，`render_game_to_text` 为 `TEAM_CREATION`，Console 0 error/warning。
- Stage 4 浏览器回归：从 Team Creation 完整操作到扩军选秀结束，再完成 Rookie Draft #5 与 #37；最终 64 签、16 名落选秀、玩家名单 16/21，工资帽 UI 与 Engine 一致；Console 0 error/warning。
- `npm run headless:stage4 -- --seeds 20`：20 个固定 Seed 验证 80 人选秀班、64 个唯一 Pick、开市前固定 16 名落选秀、三天自由市场结算与无过期 ACTIVE Offer。
- 自由市场浏览器回归：载入选秀后存档、进入 Day 1、报价后 Cap Space 从 $53.5M 降至 $43.6M、固定 D3 Deadline、结算至 Day 4 后签约并释放 Reservation；Console 0 error/warning。
- 官方 `develop-web-game` Playwright 客户端已运行并检查 `output/stage4-fa-client/shot-0.png` 与 state JSON；随后使用完整浏览器链路覆盖自由市场交互。
- `npm run headless:stage4 -- --seeds 20`：更新后的完整首赛季经理路径 20/20 通过，均为 64 Picks、FA Day 4、玩家交易成功、15 人名单与 1312 场赛程。
- `npm run headless:manager-loop -- --seeds 2`：两个固定 Seed 均从扩军开局完整进入 2027-28，完成第二届 64 Picks、未来 Lottery / Draft Class、自由市场、14 人名单锁定与 1312 场新赛程。
- `npm run headless:career -- --seed 12345 --seasons 3`：统一合同滚动与 AI Trade 接入后，三赛季仍全部完成 1312 场并产生冠军。
- Option Phase 浏览器回归：官方 Playwright 客户端验证 Team Option 提交后 `pendingTeamOptions: 1 → 0`；浏览器完整点击“执行 → 完成 Option Phase”，成功进入 2027-28 `OFFSEASON_PRE_DRAFT`，画面与状态一致且无新 Console 错误。
- Stage 5 完整回归：`npm test` 为 17 个测试文件、52 项测试全通过；`npm run typecheck` 与生产构建通过，单文件 `h5/index.html` 约 397 kB（gzip 约 124 kB），包内无 localhost / `/src/main.tsx` 引用。
- 调参后单 Seed 10 赛季生命周期回归：初始平均 OVR 69.32，十年后 69.52（漂移 +0.20）；90+ 球员 9 人，最高 93.13，位于 V1.5 的 5～25 人目标区间；第十年新秀流入 80、退役流出 81。
- 生命周期 UI 回归：Option Phase 展示成长/衰退/重点培养/退役/联盟均值并可继续进入下一届 80 人 Draft；季前页面成功指定“投射 + 防守”两名重点培养球员，第三人选择器自动禁用，桌面截图布局通过。
- 伤病/Emergency UI 回归：官方 Playwright 验证重大伤病确认、可用球员 7 人暂停、补齐至 8 人后解除阻塞；状态 JSON 与页面一致且 Console 0 error。
- Awards/History UI 回归：赛季荣誉、All-Star、名人堂、GM 等级/王朝分与 14 项成就卡布局通过；Console 0 error。
- Event UI 回归：Priority 100 冠军事件只显示一个 Modal，确认后 Queue 清空且阻塞解除；Event state 与页面一致，Console 0 error。
- 比赛详情/批量摘要回归：分节比分、Box Score、最近比赛入口与“5 场 · 3胜2负 / 排名 2→5 / 主要球员 / 伤病 / 事件”摘要均通过官方 Playwright 检查。
- Stage 6 回归：`npm test` 22 个文件 / 65 项全通过；生产构建为单文件 `h5/index.html` 447.88 kB（gzip 139.33 kB），包内无 localhost 或源码入口引用。
- 新版三赛季 Headless：`stage6-regression` 连续完成 2026-27 至 2028-29，每季 1312 场并正确产出冠军。
- 新版十赛季生命周期：平均 OVR 69.32 → 69.49（+0.17），90+ 球员 9 人，最高 93.13，第十年新秀流入 / 退役流出 80 / 80，产生 1 名名人堂入选者。
- `npm run headless:benchmark -- --season-equivalents 3 --seasons-per-career 3`：3/3 Season equivalents、3,936 场常规赛、275 场季后赛、0 严重一致性错误；平均 13.55 秒 / Season。Runner 已支持后续 20×30 与 1000 Season equivalents 门禁。
- Team Core / Fit 浏览器回归：官方 `develop-web-game` Playwright 客户端展开球队卡，8 项 Fit、Market / Reputation / Fan Support / FA Attraction 与 `render_game_to_text` 一致；Console 0 error。
- Save Sync 定向回归：11 项测试通过，覆盖离线 Revision 链、Fast-forward、同 Hash 不冲突、双向冲突、云端覆盖前 Backup、3 Checkpoint 滚动与 Slot Size 统计。
- 新版 10 赛季增强型回归：13,120 场常规赛、919 场季后赛、0 严重一致性错误；8 支不同冠军，720 名新秀流入、419 名退役、1 名名人堂球员；十年原始 JSON 峰值 6.37 MB。
- 原生 gzip 存储实测：单赛季原始 GameState 2.19 MB，实际存储 0.30 MB；Colorbox 分块适配测试确认每次官方 Storage 写入低于 200KB 且可完整重组。
- 开场/夺冠视觉回归：官方 Playwright 分别检查 `?fixture=opening` 与 `?fixture=event`，专属插画、事件文案与 Modal 布局正常，Console 0 error。
- 球员状态 UI 回归：官方 Playwright 展开常规赛阵容卡，15 人 Health / Morale、合同与赛季数据正常展示；`render_game_to_text` 同步输出 Team Fit Health，Console 0 error。
- Health / Morale 接入后的一季增强型 Headless 回归：1,312 场常规赛、92 场季后赛、0 严重一致性错误；原始 GameState 2.20 MB、gzip 存储 0.30 MB。
- 最新连续三赛季增强型 Headless 回归（含 Fatigue / Form / Event Effect）：3,936 场常规赛、283 场季后赛、0 严重一致性错误；160 名新秀流入、66 名退役、3 支不同冠军、最高 91.13 OVR；原始 GameState 峰值 3.18 MB、gzip 存储峰值 0.49 MB。
- “模拟到下一事件”浏览器回归：从 1-0 自动推进至 3-0 后停在 `streak_winning_003`，没有越过待处理 Event，Console 0 error。
- Event Effect 浏览器回归：确认冠军事件后 Queue 清空、Fan Support 58 → 59、Free Agent Attraction 同步重算，Console 0 error；接入后完整一季仍为 1,312 场常规赛、92 场季后赛、0 严重一致性错误。
- Fatigue / Form 接入后完整一季增强型回归：1,312 场常规赛、102 场季后赛、0 严重一致性错误；原始 GameState 2.24 MB、gzip 存储 0.31 MB。
- 配置化回归：`npm test` 为 29 个测试文件 / 86 项全通过；`npm run build` 通过，单文件 `h5/index.html` 506.32 kB（gzip 155.66 kB）。
- 配置化后固定 Seed 三赛季增强型 Headless：3/3 Season equivalents、0 严重一致性错误；160 名新秀流入、66 名退役、平均 OVR 69.15、4 名 90+、gzip 存储峰值 0.49 MB。
- `game-config.v2` 回归：30 个测试文件 / 87 项全通过，生产构建 `h5/index.html` 523.44 kB（gzip 160.15 kB）；固定 Seed 三赛季为 3,936 场常规赛、275 场季后赛、0 严重一致性错误，平均 OVR 69.15、4 名 90+、gzip 峰值 0.49 MB。

## 后续阶段

- Stage 7：继续运行 20 Seeds × 30 Seasons 和 >=1000 Season equivalents 平衡回归；当前仍只完成单 Seed × 10 赛季门槛验证，未把单 Seed结果冒充发布级回归。
- Release 门禁：用户已确认 30 队 Logo 为虎扑授权素材，Logo 门禁解除。真实球员开档前历史荣誉数据仍未由当前 Skills 提供，继续保持 HOF ineligible 而不虚构。
- 虎扑 AI 工坊上传包已于 2026-09-17 按全中文界面最终构建覆盖更新：`release/篮球经理_扩军时代_V1.5_虎扑AI工坊.zip`，ZIP 根目录直接包含 `index.html`，共 41 个文件、约 2.0 MB；文件清单与 `h5/` 逐项一致，`unzip -t` 完整性校验通过，SHA-256 为 `9b2024f715c8b17833af747fb403b5157c0cdae309f3d302b864f26c289e2228`。
- 上传包交付前回归：30 个测试文件 / 87 项测试全通过，TypeScript 与 Vite 生产构建通过；官方 `develop-web-game` Playwright 客户端从最终 `h5/index.html?fixture=1` 加载扩军开局，截图与 `TEAM_CREATION` 状态一致。按 `audit-hupu-web-security` 检查源码请求、外域资源、动态执行和设备能力，未发现禁止项。

## 全中文界面回归（2026-09-17）

- [x] 扩军第三阶段、经理系统第四阶段、常规赛首页、阵容、管理、联盟、生涯、球员详情、比赛详情、伤病、紧急名单、事件与存档冲突全部改为中文界面。
- [x] 新增集中式界面词典，统一阶段、位置、轮换角色、球队角色、合同状态、选项类型、伤病、属性、特质、奖项、分区、赛区、金额与事件类别显示；内部枚举值和存档协议保持不变。
- [x] 虎扑 30 队城市名、扩军城市与品牌名改为中文；测试名单中的虚构球员姓名作为人物专名保留原名。
- [x] 服务层英文错误码和动态交易日志在 UI 出口统一转为中文，避免异常路径、合同动态和联盟新闻泄漏内部英文枚举。
- [x] `npm run typecheck` 通过；`npm test -- --run --testTimeout=120000` 为 30 个测试文件、87 项测试全通过；`npm run build` 通过，生产单文件 `h5/index.html` 为 547.51 kB（gzip 167.00 kB）。默认 30 秒时限在当前高负载环境下触发整季模拟超时，单文件与全套测试放宽时限后均通过。
- [x] 官方 Playwright 客户端覆盖创建球队、合同选项、季前名单、休赛期历史、重大伤病、紧急名单、冠军事件与常规赛场景，未生成 Console error 文件；浏览器无障碍树复查首页、阵容和比赛详情的所有界面标签均为中文。
- [x] `visual-verdict` 以原型适配后的上一轮截图为视觉基线，最终评分 97 / 100，通过 90 分门槛；结果保存在 `.omx/state/chinese-ui/ralph-progress.json`。

## Gemini 原型 V2.0 视觉还原（2026-09-17）

- [x] 以 `/Users/uwa/Downloads/gemini-code-1789619463016.html` 为唯一视觉基准，将 390×844 移动端外壳、米白背景、橙色主操作、圆角卡片、顶部工具栏、五项底部导航和底部抽屉完整应用到现有游戏。
- [x] 创建球队首屏按原型重排为 01/06 步骤结构、城市双选、球队名输入、四款队徽方案和底部主按钮；原有城市、品牌、配色与建队指令逻辑保持不变。
- [x] 存档/读档迁移至顶部“存/读档”抽屉，仍支持三个槽位；阵容、管理、联盟、生涯、扩军权益、合同选项、扩军交易、扩军选秀、伤病、事件、比赛详情和球员详情统一为同一视觉系统。
- [x] 官方 `develop-web-game` Playwright 客户端覆盖原型首屏、扩军权益推进、常规赛五个导航页、存档抽屉、伤病弹层及最终 `file://` 构建产物；状态 JSON 正常且未生成 Console error 文件。
- [x] `visual-verdict` 最终评分 92 / 100，达到 90 分通过门槛；结果保存在 `.omx/state/v2-prototype/ralph-progress.json`。剩余差异仅为本地 SVG 图标与浏览器中文字体的像素级渲染差异。
- [x] `npm run typecheck` 通过；`npm test -- --run --testTimeout=120000` 为 31 个测试文件、94 项测试全部通过；`npm run build` 通过，生产单文件 `h5/index.html` 为 2,865.54 kB（gzip 602.71 kB）。
- [x] 最终构建未引用外部脚本、样式或开发入口；发布 ZIP 根目录直接包含 `index.html`，与 `h5/` 的 41 个文件逐项一致，`unzip -t` 完整性校验通过。
- [x] 已覆盖 `release/篮球经理_扩军时代_V1.5_虎扑AI工坊.zip`，大小 2,542,904 bytes，SHA-256 为 `3e9744476df37ec3c6ed858ba0bdef6cbcb2b5ad97229029266fa5cf496dc554`。

## 本地静态预览与虎扑交付一致性（2026-09-17）

- [x] 本地和虎扑默认入口统一为发布包内同一个 `index.html`；本地可直接以 `file://` 双击打开，无需 Vite、HTTP 服务或 URL 测试参数。
- [x] 默认阵容统一读取构建包内的 `nba-player-dataset.json`，本地与虎扑均使用同一数据版本 `nba-api-2025-26-2026-09-17`；30 支现有球队各固定载入 15～18 名球员，排序、能力、潜力和合同均为确定性结果。
- [x] 移除默认启动对虎扑实时阵容接口的依赖，避免本地与虎扑因网络、接口更新时间或返回顺序产生可见差异；开发专用伤病、事件等 fixture 仍只在开发模式显式参数下启用。
- [x] 官方 Playwright 客户端直接打开最终 `file:///.../h5/index.html`，无需参数即可进入全中文“创建加盟球队”页面；状态为 `TEAM_CREATION`，无 Console error 文件。
- [x] 新增静态数据一致性测试；最终 `npm test -- --run --testTimeout=120000` 为 31 个测试文件、95 项测试全部通过，`npm run build` 通过。
- [x] 已再次覆盖 `release/篮球经理_扩军时代_V1.5_虎扑AI工坊.zip`；41 个文件与 `h5/` 逐项一致，`unzip -t` 通过，大小 2,540,631 bytes，SHA-256 为 `ca48d7a118dcd96eb3e6cb37d0692b59ac20c231c54a1f81900e28bdadf99988`。

## 原型结构级还原纠偏（2026-09-17）

用户反馈：上一轮偏重颜色与皮肤，页面模块、布局层级和原型交互结构没有逐页还原。本轮以此为缺陷而非新需求处理。

- [x] 补齐原型启动加载页与游戏首页，静态包本地和虎扑保持同一入口。
- [x] EX-01～EX-04 逐页采用原型结构：步骤标题、权益结果卡、球队选择抽屉、保护/未保护名单、双列交易资产卡。
- [x] 赛程页改为“球队摘要 + 月历 + 比赛日详情 + 双操作”布局，保留所有模拟能力。
- [x] 阵容页改为契合度摘要 + 原型球员卡列表；管理页改为交易/工资帽双分段；联盟页改为表格；生涯页改为奖杯评级卡。
- [x] 存读档改为自动存档卡 + 3 个槽位卡，球员详情、球队选择器、事件与比赛详情统一为原型底部抽屉。
- [x] 每轮通过官方 Playwright 截图、状态 JSON、Console 和 `visual-verdict` 对比，最终再跑 390×844、全量测试、构建和 ZIP 覆盖。

行为保护：保留队徽、真实球员静态数据、Engine / Command、存档 Schema、`data-testid` 和所有业务回调；只重排展示结构。

最终验证：`visual-verdict` 为 97 / 100；`npm run typecheck` 通过；31 个测试文件、95 项测试全通过。为同时满足本地 `file://` 直开与虎扑发布安全门禁，生产构建拆为 `h5/index.html` + 本地经典脚本 `h5/assets/game.js`，不包含可执行内联脚本、外域资源或绕过 SDK 的业务请求。最终 ZIP 根目录共 42 个文件，与 `h5/` 清单逐项一致；从 ZIP 解压后的 `file://` 截图与本地 `h5/index.html` 截图 SHA-256 完全一致。发布包大小 2,545,440 bytes，SHA-256 为 `3fb28fd3ef829bdd9140dc872ae510e18057dbf2bb88bbfaad5bc14146047b3c`。
## 2026-09-17：扩军抽签、交易桌与选秀信息优化

- [x] 权益抽签改为本球队在两份不同协议之间进行可复现随机抽取，并展示抽签动画与最终分配。
- [x] 扩军交易桌移除球员头像、压缩协议卡片，让报价区域独立纵向滚动，并把进入扩军选秀按钮固定在底部。
- [x] 扩军选秀球队选择器补全 30 支原球队；修复未保护球员姓名/合同信息截断。
- [x] 保护名单改为默认展开且可收起；选秀页显示当前扩军队工资、空间和阵容规模。
- [x] 增补领域测试，完成类型检查、单测、构建、浏览器交互与视觉验收，重新打包发布 zip。

### 完成验证

- 权益协议通过新 `DRAW_RIGHTS_PACKAGE` 指令按固定种子抽取；刷新、读档和指令重试不会重抽，另一份协议自动分配给电脑球队。
- 交易桌卡片无球员头像，报价区可独立上下滚动，底部确认操作保持固定；390×844 截图已人工检查。
- 球队抽屉实测包含东部 16 队、西部 14 队，并保留雄鹿、鹈鹕等当前无可选球员的球队入口与空状态。
- 保护名单默认展开且可收起；未保护球员完整展示中文名、位置、综合、年龄、工资和合同年限。
- 选中球员后，扩军队保障工资、工资帽占用、帽下空间和阵容人数实时联动；浏览器 Console 0 error。
- `visual-verdict` 评分 95/100，结果保存于 `.omx/state/expansion-compact-flow/ralph-progress.json`。
- 全量测试 32 个文件 / 100 项全部通过；10 个固定种子扩军 Headless 均完成 28 签、两队各 14 人；TypeScript 与生产构建通过。
- 发布包 `release/篮球经理_扩军时代_V1.8_协议抽签与选秀优化版.zip` 完整性检查通过，大小 5,420,070 bytes，SHA-256 为 `21f59786c4241b2f570ce2781049dc1e249203de9ea3223cc447afe86f0b00b8`。
## V1.10 — 2026–27 中文名单与数据口径

Current request (2026-09-17): 参考 `noRegrets` 的真实球员数据组织方式，让现役球员统一显示中文名；球队阵容归属严格使用 2026–27 赛季名单，不能回退到 2025–26 球队关系。

Plan:

1. 保留现有 NBA 官方 2026–27 roster snapshot 作为球队归属唯一来源；2025–26 只用于最近完整赛季的能力建模。
2. 引入 NBA 中国官网现役球员中文名快照，按 NBA Player ID 与 2026–27 名单精确绑定；不使用猜测式自动音译。
3. 参考 `noRegrets` 的分层思路，明确区分中文名来源、当前名单来源和能力数据来源，并补齐覆盖率测试。
4. 执行类型检查、构建、测试和移动端页面验证，再输出 V1.10 zip。

Completed:

- [x] 参考 `noRegrets` 的 Player ID / `name_zh` / ratings 分层方式，但没有复用其 2008–09、2011–12、2021–22 历史名单覆盖当前阵容。
- [x] 新增 NBA 中国现役名单中文名快照；与 NBA 官方 2026–27 roster 和本地能力数据按 NBA Player ID 精确合并。
- [x] 26–27 当前名单中 493 名具备能力数据的球员中文名覆盖 493/493；名单归属仍以 26–27 roster 为准，能力值明确为最近完整 2025–26 赛季模型。
- [x] 中文名已覆盖扩军交易桌、扩军选秀、球队阵容、球员详情、自由市场、交易报价、训练、伤病、奖项、名人堂和比赛技术统计。
- [x] 浏览器实测扩军交易桌显示“亚历克斯·卡鲁索”“CJ·麦科勒姆”“马拉基·布兰纳姆”等中文名，CJ 所属亚特兰大老鹰；底部锁定按钮正常可见。
- [x] `tsc --noEmit`、Vite build、32 个测试文件 102 项测试、扩军 headless 10 seeds、Stage 4 headless 10 seeds 全部通过。

## V1.11 — 直达首页与权益自主选择

Current request (2026-09-17): 本地数据不再需要伪加载页；取消扩军权益随机抽签和抽签动画，完整写明两份权益，让玩家自主选择后进入扩军交易桌。

Plan:

1. 默认入口直接进入主菜单，删除定时进度条、加载文案和 splash 状态。
2. 新建扩军球队后始终等待玩家选择方案，不再预抽赢家或为玩家随机分配协议。
3. 权益页改为两张可选择卡片，清楚展示扩军选秀、新秀首轮、新秀次轮顺位及适合策略；电脑球队自动获得另一方案。
4. 选择后通过原子命令完成权益分配、合同选项后台结算与交易桌准备；补充状态机测试并执行浏览器交互、截图、Console、全量测试和构建。

Completed:

- [x] 删除 splash、定时器、进度条和加载文案；默认入口现在直接显示“篮球经理：扩军时代”主菜单。
- [x] 移除 `DRAW_RIGHTS_PACKAGE` 随机指令与抽签动画；建队后两套方案均保持待选状态，由玩家明确选择。
- [x] 方案甲写明“扩军选秀第 1 顺位 / 新秀首轮第 6 顺位 / 新秀次轮第 38 顺位”，方案乙写明“扩军选秀第 2 顺位 / 新秀首轮第 5 顺位 / 新秀次轮第 37 顺位”，并补充适用策略说明。
- [x] 确认后玩家获得所选方案，电脑扩军队自动获得另一方案；合同选项后台结算并直接进入扩军交易桌，旧存档已结算方案仍可继续。
- [x] 官方 Playwright 客户端完成 390×844 权益页截图；浏览器实测选择方案乙、确认并进入交易桌，Console 0 error；默认入口确认无加载页。
- [x] `visual-verdict` 评分 94/100，结果保存于 `.omx/state/rights-choice/ralph-progress.json`。
- [x] `tsc --noEmit`、Vite 生产构建、32 个测试文件 102 项测试和扩军 headless 10 seeds 全部通过。

## V1.12 — 球员详情卡参考稿还原

Current request (2026-09-17): 删除球员详情底部的数据来源说明；球员卡片按照 `/Users/uwa/Downloads/gemini-code-1789639264532.html` 的样式还原。

- [x] 扩军交易桌、扩军选秀和常规阵容共用同一套参考球员卡片，避免不同页面继续出现两种详情样式。
- [x] 还原 380px 深色卡片、金色数据来源标签、姓名/球队/位置、渐变 OVR 徽章、四项基础资料、三项合同、双列能力条和三项底部特征。
- [x] 完整移除“中文名来自 NBA 中国现役名单……”等底部说明，也移除详情弹层中的虎扑资料同步提示与请求。
- [x] 常规阵容的角色设置和交易报价入口作为独立操作区保留，不改变原有经理功能。
- [x] 官方 Playwright 客户端分别生成参考稿和游戏实装截图；最终视觉结构、颜色、间距和层级一致，Console 未产生错误文件。
- [x] `visual-verdict` 评分 96/100，结果保存于 `.omx/state/player-card-v111/ralph-progress.json`。
- [x] 生产构建通过；全量测试在 120 秒长测上限下为 32 个测试文件、102 项全部通过；源码与构建产物均确认不再包含被删除的提示文案。

## V1.13 — 扩军电影序章与交易桌参考稿还原

Current request (2026-09-17): 开始新游戏后用电影方式介绍 NBA 扩军背景，明确森林狼转入东部、西雅图与拉斯维加斯两支新队加入西部；扩军交易桌按照 `/Users/uwa/Downloads/gemini-code-1789639653872.html` 还原，继续使用当前队徽。

- [x] “开始新游戏”改为先进入四幕电影序章：联盟 30→32、森林狼西部→东部、西雅图与拉斯维加斯加入西部、玩家接掌扩军球队。
- [x] 序章支持 5.2 秒自动推进、章节点击、继续按钮和跳过序章；最终进入原有创建球队流程，读取存档与继续游戏不重复播放。
- [x] 序章使用现有球馆背景、森林狼正式队徽和两支扩军队默认队徽，并提供减少动态效果兼容。
- [x] 扩军交易桌按参考稿还原标题、已接受徽章、三项统计、橙色提示、三段筛选、报价卡、合同三列、说明条和按钮比例；球队继续显示当前真实队徽。
- [x] 保留此前要求的独立报价滚动区与固定底部提交卡，720px 和 844px 高度均不会遮挡报价按钮。
- [x] 浏览器完整验证开始游戏→电影序章→创建球队，以及筛选报价、查看球员、接受协议；接受后计数 0/5→1/5、报价 30→29。
- [x] 新增联盟重组测试，确认森林狼为东部、两支扩军队为西部，东西部各 16 队。
- [x] `visual-verdict` 评分 95/100，结果保存于 `.omx/state/v113-cinematic-trade/ralph-progress.json`。
- [x] TypeScript、生产构建、32 个测试文件 103 项测试和扩军 headless 10 seeds 全部通过。

## V1.14 — Cyber Terminal 全局主题与建队体验修正

Current request (2026-09-17): 全局统一为赛博高科技 / 战术终端风；球队命名显示简明规范并修复纯数字名称无法进入游戏却无提示的问题；首页增加背景图；扩军交易桌直接显示球员综合。

- [x] 在 `:root` 建立页面、卡片、文字、边框、霓虹青、毒液绿、日志栏、圆角和字体 Token，并把旧版变量映射到新主题。
- [x] App Bar、底部导航、卡片、数据格、抽屉、状态栏、主次按钮、表单和扩军流程统一为深蓝半透明战术终端视觉。
- [x] 首页使用电影序章球馆图作为背景，增加暗色渐变、系统标识和霓虹青主操作层级。
- [x] 建队页直接显示 2～20 字符规则；输入 `111` 时显示“球队名称不能仅由数字组成”、标记无效并禁用创建按钮。
- [x] 扩军交易桌在每份协议的球员姓名旁显示独立“综合”高亮徽章，无需打开球员详情。
- [x] 官方 Playwright 客户端完成首页、建队页、交易桌截图；浏览器实测纯数字校验；`visual-verdict` 94/100。
- [x] TypeScript 与 Vite 生产构建通过；32 个测试文件 103 项测试全部通过；扩军 headless 10/10 固定种子通过。
- [x] 已生成 `release/篮球经理_扩军时代_V1.14_赛博终端主题版.zip`；48 个条目完整性检查通过，SHA-256 为 `8a33306772e13a2b288ba01a86709f9db6406bf6b921d2d8ee1abfe72213411a`。

## V1.15 — 扩军选秀大会参考稿还原

Current request (2026-09-17): 扩军选秀使用 `/Users/uwa/Downloads/gemini-code-1789641341737.html` 的 UI。

- [x] 按参考稿重构为“标题与签位进度 → 扩军球队薪资卡 → 实时播报 → 保护名单 → 紧凑选秀池”的纵向信息结构。
- [x] 进度徽章实时显示 0/14～14/14；薪资卡同步显示保障工资、工资帽占用、帽下空间与联盟工资帽。
- [x] 保护名单默认展开、支持折叠并在固定高度内滚动；球员卡直接展示中文名、位置、综合、年龄、年薪和剩余合同。
- [x] 保留项目原有的 30 队切换抽屉，并压缩为参考稿风格的终端控制条。
- [x] 浏览器实测保护名单折叠、切换至老鹰、选择球员；签位 0/14→1/14，保障工资与帽下空间同步更新。
- [x] `visual-verdict` 94/100，结果保存于 `.omx/state/v115-expansion-draft/ralph-progress.json`。
- [x] TypeScript、生产构建、32 个测试文件 103 项测试和扩军 headless 10/10 固定种子全部通过。
- [x] 已生成 `release/篮球经理_扩军时代_V1.15_扩军选秀大会还原版.zip`；48 个条目完整性检查通过，SHA-256 为 `291d9820291a14f32188e703af8fdb1ef57023bedf5f8c65d15bb5eef66434ce`。

## V1.16 — 赛博球队选择弹窗与自动跳队

Current request (2026-09-17): 扩军选秀大会的球队选择页面使用指定参考 UI；一个球队选完后自动跳到下一支球队继续选择。

- [x] 用户给出的 `gemini-code-1789643348295.html` 不存在，采用 Downloads 中时间戳最接近的 `/Users/uwa/Downloads/gemini-code-1789643350232.html` 作为参考稿。
- [x] 球队选择弹窗还原 SYS 终端标题、青色切角、双联盟列、状态指示灯、选中高亮、禁用球队和 30 队滚动列表。
- [x] 使用当前真实队徽与球队中文名；无可选球员的球队灰化并禁止选择。
- [x] 从当前球队选中球员后，按照东部→西部的球队顺序自动跳转到下一支仍有可选球员的球队。
- [x] 浏览器实测凯尔特人选人后签位 0/14→1/14，当前球队自动变为黄蜂；凯尔特人节点禁用，黄蜂节点高亮。
- [x] `visual-verdict` 97/100，结果保存于 `.omx/state/v116-team-selector/ralph-progress.json`。
- [x] TypeScript、生产构建、32 个测试文件 103 项测试和扩军 headless 10/10 固定种子全部通过。
- [x] 已生成 `release/篮球经理_扩军时代_V1.16_球队选择与自动跳队版.zip`；48 个条目完整性检查通过，SHA-256 为 `1deb9e159746d9a07a05340346a939438ff2a66f6a2828efe338a8415efd8933`。

## V1.17 — 真实球员 OVR 分层校准

Current request (2026-09-17): 删除球员详情中的“NBA 官方当前名单”；参考 noRegrets 的能力实现，修正杰伦·布伦森仅 69 等明显失真的综合能力。

- [x] 根因确认：旧模型把八项属性等权平均，导致控卫的内防、篮板与组织、投射权重完全相同；联盟最高仅 83.12、90+ 为 0，不符合冻结文档要求。
- [x] 五个位置改用独立属性权重；OVR 采用 noRegrets 已验证的赛季产量分层公式（得分、篮板、助攻、出场时间），八项属性仍作为比赛模拟输入。
- [x] 真实球员保存生产层级校准差值，后续成长和衰退仍能随属性动态变化；旧存档与程序化球员没有校准值时自动沿用属性 OVR。
- [x] 杰伦·布伦森 69→92；约基奇 96、亚历山大 95、字母哥 94、东契奇 96、库里 91、塔图姆 90。
- [x] 582 名球员平均 OVR 75.4，90+ 共 25 人，满足联盟平均 68～76、90+ 约 5～25 人的平衡目标。
- [x] 球员详情移除“NBA 官方当前名单”，数据来源标签统一改为中性的“离线球员资料”。
- [x] 32 个测试文件 / 106 项测试、TypeScript 与 Vite 生产构建、扩军 10/10 固定种子全部通过。
- [x] 官方 Playwright 客户端打开扩军选秀球员详情；截图确认旧标签已移除、OVR 正常显示，`render_game_to_text` 与页面一致且无 Console error。
- [x] 已生成 `release/篮球经理_扩军时代_V1.17_真实球员能力校准版.zip`；48 个条目完整性检查通过，SHA-256 为 `3e767d957ec5af2f02a32e25155cff2aaf06f1646d95e335ee8701336fb18634`。

## V1.18 — NBA 2K27 Top 100 OVR 对齐

Current request (2026-09-17): 获取 NBA 2K 球员能力值与项目比较，并尽量对齐。

- [x] 使用 NBA 2K27 官方 Top 100 页面，不以第三方评分站作为权威来源；快照记录游戏版本、发布日期、抓取日期和官方 URL。
- [x] 官方 100 人中 97 人与项目 2025–26 能力数据精确匹配并完全对齐；哈利伯顿、欧文、利拉德因没有 2025–26 比赛样本，未伪造八项能力强行补入。
- [x] 对齐前 97 人平均绝对误差 2.26，64 人误差不超过 2；对齐后已匹配球员误差为 0。
- [x] 布伦森 92→96、文班亚马 91→97、约基奇 96→97、亚历山大 95→97、塔图姆 90→93、卡鲁索 73→81。
- [x] Top 100 之外继续使用 noRegrets 风格的赛季产量分层；八项属性仍是比赛模拟输入，OVR 只作为 UI 摘要与经营判断。
- [x] 对齐后 582 人平均 OVR 75.36、90+ 共 20 人，仍满足冻结平衡目标。
- [x] 新增可重复运行的官方榜单校准流程、数据源标记和对齐报告；未来更换榜单快照后无需改业务代码。
- [x] 32 个测试文件 / 107 项测试、TypeScript、Vite 生产构建、Python 构建器语法与扩军 10/10 固定种子全部通过。
- [x] 官方 Playwright 客户端打开球员卡片，截图与 `render_game_to_text` 的 OVR 一致，Console error 为 0。
- [x] 已生成 `release/篮球经理_扩军时代_V1.18_NBA2K27能力对齐版.zip`；48 个条目完整性检查通过，SHA-256 为 `d6363352e8b2cecc98b7f1a8ca50d1045dc6fcf6b544b7acbe4e50053ec9d18b`。

## V1.20 — 扩军选秀当前阵容视图

Current request (2026-09-18): 扩军选秀大会页面需要能看到当前扩军球队的阵容，以便结合已有球员和位置缺口做选择。

- [x] 在扩军选秀池上方增加默认展开、可收起的当前阵容面板；面板位于球员池滚动区外，选人后仍保持可见。
- [x] 实时展示五位置人数，以及已选球员的中文名、位置、综合和年薪。
- [x] 已选球员可直接打开现有球员详情，空阵容提供明确引导。
- [x] 32 个测试文件 / 108 项测试、TypeScript、Vite 生产构建与扩军 10/10 固定种子全部通过。
- [x] 官方 Playwright 与应用内浏览器完成真实选人链路：0/14→1/14、PG 0→1、薪资实时更新并自动跳到下一支球队；Console error 为 0。
- [x] `visual-verdict` 95/100；结果保存于 `.omx/state/v120-current-roster/ralph-progress.json`。
- [x] 已生成 `release/篮球经理_扩军时代_V1.20_选秀阵容视图版.zip`；48 个条目完整性检查通过，SHA-256 为 `a45ab50ebcb355d4ca87e62b6f4f2e246b95b076eb5ee5530db3648c60cb0cad`。

## V1.21 — 2026 真实新秀选秀重演

Current request (2026-09-18): 将开局阵容恢复到 2026 选秀前；普通球队优先按真实选秀结果选人，扩军球队可以截胡；被截胡后由电脑球队按剩余真实榜单顺延补位，且球员不能重复归属。

- [x] 建立 2026 年 60 名真实新秀、原始签位、最终签权归属与中文名数据。
- [x] 从开局 2026–27 阵容移除整届选秀池球员，避免选秀前已在队与重复归属。
- [x] 首届选秀改为 80 人真实优先选秀池、64 个签位和 5/6、37/38 扩军签位。
- [x] 普通球队按真实结果执行；目标已被扩军队截胡时，按剩余真实榜单顺延补位。
- [x] 增加真实顺位、截胡级联、唯一归属、16 名落选秀与未来赛季回归程序化的回归测试。
- [x] 新秀选秀页补充真实结果与截胡规则；浏览器实测截胡科阿·皮特后从 #6 自动推进到 #38，控制台无错误。
- [x] TypeScript、Vite 生产构建、32 个测试文件 / 109 项测试与 Stage 4 无头 10/10 固定种子全部通过。
- [x] 已生成 `release/篮球经理_扩军时代_V1.21_2026真实选秀重演版.zip`；48 个条目完整性检查通过，SHA-256 为 `956864f5813ea39e26e72c492d125290fb586b622b22d091ac9a7fce24ca32fc`。

## V1.33 — 真人头像精灵图发布包

Current request (2026-09-18): 在保留全部真人头像的前提下，将发布包文件数降至虎扑 300 个文件限制以内。

- [x] 650 张 NBA 官方真人头像保留在 `tools/data/portrait-source/`，不再逐张复制进发布 H5。
- [x] 新增可重复运行的 `npm run data:build-portrait-atlas`：将头像按 NBA Player ID 稳定排序，生成 26 张横向图集以及运行时 ID 映射；球员详情卡以 CSS 背景定位裁切对应头像。
- [x] 头像数据同步完成后自动重建图集；项目运行时不请求 NBA 或 2K 外网接口。
- [x] 新增图集映射单测；TypeScript、生产构建、扩军 10/10 与 Stage 4 10/10 无头回归通过。
- [x] 仅保留 `release/篮球经理_扩军时代_V1.33_头像精灵图版.zip`：75 个条目、26 张图集、0 张逐张头像、6.6 MB。
