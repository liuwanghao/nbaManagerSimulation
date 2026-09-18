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
3. 为可映射到本地数据集的真实球员下载 NBA 官方 CDN 真人头像（按 NBA Player ID），保存到 `public/player-portraits/nba-{playerId}.png`；官方源暂缺头像时才保留本地 2K 图片兜底。已存在官方文件会复用，失败不会阻断其余球员更新。
4. 更新 OVR、八维能力、耐伤和本地照片路径，但不使用 API 的球队归属覆盖 `nba-current-roster.json`。
5. 校验快照人数、官方名单覆盖率、联盟 OVR 分布、90+ 人数与官方 Top 100 误差。
6. 生成 `player-data-sync-report.json`，记录评分覆盖率、照片下载结果与内容指纹。

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

未来 Draft 默认从 2027 届起，每届从尚未使用的历史模板中按 Career / Season Seed 随机抽取最多 3 人，以“传奇原型”方式混入 80 人选秀班。相同 Seed 可复现，不同 Seed 会抽到不同组合；原球员姓名、来源 ID、真实潜力与成长率不会出现在公开球探 DTO。同一历史源在一个存档中最多使用一次，历史模板不足时只补剩余数量，耗尽后自动回退程序化新秀。
