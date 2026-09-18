# DATA_READINESS

当前版本已接入虎扑运行时真实 NBA 阵容能力；本地环境仅允许显式 `?fixture=1` 测试模式。30 队 Logo 已由用户确认为虎扑授权素材，可用于虎扑 AI 工坊发布。

| 数据项 | 来源 | License / Usage Right | 状态 |
|---|---|---|---|
| 球员姓名 / 当前所属球队 | 虎扑 `teamPlayerList` 运行时能力 | 虎扑工坊内使用 | 🟢 READY（live） |
| 位置 / 当前赛季场均数据 | 虎扑 `teamPlayerList` 运行时能力 | 虎扑工坊内使用 | 🟢 READY（live） |
| 年龄 / 当前及未来薪资 | 虎扑 `teamSalaryInfo` 运行时能力 | 虎扑工坊内使用 | 🟢 READY（live） |
| 球员身高 / 体重 / 出生日期 / 国籍 | 虎扑 `playerInfo` 按打开详情时懒加载 | 虎扑工坊内使用 | 🟢 READY（on demand） |
| 球员 OVR / 八维能力 | NBA2K API 构建期离线快照（上游为 2K Ratings）；缺档球员回退 2025–26 统计模型 | 非 2K 官方接口；仅可表述为“参考 NBA 2K27 能力体系” | 🟡 COMMUNITY / DERIVED |
| 副位置 / 性格 / 耐伤 / 市场偏好 | 固定 Seed 游戏生成 | 游戏推演值，界面已明确标注 | 🟡 DERIVED |
| 现实球员开档前 Career Stats / 历史荣誉 | 当前虎扑 Skills 未提供完整历史口径 | 不允许猜测；自动名人堂判定前必须补齐 | 🔴 BLOCKED（HOF ineligible） |
| 2026 Draft Class | fixture_dataset | 仅测试虚构数据 | 🟡 PARTIAL |
| Headshot | V1.5 当前版本不使用头像 | 不适用 | ⚪ NOT REQUIRED |
| Team Name | Config | 已定策略 | 🟢 READY |
| 30 队 Logo | 用户提供的 HoopChina CDN 链接（已缓存同源静态文件） | 用户确认为虎扑授权素材 | 🟢 READY |
| Expansion Logo | 每城 4 套自制 SVG 预审核资源池 | 自有、可替换 | 🟢 READY |

## 门禁结论

真实阵容开局可在虎扑工坊运行；本地无 SDK 时不会退回虚构名单。Logo 发布门禁已解除，Release Candidate 仍需通过最终发布安全审查。现实球员开档前历史荣誉数据继续按“无数据不虚构、不参与自动名人堂评选”处理。
