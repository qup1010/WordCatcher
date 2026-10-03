# 浏览器插件开发说明

用户安装与使用见 [项目 README](../README.md)。以下命令从仓库根目录执行。

## 环境与初始化

使用 Node.js 22 和 pnpm 10，与 [发布工作流](../.github/workflows/release.yml) 保持一致。

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

Windows PowerShell 若阻止运行 pnpm 的脚本入口，可改用 `pnpm.cmd`。安装后会通过 `postinstall` 执行 WXT prepare，生成被忽略的 `.wxt/` 配置。Firefox 开发模式使用 `pnpm dev:firefox`。

## 目录约定

```text
word-catcher/
├── entrypoints/                 # WXT 入口
│   ├── background.ts            # 翻译、Anki、缓存与消息分发
│   ├── content/                 # 网页选区、胶囊与查词卡片
│   ├── popup/                   # 工具栏查询与历史记录
│   ├── sidepanel/               # 侧边栏查询界面
│   └── options/                 # 设置页及分区组件
├── lib/                         # 设置、AI、Anki、语境、词典等共享模块
├── tests/
│   ├── unit/                    # 单元与组件回归测试
│   │   └── open-dict/           # 离线词典算法测试
│   └── helpers/                 # WXT 虚拟模块与本地存储桩件
├── assets/                      # 参与构建与图标生成的源资源
├── public/                      # 直接复制到扩展产物的静态资源
├── preview/                     # 静态展示与真实组件交互预览
├── scripts/                     # 图标、预览、发布工具
├── docs/                        # 文档、示例图片与验证记录
├── .github/workflows/           # 标签发布流程
└── .output/                     # WXT 构建与压缩包，不提交
```

保留 WXT 的 `entrypoints/lib/assets/public` 约定，不额外包一层 `src`。测试统一放在 `tests/unit`，不要混进业务模块目录。需要 WXT 存储桩件时使用 `tests/helpers/wxt-imports-stub.ts`；Vitest 的 `#imports` 别名指向同一个桩件。

`assets` 与 `public` 各有构建用途，不合并；`docs/images` 保存对外文档图片，`preview/__shots__` 保存可重复生成的本地截图。真实配置、API Key 和下载的词典不放进仓库。

## 验证与构建

```powershell
pnpm compile
pnpm test
pnpm build
pnpm build:firefox
```

Vitest 从 `tests/unit/**/*.test.ts` 收集测试；覆盖率针对 `lib/**/*.ts`，消息传输封装由界面测试中的桩件代替。增量测试可用 `pnpm test:watch`，覆盖率报告可用 `pnpm test:cov`，报告生成在被忽略的 `coverage/` 中。

| 命令 | 产物 |
| --- | --- |
| `pnpm build` | `.output/chrome-mv3/` |
| `pnpm build:firefox` | `.output/firefox-mv2/` |
| `pnpm zip` | `.output/word-catcher-<版本>-chrome.zip` |
| `pnpm zip:firefox` | `.output/word-catcher-<版本>-firefox.zip` |

Chrome 构建可以在 Edge 中加载。Firefox 打包成功不表示附加组件已签名，也不表示 `sidePanel` API 可用，需要分别验证实际浏览器交互。

## 界面预览与图标

```powershell
pnpm preview
pnpm preview:interactive
pnpm icons
```

- 静态预览：先构建，再在 `http://localhost:8787` 展示 `preview/` 中的示例页面。
- 交互预览：`http://127.0.0.1:18788/preview/interactive.html?view=sidepanel`，使用真实 React 组件与隔离的示例服务，可切换视图，不连接个人配置或外部接口。
- 图标：编辑 `assets/icon.svg`，运行 `pnpm icons` 更新发布资源。

预览只能确认示例状态下的视觉和交互，不能替代实际网页选区、浏览器权限、在线服务和真实 Anki 验收。两个预览服务持续运行，结束时使用 `Ctrl+C`。

## 产品展示图

README 使用 `docs/images/showcase.png`，版式和真实组件预览入口为 `preview/showcase.html` / `showcase.tsx`。更新方式见 [展示图说明](images/README.md)。此页面只使用演示数据，图片不能作为真实在线服务或 Anki 验收证据。

## 发布

[release.yml](../.github/workflows/release.yml) 在推送 `v*` 标签时运行类型检查和测试并生成 Chrome / Firefox 压缩包，然后创建 GitHub Release。手动触发工作流只执行构建，创建 Release 仍需要标签。

版本来自 `package.json`，发布前核对它与版本标签一致。`pnpm release` 会运行发布脚本，涉及 Git 提交、标签和推送；它不是本地预览或验证命令，使用前先检查 [脚本](../scripts/release.mjs) 与当前工作区。

## Git 与文档约定

- 提交源码、测试、文档、图标和 `pnpm-lock.yaml`；锁文件必须保留。
- 忽略依赖、WXT 生成目录、压缩包、覆盖率、测试结果、本地预览截图、日志、`.env`、本机 `web-ext.config.ts` 和 `.spec-workflow`，保留公开的 `.env.example` 与 `.vscode/extensions.json`。
- `.gitignore` 不会自动移除已经跟踪的文件；使用 `git ls-files -ci --exclude-standard` 检查。误跟踪的生成物应只取消索引跟踪，保留本机文件。
- 根 README 面向用户；开发约定放在本文件；历史验证保留原测试结果和明确边界。
- `.editorconfig` 统一 UTF-8（无 BOM）、缩进和换行，`.gitattributes` 固定文本换行及二进制资源类型。
