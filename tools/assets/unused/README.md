# 闲置资源备份

这些文件从 `public/` 移出，保留原始内容和相对目录，不参与 Vite 构建或发布 ZIP。`manifest.json` 记录原路径、大小及 SHA-256，方便核对和恢复。

- `expansion-logos/*.svg`：8 个旧队徽，当前默认队徽使用 PNG。
- `story/championship-celebration.jpg`：当前没有页面使用的夺冠庆祝图。
- `assets/story/*.jpg`：重复的球馆背景和夺冠庆祝图。

游戏仍在使用的 `public/story/opening-arena.jpg`、开幕肖像和两张 PNG 队徽继续保留在 `public/`。

需要恢复时，将指定文件移回 `public/` 下的相同相对路径，并在页面中明确引用；不要把整个备份目录放回静态资源目录。
