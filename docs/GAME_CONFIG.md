# 游戏数值配置说明

统一入口为 `src/config/gameConfig.ts`。运行时配置按职责拆成三个文件：

- `src/config/balanceConfig.ts`：成长、退役、AI GM、交易、自由市场、Draft、伤病、事件、联盟平衡、成就和扩军。
- `src/game/simulation/config.ts`：比赛 Pace、主客场、随机波动、Star Power、Fatigue、垃圾时间和轮换分钟。
- `src/config/leagueFinance.ts`：工资帽、税线、Apron、底薪、顶薪比例、合同年限、涨幅和新秀工资表。

## 配置域

| 配置路径 | 用途 |
| --- | --- |
| `simulation.*` | Pace、攻防换算、主场优势、比赛随机性、Star Power、状态、士气、疲劳、垃圾时间 |
| `simulation.ratings / rotation / boxScore / playerStatus` | 八维攻防权重、轮换分钟、球权与技术统计骨架、投篮守恒修正、逐场状态变化 |
| `balance.playerLifecycle.*` | 年龄曲线、Potential、Development Rate、训练、伤病影响、衰退、退役、名人堂 |
| `balance.ai.*` | 球队方向、交易阈值、Draft 偏好、FA 行为 |
| `balance.trade.*` | 球员 Trade Value、刷新惩罚、报价数、未来选秀权估值 |
| `balance.freeAgency.*` | Utility 权重、报价窗口、接受阈值、市场工资和角色评价 |
| `finance.*` | Salary Cap、Tax、Apron、最低工资、顶薪比例、合同年限及涨幅 |
| `balance.draft.*` | 每届人数、潜力/类型分布、侦察误差、乐透抽签 |
| `balance.injuries.*` | 基础伤病率、严重度权重、恢复时间、耐伤与年龄/疲劳影响 |
| `balance.randomEvents.*` | 触发概率、冷却、类别权重、连败恢复事件加权 |
| `balance.leagueBalance.*` | 年度新秀供给、退役人口与 OVR 分布目标（用于长期模拟验收） |
| `balance.overall.*` | 各位置 OVR 展示权重；默认等权，后续可独立调整 PG～C 权重 |
| `balance.achievements.*` | 触发条件、展示文案、Dynasty Score 奖励 |
| `balance.expansion.*` | AI 策略、交易数量、保护人数、名单人数、权益 Package 和补偿签 |
| `balance.teamFit / teamCore` | 阵容适配度、球迷支持、士气、球队声望和 FA Attraction |
| `balance.awards.*` | MVP/DPOY/ROY/MIP/第六人、All-Star 与 Finals MVP 的评分和资格阈值 |
| `balance.scheduleQuality.*` | 背靠背、主客场连续场次与赛程优化器迭代参数 |
| `balance.historyCompression.*` | 纪录比赛、Game 7、总决赛与完整历史保留策略 |
| `balance.replacementPlayers / rosterRotation / injuryRecovery` | Emergency 球员生成、自动轮换切分和伤病恢复速度 |

## 调参约束

1. 改动任何会影响存档结果的数值时，递增对应领域的 `version` 和统一入口 `GAME_CONFIG.version`；新生涯会把统一版本写入 `meta.configVersion`，不要在不迁移的情况下改写旧存档的版本号。
2. 自由市场 Utility 权重、扩军 AI 策略权重、伤病严重度权重分别必须合计为 `100`。
3. `draft.classSize` 与 `leagueBalance.annualRookieInflow` 应保持一致，且不能少于一届选秀签位数。
4. 工资线必须满足 `salaryCap < luxuryTaxLine < firstApron < secondApron`。
5. 调整后至少执行 `npm test`、`npm run build`；成长、退役、选秀或比赛参数有变化时，再执行固定 Seed 的 `npm run headless:benchmark -- --season-equivalents 10`。

`validateGameConfig()` 会在测试中校验上述结构性约束。所有随机行为继续使用职业生涯/赛季固定 Seed，因此同一配置版本与同一 Seed 可复现。

当前统一版本为 `game-config.v2`。本轮仍未把 82 场、41/41 主客场、季后赛赛制、交易状态机等冻结结构做成可调参数；这些属于 V1.5 的产品合同，不应通过数值配置绕过。
