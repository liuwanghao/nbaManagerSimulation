# 球员数据流水线

游戏使用版本化 JSON 快照，H5 运行时不会直接请求 NBA Stats：

1. 虎扑运行时提供当前阵容、中文资料、薪资与合同。
2. `nba_api` 离线工具提供基础、高阶、投篮、防守、追踪和拼抢数据。
3. 当前球员优先读取构建期生成的 NBA 2K27 API 离线快照：OVR 直接对齐来源值，35 项分项按 `nba2k27-eight-attribute-map.v1` 映射为游戏八维能力。API 没有完整档案时，才回退到 2025–26 统计模型并显式标记。官方 Top 100 快照继续用于 OVR 交叉校验。
4. `src/data/nba-player-dataset.json` 被 Vite 内联进单文件 `h5/index.html`，发布包不依赖 Python 或跨域请求。

## 更新基础统计快照

```bash
uv run --no-project --with-requirements tools/data/requirements.txt \
  python tools/data/build_nba_player_dataset.py \
  --current-season 2025-26 \
  --historical-seasons 2005-06,2006-07,2007-08,2008-09,2009-10,2010-11,2011-12,2012-13,2013-14,2014-15,2015-16,2016-17,2017-18,2018-19,2019-20,2020-21,2021-22,2022-23,2023-24,2024-25 \
  --generated-at 2026-09-17T00:00:00Z
```

`tools/data/hupu-player-id-map.json` 用 NBA person ID 作为 key，值为 `{ "hupuPlayerId": "...", "aliases": ["..."] }`。匹配优先级为显式 ID、英文别名、当前球队缩写 + 唯一球衣号码；这些都是确定性结构化键，禁止仅靠中文姓名猜测。未匹配球员继续使用虎扑基础统计的确定性降级模型。

## 一键同步 NBA 2K 球员档案

完整分项快照固定在 `src/data/nba2k27-current-ratings.json`，来源为 NBA2K API 的非官方 2K Ratings 数据；映射参数固定在 `src/data/nba2k27-rating-map.json`。API Key 只允许通过 `NBA2K_API_KEY` 环境变量传入，禁止写入源码、JSON、HTML 或 ZIP。

```bash
# 先只拉取、映射和校验，不改文件
NBA2K_API_KEY="..." npm run data:sync-players:dry-run

# 校验通过后原子更新快照、游戏数据和同步报告
NBA2K_API_KEY="..." npm run data:sync-players
```

统一入口 `tools/data/sync_player_data.mjs` 只调用一次版本化 bulk 接口，然后依次完成：

1. 把 API camelCase 属性标准化为稳定的 35 项离线字段。
2. 复用旧快照已有的精确分类能力；新增球员则由 35 项属性确定性推导分类能力。
3. 为可映射到本地数据集的真实球员下载 NBA 官方 CDN 真人头像（按 NBA Player ID），保存到维护目录 `tools/data/portrait-source/nba-{playerId}.png`；随后执行 `npm run data:build-portrait-atlas` 合成为保留透明背景的横向 WebP 精灵图组 `public/player-portraits/nba-atlas-*.webp`。官方源暂缺头像时才保留本地 2K 图片兜底。已存在官方文件会复用，失败不会阻断其余球员更新。
4. 更新 OVR、八维能力、耐伤和本地照片路径，但不使用 API 的球队归属覆盖 `nba-current-roster.json`。
5. 校验快照人数、官方名单覆盖率、联盟 OVR 分布、90+ 人数与官方 Top 100 误差。
6. 生成 `player-data-sync-report.json`，记录评分覆盖率、照片下载结果与内容指纹。

位置同步会把 `retainedInferredPositions`（全 2025–26 统计数据集）与 `currentRosterRetainedInferredPositions`（当前 NBA 名单）分开报告。自由球员、退役或离队球员可以通过 `nba-player-position-overrides.json` 保存已核实的 2K 主副位置，但该覆盖表不参与球队归属或扩军资格判断。

生产 H5 只内联更新后的 JSON和本地照片，不包含 API Key，也不会在浏览器里请求 NBA2K API 或远程图片。原来分离的抓取、应用脚本已由统一入口替代，避免只更新一半而产生快照与游戏数据版本错位。官方 Top 100 仍保存在 `src/data/nba2k27-top100-ratings.json`。

若只需更新真人头像、无需重新抓取 2K 能力值，不需要 API Key：

```bash
npm run data:sync-official-portraits
```

该命令只使用本地球员数据内的 NBA Player ID 请求 `cdn.nba.com`。成功时改写为本地相对路径；H5 运行时仍不请求该地址。

## 中文名显示顺序

