# 虎扑 AI 工坊平台能力盘点

盘点日期：2026-09-16。能力来源为当前工作区实际可发现的官方 Skills；业务层不得直接依赖具体平台实现。

| 领域 | 当前发现能力 | Stage 0 处理 |
|---|---|---|
| User | `auth-getUserInfo` | 通过 `src/platform/user` Adapter 隔离；fixture 模式使用匿名用户 |
| Storage | `storage-getValue`、`storage-setValue`、`act-cloudbase` | 首版提供 LocalStorage Adapter；云端实现保留接口 |
| Share | `social-share`、`result-poster-posting` | 后置到视觉与分享阶段 |
| Leaderboard | `leaderboard-template` | 非 V1 核心阻塞项，不接入首版 Engine |
| Ads | `vatask` 及奖励视频/次数 Skills | 非 V1 核心阻塞项，不进入 GameState 规则 |
| Assets | `oss-uploadFile` | V1 Logo 使用预审核资源，不开放用户上传 |
| Lifecycle | `closeWebview`、`navigate-to`、`game-jump` | 由 Platform Adapter 封装，首版 Web 运行使用空实现 |
| Analytics | `track-report` | Presentation 层事件适配，Engine 不依赖 |
| Feedback | `user-feedback` | 后置，不阻塞核心闭环 |
| Security | `security-checkAudit`、`audit-hupu-web-security` | 自定义球队名提交和发布前安全审查时使用 |
| NBA Roster | `request-basketball-teamPlayerList` | 开局分两批同步 30 队真实姓名、位置与赛季场均数据；不直接拼接接口 URL |
| NBA Salary | `request-basketball-teamSalaryInfo` | 与球队阵容并行同步年龄和多年薪资；按 playerId 合并 |
| NBA Player | `request-basketball-playerInfo` | 玩家打开详情时按需补取真实体测、出生日期与国籍；按 playerId 缓存，不批量请求 |

## 当前限制

- 当前能力列表未提供统一 Preview/Publish Skill；不得虚构 API。
- 球员姓名、球队、位置、赛季表现与薪资依赖虎扑运行时注入；本地静态环境只能显式使用 `?fixture=1` 测试数据。
- 所有平台失败必须允许本地降级，并保持 Engine 结果不变。
