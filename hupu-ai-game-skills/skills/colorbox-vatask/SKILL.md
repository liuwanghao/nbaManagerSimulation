---
name: vatask
description: 为你的游戏接入激励广告变现：玩家看视频获得奖励次数，可用于抽奖或游戏内权益。零配置接入，平台自动完成活动与广告位绑定。
---

# 激励广告（业务介绍）

为游戏接入激励广告能力：玩家在虎扑 App 内观看一段激励视频，完整看完后获得奖励次数，可用于抽奖或兑换游戏内权益。

## 开发者接入

- 创建应用时勾选「激励广告」即可，无需任何配置；活动、广告位与奖励规则由平台自动创建和绑定
- 玩家在页面看到「看视频领奖励」入口和剩余次数展示
- 仅虎扑 App 内生效，玩家需登录后参与
- 广告收益按完播结算，由平台统一处理

## 实现指引（供生成代码的 AI 使用）

本能力组包含三个 `vatask` 任务能力，具体参数、返回值与约束以各子 Skill 定义为准：

| 子 Skill | JS Path | 作用 |
| --- | --- | --- |
| 完成激励视频 | `window.ColorboxAI.vatask.completeRewardVideo()` | 拉起激励视频，完播后奖励到账 |
| 查询活动任务状态 | `window.ColorboxAI.vatask.getActivityTaskState()` | 查询剩余次数与任务完成情况 |
| 消耗活动次数抽奖 | `window.ColorboxAI.vatask.consumeActivityChance()` | 消耗一次次数并返回抽奖结果 |

活动 id 由底座配置自动注入（`window.__COLORBOX_AI_CONFIG__.ActivityId`），调用时无需也不能传参。

### 任务链路如何运行

1. **看广告拿奖励**：用户点击 → `completeRewardVideo()` → 原生拉起激励视频 → 完播后原生确认奖励到账 → 服务端自动增加次数。页面只负责成功后刷新状态，不可自行加次数
2. **查询次数**：页面初始化 / 任务完成 / 用户刷新时调用 `getActivityTaskState()` 获取剩余次数与任务状态；`taskCode` 为 `"reward"` 即激励视频任务
3. **消耗次数**：用户点击抽奖时调用 `consumeActivityChance()` 消耗一次并返回结果；`data.prize` 为 `null` 表示未中奖，不是失败

### 组合方式（由业务场景决定）

- **直接权益兑换**：看广告成功 → 页面发放游戏内权益，次数可不展示
- **抽奖玩法**：看广告得次数 → 展示剩余次数 → 抽奖消耗 → 中奖弹窗
- **任务墙**：展示 reward 任务与剩余次数，可叠加签到、分享等自有任务

### 通用接入骨架

```javascript
// 1. 页面初始化：查状态（只读）
const state = await window.ColorboxAI.vatask.getActivityTaskState();

// 2. 用户点击"看广告"：拉起激励视频
const res = await window.ColorboxAI.vatask.completeRewardVideo();
if (res.code === 200 && res.data.rewarded) {
  await window.ColorboxAI.vatask.getActivityTaskState(); // 刷新状态
  // 发放业务奖励（抽奖次数/游戏权益等）
} else {
  // 按 res.message 提示；禁止自行补发奖励
}
```

### 通用约束

- 必须由用户主动点击触发，禁止页面加载、循环、轮询或自动重试中调用
- 只允许通过 `window.ColorboxAI.vatask.*` 调用，禁止直接调用原生 Bridge 或活动任务接口
- 同一时间只允许一个激励视频流程，进行中必须禁用触发按钮
- 失败时使用返回的 `message` 提示用户，禁止自行补发奖励
- 仅支持虎扑 App，暂不支持鸿蒙系统；站外调用返回 `code 403`（reason 为 `APP_REQUIRED`）
