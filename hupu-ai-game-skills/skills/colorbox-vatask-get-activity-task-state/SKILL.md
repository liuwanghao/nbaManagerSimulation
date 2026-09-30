---
name: vatask-getActivityTaskState
description: 查看用户当前的剩余抽奖次数与激励视频等任务完成情况，用于在活动页展示抽奖机会，并在任务完成后及时刷新状态。
---

# Usage

- JS Path: `window.ColorboxAI.vatask.getActivityTaskState(params)`

# Constraints

- 只允许通过 window.ColorboxAI.vatask.getActivityTaskState() 调用，禁止直接请求活动任务接口
- 活动 id 由底座配置自动注入，无需也不能通过参数传入
- 在页面初始化、任务完成后或用户主动刷新时调用；禁止在循环、轮询或自动重试中高频调用
- tasks 中 taskCode 为 "reward" 的即激励视频任务；status 为 completed 表示本周期已完成
- 激励视频任务通过 window.ColorboxAI.vatask.completeRewardVideo 完成，抽奖通过 window.ColorboxAI.vatask.consumeActivityChance 发起
- 必须根据返回的 code 判断是否成功，若 code 不等于 200，必须使用返回的 message 对用户进行友好提示（如 Toast 或弹窗）。

# Parameters

| 参数名 | 类型 | 是否必填 | 说明 |
| --- | --- | --- | --- |

# Returns

- Type: `Promise<Response>`

### Response Properties

| 属性名 | 类型 | 是否必填 | 说明 |
| --- | --- | --- | --- |
| code | number | 是 | 状态码，200 表示成功 |
| message | string | 是 | 成功信息或面向用户的失败提示 |
| data | object | 是 | 活动任务状态；失败时为 null |
| data.availableChanceCount | number | 是 | 当前剩余的活动抽奖次数 |
| data.tasks | array | 是 | 按后端顺序返回的任务列表 |
| data.tasks[].id | string | 是 | 任务 id |
| data.tasks[].taskCode | string | 是 | 任务类型编码，激励视频任务为 "reward" |
| data.tasks[].title | string | 是 | 运营配置的任务标题 |
| data.tasks[].description | string | 否 | 任务描述，可能不存在 |
| data.tasks[].iconUrl | string | 否 | 任务图标 URL，可能不存在 |
| data.tasks[].status | string | 是 | 任务完成状态：pending 表示可完成，completed 表示本周期已完成 |
| data.tasks[].chanceGrantCount | number | 是 | 完成一次任务可获得的活动次数 |

# Examples

```javascript
window.ColorboxAI.vatask.getActivityTaskState().then(res => { if (res.code === 200) { console.log("剩余次数", res.data.availableChanceCount); } else { console.warn(res.message); } });
```