1. 游戏状态中已经是中文的姓名原样显示。
2. 通过 NBA Player ID 查询 `nba-player-names-zh.json` 中的 NBA 中国离线快照。
3. 查询人工校验的完整姓名覆盖表，例如 CJ·麦科勒姆、克莱·汤普森。
4. 仅当英文姓名的每个有效单词都存在于校验词典时组合中文名。
5. 任意词无法确认时保留英文原名，不生成看似真实但错误的中文音译。

## 直接打开 H5

执行 `npm run build` 后，双击 `h5/index.html` 即可通过 `file://` 运行；入口使用相对路径和经典 IIFE 脚本，不要求启动 Vite 或 HTTP 服务。发布时需要保留 `h5/` 内的完整目录结构，不能只复制 `index.html`。

### 离线自由球员快照

在有网络的构建机上运行 `npm run data:sync-free-agents`，将 NBA 官方 Free Agent Tracker 的 2026 年未签约 UFA/RFA 记录按 NBA ID 保存至 `src/data/nba-2026-free-agents.json`。页面不可达时，可先下载 HTML，再运行 `node tools/data/sync_nba_free_agents.mjs --input /path/to/tracker.html`。同步脚本会拒绝错误赛季、空名单及重复 ID；游戏运行时不发起请求。

建档时优先保留球队阵容和已导入的 2026–27 合同，避免追踪页尚未更新的“未签约”记录覆盖已签约球员。当前快照于 2026-09-23 UTC 获取：官方 238 条记录中 70 条标记为未签约，经当前阵容及合同交叉排除后，56 名球员进入初始自由市场。约翰·康查尔、达伦·特里和朱利安·菲利普斯同时出现在追踪页“未签约”列表、官方球队名单及同球队的 2026–27 薪资行，按后两项证据保留在球队。NBA 追踪页不是实时交易清算接口，重新打包前应重同步并核实快照日期；2026 年程序化落选秀只保留选秀记录，不进入自由市场。后续赛季仍使用原有程序化选秀模型。

本次在队快照含 577 名球员。数据集另保留 3 名官方自由球员追踪页中的球员，共 580 人。542 名在队球员使用完整 2K27 档案；其余 35 人按位置、可得 NBA 基础统计及固定 ID 种子推导八维能力和总评，并以 `ENGINE_BASIC_STATS_ESTIMATE` 或 `ENGINE_POSITIONAL_ESTIMATE` 标记。自由球员 56 人中 51 人使用完整 2K27 档案，5 人使用相同的引擎评估规则。全部在队球员及自由球员的开档年龄来自 NBA 官方档案生日、已核实生日或 2026–27 虎扑薪资表年龄，不再沿用上赛季年龄；缺失年龄会阻止数据加载。薪资表的 486 条当季有薪资记录对应 485 名独立球员；两条斯宾塞·琼斯记录均为 2026–27 年 600 万、2027–28 年 575 万，合同只导入一次，重复来源行在报告中标为 `duplicate_target`。

文班亚马的 2030–31 年薪资在工作簿中为空，已按用户核实金额补为 5394 万美元；2031–32 年的 5742 万美元仍按工作簿保留为球员选项。导入器把这项补录固定到球员来源 ID 与赛季，若工作簿之后出现不同金额会直接报错。

官方在队名单 577 人中，52 名已选中的 2026 届新秀与 10 名 2026 届落选球员按现有扩军开档规则进入同年的新秀流程，因此开档球队阵容为 515 人；另有 56 名当前自由球员，开档总球员数为 571。新秀不会消失：选秀准备阶段从同一份 NBA 球员数据集生成 2026 届球员；对已取得 NBA ID 的 7 名原临时 ID 球员也直接沿用数据集年龄和能力。

真人头像按 NBA ID 从 NBA 官方 CDN 下载，并对 CDN 暂无照片的球员补充经大学官方球员页面核实的本人照片；来源记录在 `tools/data/portrait-source/supplemental-portrait-sources.json`。本次在队球员 577 人中 518 人有可核实真人头像，自由球员 56 人全部有；其余 59 人使用游戏默认头像，不把灰色剪影计为真人照片。开档实际入队的 515 人中仅 20 人仍缺可核实真人头像。

未来 Draft 默认从 2027 届起，每届从尚未使用的历史模板中按 Career / Season Seed 随机抽取最多 3 人，以“传奇原型”方式混入 80 人选秀班。相同 Seed 可复现，不同 Seed 会抽到不同组合；原球员姓名、来源 ID、真实潜力与成长率不会出现在公开球探 DTO。同一历史源在一个存档中最多使用一次，历史模板不足时只补剩余数量，耗尽后自动回退程序化新秀。
