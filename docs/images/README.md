# 浏览器插件展示图

`showcase.png` 是根 README 使用的 1600 × 1000 展示图。版式源文件为 `preview/showcase.html`，`preview/showcase.tsx` 挂载当前内容脚本组件，并在示例文章中划选单词、打开 AI 释义。

展示页由交互预览服务提供，使用 `preview/runtime.ts` 中的演示数据；不读取个人浏览器配置、查询历史或 API Key，不连接真实 AI / Anki 服务。图中的查询结果是示例，不是一次真实服务调用的验收证据。

## 更新方式

在仓库根目录启动预览服务：

```powershell
pnpm preview:interactive
```

另开终端，在可用的 Playwright 与本机 Chrome 环境中导出；使用 Edge 时将 `--channel chrome` 改为 `--channel msedge`。

```powershell
npx playwright screenshot --channel chrome --viewport-size "1600,1000" --color-scheme light --wait-for-selector "body[data-showcase-ready=true]" --timeout 20000 http://127.0.0.1:18788/preview/showcase.html docs/images/showcase.png
```

展示页等待字体、图片及示例结果完成后才设置 `data-showcase-ready`。选区使用文本节点的实际端点，图中应能看到完整原句及高亮的单词。若组件未就绪，导出命令会超时，不应改为盲目截图。

生成后人工检查品牌、文章、完整语境、面板底部按钮、留白和裁切。产品组件变化时重新导出，不在图片上手动改造产品界面。版式和预览逻辑随图片一同提交。
