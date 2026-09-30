---
name: vatask-consumeActivityChance
description: 消耗一次抽奖次数并返回抽奖结果，用于活动页抽奖玩法；抽奖次数可通过观看激励视频等任务获得。
---

# Usage

- JS Path: `window.ColorboxAI.vatask.consumeActivityChance(params)`

# Constraints

- 必须由用户点击等明确交互触发，禁止在页面加载、渲染、循环、轮询或自动重试中调用
- 只允许通过 window.ColorboxAI.vatask.consumeActivityChance() 调用，禁止直接请求抽奖接口
- 活动 id 由底座配置自动注入，无需也不能通过参数传入
- 调用前应通过 vatask.getActivityTaskState 确认 availableChanceCount 大于 0；抽奖进行中必须禁用触发按钮
- code 等于 200 且 data.prize 为 null 表示本次未中奖，不是失败；失败时使用 message 向用户提示
- 成功后应调用 window.ColorboxAI.vatask.getActivityTaskState 刷新剩余次数
- 该能力仅支持虎扑 App；站外调用会返回 code 403，由页面自行决定引导方式

# Parameters

| 参数名 | 类型 | 是否必填 | 说明 |
| --- | --- | --- | --- |

# Returns

- Type: `Promise<Response>`

### Response Properties

| 属性名 | 类型 | 是否必填 | 说明 |
| --- | --- | --- | --- |
| code | number | 是 | 状态码，200 表示抽奖完成（无论是否中奖） |
| message | string | 是 | 成功信息或面向用户的失败提示 |
| data | object | 是 | 抽奖结果；失败时为 null |
| data.prize | object | 是 | 中奖信息；未中奖时为 null |
| data.prize.id | string | 是 | 中奖记录 id |
| data.prize.name | string | 是 | 奖品名称 |
| data.prize.imageUrl | string | 否 | 奖品图片 URL，可能不存在 |
| data.prize.description | string | 否 | 奖品描述，可能不存在 |
| data.prize.actionUrl | string | 否 | 奖品后续操作跳转地址，可能不存在 |
| data.prize.redemptionCode | string | 否 | 兑换码，仅兑换码类奖品存在 |

# Examples

```javascript
window.ColorboxAI.vatask.consumeActivityChance().then(res => { if (res.code === 200) { console.log(res.data.prize ? `中奖：${res.data.prize.name}` : "未中奖"); } else { console.warn(res.message); } });
```