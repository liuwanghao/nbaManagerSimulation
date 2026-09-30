# 展示图片优化

`optimize_display_images.mjs` 使用已有 Sharp 安装生成首页 660px WebP、64px favicon、256px 调色板 PNG 扩军队徽及 WebP 开幕背景。不向项目添加依赖。队徽保持分辨率，使用高质量调色板减少文件体积，70px 展示及高像素密度屏幕均已对比检查。示例：

```sh
node tools/assets/optimize_display_images.mjs --sharp-module /absolute/path/to/node_modules/sharp
```

队徽与背景原图保存在 `image-sources/`，不进入 H5 发布包；队徽继续使用原有 PNG 文件路径，兼容已有存档及榜单。`public/branding/home-logo-cutout.png` 保留原分辨率，供生涯与首发海报导出使用，首页使用 `home-logo-display.webp`。重新运行时始终读取原图，避免反复有损压缩。

体积与 SHA-256 记录位于 `reports/image-loading/2026-09-30/assets.json`。历史头像按需加载在 `src/app/retiredPortraitLoader.ts`，经典本地脚本保留 `file://` 兼容性，首页 HTML 不再加载该数据脚本。
