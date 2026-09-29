# H5 篮球经理性能基线（2026-09-28）

> 测试对象是当前工作树的生产构建和开发态 fixture。仓库开始测试时已有未提交改动。这里记录原始数据；后续优化必须复用相同场景比较。

## 环境与方法

- macOS 15.6、x64、Node 22.21.1、本机 Google Chrome 153 headless。Chrome CDP 模拟移动视口 393×852 CSS px、DPR 3；这不是 iPhone 14 Pro 真机 CPU/GPU/内存测量。
- 生产构建：`npm run build` 后用本地 HTTP 服务提供 `h5/`；浏览器 PerformanceObserver 采集 Paint/Long Task，CDP 采集 DOM、JS heap；无网络限速的冷加载会话。开发态页面覆盖使用 `/app.html?fixture=game`，React StrictMode 双渲染，因此页面数值不能当成生产值。
- 模拟与存档：`node --expose-gc --import tsx /tmp/nba-sim-perf.mts`，固定种子；完整赛季调用实际 `advanceSeason`，每季校验归档 1,312 场及 82 场玩家比赛详情。存档调用实际 `SaveService` 配 `MemoryStorageAdapter`，并单独测 gzip；此值不包含浏览器 localStorage 同步写入。

## 生产首页与资源

| 指标 | 基线 |
| --- | ---: |
| DOMContentLoaded | 755.6 ms |
| Load event | 766.4 ms |
| First Paint | 776 ms |
| 可交互代理值 | 约 1,706 ms（最后一个启动长任务结束；尚非标准 TTI） |
| DOM 元素数 | 33 |
| Long Task | 3 个：425、849、89 ms；最大 849 ms |
| JS heap（页面稳定后） | 20.8 MB；CDP JSHeapUsedSize 15.9 MB，统计口径不同 |
| 生产 JS | 3,824,479 B；Vite 报告 gzip 791.72 kB |
| 外置 CSS | 0 B；CSS 注入单 JS，源码 `src/styles.css` 546,426 B |
| 图片/字体 | PNG 6,250,122 B；WebP 1,335,006 B；JPG 850,380 B；SVG 3,088 B；仓库构建资源中无字体文件 |
| 其他 | JSON 12,940 B；HTML 388 B；总计 74 文件，约 12.28 MB 十进制字节 |

CDP 4× CPU + Fast 4G（150 ms RTT、1.6 Mbps 下行）冷加载：DOMContentLoaded 21,323 ms、First Paint 21,352 ms、最大长任务 1,906 ms。6× CPU + Slow 4G（400 ms RTT、0.4 Mbps 下行）：DOMContentLoaded 77,886 ms、First Paint 77,920 ms、最大长任务 2,427 ms。网络模拟数值是 CDP 设定值，真实蜂窝网络会不同。

## 主要页面（开发态 fixture，两次进入）

进入耗时为点击到第二个 `requestAnimationFrame` 的时间；Long Task 是本次点击新增的最大值。DOM 只计当前文档元素，不计 CDP 保留的历史文档。

| 页面 | 首次 ms | 再次 ms | 当前 DOM | 首次最大 Long Task ms |
| --- | ---: | ---: | ---: | ---: |
| 首页 | 54 | 146 | 404 | 53 |
| 球队管理 | 172 | 164 | 1,167 | 154 |
| 球员名单/轮换 | 167 | 45 | 1,167 | 131 |
| 球员市场 | 80 | 72 | 277 | 74 |
| 交易 | 38 | 74 | 277 | 0 / 65 |
| 自由球员 | 71 | 71 | 277 | 63 |
| 联盟信息/排名 | 231 | 202 | 1,299 | 203 |
| 数据榜 | 169 | 166 | 1,299 | 151 |
| 奖项 | 176 | 70 | 1,299 | 152 |
| 赛程 | 181 | 41 | 1,299 | 159 |
| 生涯 | 125 | 121 | 751 | 113 |
| 生涯历史 | 115 | 43 | 751 | 96 |

快速往返 50 次（首页、管理/名单、市场/交易/自由球员、联盟/赛程）后强制 GC：JS heap 59.26→60.23 MB，DOM 节点 794→794，事件监听器 396→396。此循环没有覆盖已完成比赛的详情和 Box Score，不能据此排除这些场景泄漏。

## 模拟与存档

| 场景 | 基线 |
| --- | ---: |
| 单场 `simulateGame` | 42.2 ms |
| 单日 `simulateLeagueDay` | 178.4 ms，3 场 |
| 初始存档 JSON | 872,665 B；stringify 12.6 ms；parse 14.1 ms；gzip 编码 169.7 ms；SaveService.save 663.8 ms；load 735.4 ms |
| 第 1 季完整推进 | 20,773 ms；CPU user 21,935 ms；GC 后 heap 33.89 MB |
| 第 1 季存档 | JSON 2,353,912 B；gzip 编码 347,403 B；save 1,505.8 ms；load 1,670.9 ms |
| 第 5 季存档 | JSON 4,332,199 B；gzip 编码 710,431 B；save 4,393.7 ms；load 4,388.1 ms |
| 第 10 季完整推进 | 214,189 ms 墙钟；CPU user 187,976 ms；GC 后 heap 52.69 MB；历史简版结果 13,120 条 |

建立本基线时，第 7/30 天、30 季及 30 分钟记录尚未取得；最终专项报告已补齐这些场景。旧版连续 30 季测试在第 10 季后主动停止：第 10 季单次已用 214 秒，继续会使基线测试持续数小时；这不是第 30 季实测值。第 6 季墙钟时间包含为独立浏览器测量而暂停进程的时间，应该使用其 CPU 时间；其他赛季也与部分浏览器测试并发，比较时应优先看 CPU 时间与重复测量。

## 当前基线的限制

- 本机没有已安装的 Lighthouse/Playwright，未在仓库添加依赖。已实际用 Chrome CDP 采集性能条目；Lighthouse 分数尚无，不填造数字。
- 未使用真实 iPhone 14 Pro；CPU 降速、GPU、内存与真实 iOS Safari 不等价。
- 页面 fixture 包含开发态同步造状态和 React StrictMode；首次加载必须以上述生产构建记录为准。
- `MemoryStorageAdapter` 存读档不代表 localStorage 实际落盘延迟；浏览器端存储需另外复测。
