/** 使用真实 React 组件和隔离的示例服务预览，不连接个人配置或外部接口。 */
import { createRequire } from 'node:module'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const vitePath = require.resolve('vite', { paths: [dirname(require.resolve('wxt'))] })
const { createServer } = await import(pathToFileURL(vitePath).href)
const server = await createServer({
  configFile: false,
  root,
  resolve: { alias: { '#imports': resolve(root, 'preview/runtime.ts'), '@': root } },
  esbuild: { jsx: 'automatic' },
  server: { host: '127.0.0.1', port: 18788, strictPort: true },
})
await server.listen()
console.log('交互预览（示例数据）：http://127.0.0.1:18788/preview/interactive.html?view=sidepanel')
