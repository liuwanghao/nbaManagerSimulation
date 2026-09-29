# 性能专项原始证据

所有时间为 2026-09-28 本机测量。`ms` 为毫秒；Chrome 指标来自 CDP，赛季指标来自固定种子 Node 进程。生产首页与开发态 fixture、浏览器存储与内存适配器的结果不能混用。

| 文件 | 内容 |
| --- | --- |
| `nba-perf-home.json`、`nba-perf-throttle.json` | 生产构建首次加载及 4×/6× CPU、Fast/Slow 4G |
| `nba-perf-pages2.json`、`nba-perf-page-memory.json` | 页面两次进入、Long Task、强制 GC 后堆大小 |
| `nba-perf-fixtures.json`、`nba-perf-interactions.json`、`more-interactions-corrected.json` | 阶段页面、筛选排序搜索与切页 |
| `nba-perf-fps-nav.json`、`nba-perf-loader.json`、`nba-perf-loader-after.json`、`nba-perf-loader-throttle.json` | RAF、Loading Paint trace、弱 CPU 下帧率与已撤销的动画试验 |
| `nba-perf-leak.json`、`nba-perf-dialog50.json`、`nba-perf-box50.json`、`nba-perf-longrun.jsonl` | 50 次往返及 30 分钟内存 |
| `nba-perf-ui-save.json`、`nba-perf-localstorage.json`、`nba-perf-quota.json`、`nba-perf-quota30.json` | 真实浏览器存读档、原始存储访问与按 30 季实际编码长度做的配额测试 |
| `nba-perf-sim-ui.json` | “模拟下一日”原速及 4×/6× CPU 主线程测试 |
| `nba-sim-perf.jsonl`、`nba-sim-perf-final.jsonl` | 缓存修改前的逐季、内存、存读档数据 |
| `nba-sim-perf-optimized.jsonl`、`season30-summary.json` | 缓存修改后的完整 30 季逐季记录与汇总 |
| `season11-profile-summary.json`、`nba-profile-late-progress.jsonl` | 第 11 季 CPU 采样排名与球员/自由球员池增长 |
| `nba-hash-compare.json`、`nba-draft-compare.json`、`free-agency-before-after.json` | 相同输入与状态的局部优化对照 |
| `extremes-corrected.jsonl`、`nba-list-stress.jsonl` | 赛程/季后赛/统计榜及大列表压力测试 |

原始 V8 `.cpuprofile` 文件体积较大，没有复制进仓库；`season11-profile-summary.json` 保留最高自耗时函数的采样数与调用链。详细方法、限制和结论见仓库根目录的 `PERFORMANCE_BASELINE.md` 与 `PERFORMANCE_REPORT.md`。
