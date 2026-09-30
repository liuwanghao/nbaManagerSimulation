# 结果海报发帖接口契约

## OSS 上传

```js
const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png', 0.92));
const response = await window.ColorboxAI.oss.uploadFile({
  file: blob,
  filename: `result-poster-${Date.now()}.png`
});
if (!response || !response.downloadUrl) throw new Error('海报上传失败');
```

`file` 必须是 HTML5 `File` 或 `Blob`。单文件不能超过 10MB；上传失败、未登录或返回缺少 `downloadUrl` 时立即结束分享流程。不要在页面保存 `authToken`，不要直连 OSS。

业务代码应在调用编辑器前用 `new URL(downloadUrl)` 校验返回值为带 hostname 的绝对 `https:` URL；不符合要求时停止流程，不得把不可信地址传给编辑器。

## 发帖编辑器

```js
const bbs = await window.ColorboxAI.bbsConfig.get();
const params = {
  title: '我的活动结果',
  content: '我在本次活动中获得 1280 分，排名第 4。',
  imageUrl: uploadResponse.downloadUrl
};
if (bbs && typeof bbs.bbsTagId === 'string' && bbs.bbsTagId.trim() !== '') {
  params.topicId = bbs.bbsTopicId;
  params.tagId = bbs.bbsTagId;
  params.topicName = bbs.bbsTopicName;
  params.tagName = bbs.bbsTagName;
}
const response = await window.ColorboxAI.request.bbs.openPostEditor(params);
if (!response || response.code !== 200) throw new Error(response?.message || '发帖编辑器打开失败');
```

只在用户主动点击分享按钮后调用。禁止用 `location`、`window.open` 或自拼 Schema 代替 SDK。`content` 可为字符串或富文本段落数组；结果正文应限制长度，避免把未校验的 HTML 当作富文本传入。专区/话题分三种情况：业务明确指定非空值时用该值；业务明确不要设置时不要传这四个字段、也不要从 `bbsConfig.get()` 补；业务未提及时先 `bbsConfig.get()`，必须先判断 `bbsTagId`，无值或空字符串时四个字段都不要传、也不要用页面其它字段兜底，仅当 `bbsTagId` 为非空字符串才传入页面值。不要写死其它专区/话题。

## 推荐流程

```text
结果数据 → Canvas 生成 PNG Blob → OSS uploadFile → 读取 downloadUrl
       → openPostEditor(title, content, imageUrl) → 展示成功/取消反馈
```

分享流程应可重复执行，但每次点击只能有一个进行中的上传/唤起操作。上传成功而编辑器失败时保留海报预览，并提示用户稍后重新点击分享；不要自动再次上传。
