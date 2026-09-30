---
name: vatask-completeRewardVideo
description: 在 App 内拉起激励视频广告，用户完整观看并确认奖励到账后返回成功，用于活动页发放观看奖励。
---

# Usage

- JS Path: `window.ColorboxAI.vatask.completeRewardVideo(params)`

# Constraints

- 必须由用户点击等明确交互触发，禁止在页面加载、渲染、循环、轮询或自动重试中调用
- 激励流程进行中必须禁用触发按钮；同一页面同一时间只允许一个激励视频流程
- 只允许通过 window.ColorboxAI.vatask.completeRewardVideo() 调用，禁止直接调用原生 Bridge 或激励任务接口
- 活动 id 由底座配置自动注入，无需也不能通过参数传入
- 仅 code 等于 200 且 data.rewarded 等于 true 时，才代表原生已确认奖励到账；Bridge 的启动应答不代表获得奖励
- 成功后应调用 window.ColorboxAI.vatask.getActivityTaskState 刷新剩余次数和任务状态；失败时使用 message 向用户提示，禁止自行补发奖励
- 该能力仅支持虎扑 App；鸿蒙需 App 版本不低于 8.2.41，低于该版本或版本无法识别时返回 code 422（reason 为 UNAVAILABLE）；站外调用会返回 code 403（reason 为 APP_REQUIRED），由页面自行决定引导方式

# Parameters

| 参数名 | 类型 | 是否必填 | 说明 |
| --- | --- | --- | --- |

# Returns

- Type: `Promise<Response>`

### Response Properties

| 属性名 | 类型 | 是否必填 | 说明 |
| --- | --- | --- | --- |
| code | number | 是 | 状态码。200 表示奖励已到账；其余状态均不得视为成功 |
| message | string | 是 | 成功信息或面向用户的失败提示 |
| data | object | 是 | 激励视频执行结果 |
| data.rewarded | boolean | 是 | 是否已由原生回调确认奖励到账 |
| data.reason | string | 否 | 失败原因，取值：APP_REQUIRED（站外）、LOGIN_REQUIRED（未登录）、UNAVAILABLE（任务不可用或已完成）、NOT_REWARDED（未完整观看）、REQUEST_FAILED（任务查询失败）、REWARD_FLOW_FAILED（广告拉起失败）；成功时不返回 |

# Examples

```javascript
window.ColorboxAI.vatask.completeRewardVideo().then(res => { if (res.code === 200 && res.data.rewarded) { console.log("激励奖励已到账"); } else { console.warn(res.message); } });
```