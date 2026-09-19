# 虎扑静态 H5 包安全复核说明

本包为 `file://` 可直接打开的离线单页游戏，全部球员资料、图像、配置和存档都在本地。运行时没有加载配置、提交成绩、登录、统计、分享或其他业务网络请求，因此没有应改用 `window.ColorboxAI.request` 的接口。`src/platform/PlatformAdapter.ts` 使用匿名访客与本地 `LocalStorageAdapter`；上线前仍须由产品与安全团队书面确认“无需任何网络请求”。此文档仅为开发侧核查记录，不能代替该确认。

构建产物核查：

- `h5/index.html` 使用相对路径加载本地经典脚本 `./assets/game.js`，不依赖 ES 模块请求或开发服务器。
- `vite.config.ts` 的打包钩子从 React 生产错误码提示中移除了 `https://react.dev/errors/`，保留错误码文本；React 原链接本来也只是异常消息，并非浏览器请求。
- 画像图集 `player-portraits/nba-atlas-000.jpg` 至 `025.jpg` 使用源码明确列出的静态路径；两张 `story/*.jpg` 也为固定路径。构建时检查所有 `public/` 文件和打包副本的 SHA-256 一致，并生成包内的 `local-assets-manifest.json`，列出各资源路径、字节数与校验和。React 内部的图片预加载/属性处理代码不代表远程资源；当前 `game.js` 不含 `assets/` 动态拼接文本。
- 应用源码不调用 `eval`、`new Function`、`Object.assign`、`Object.defineProperty`、`innerHTML` 或 `insertAdjacentHTML`。压缩包中 `innerHTML` 与原型处理候选项位于 React 19 框架的 DOM 属性与对象处理路径；业务界面没有向 `dangerouslySetInnerHTML` 传入玩家或存档文本。
- `localStorage` 只保存匿名游戏进度、检查点等数据。没有手机号、openid、unionid 等身份字段的采集或存储；`new Response(stream)` 仅将本地 gzip 存档流转为字符串，并不是 HTTP 请求。
- `assets/game.js` 构建时强制低于 5 MiB。为兼容直接打开本地文件，当前使用单个经典脚本，而不是浏览器需要额外模块加载的异步分包；弱网首屏体积仍是待评估的性能项，不能声称已完成懒加载优化。

交付前运行 `npm run build`、测试，并对 ZIP 执行 `unzip -t` 和 `unzip -l`；若发布平台仍将已解压存在的二进制标为 `materialized: false`，应附 ZIP 文件列表请平台人工复核。
