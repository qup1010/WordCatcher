/**
 * 样式预览工作台。
 *
 *   pnpm preview          起服务，浏览器里手动看
 *   pnpm preview --shot   额外渲染浅色/深色截图（需要装 playwright）
 *
 * 为什么需要这么个东西：三个界面里有两个（划词面板、popup）跑在扩展上下文里，
 * 设置页离开扩展也读不到配置直接白屏，所以改样式没法直接在浏览器里看。
 * 这里用构建产物的 CSS + preview/ 下的静态固件，把所有状态一次摆出来。
 *
 * 已经用它抓到过三个纯看代码看不出来的问题：媒体查询被后面的同优先级规则覆盖、
 * 报错文字紧贴按钮、服务商标签把词头挤到断字。
 */

import { createServer } from 'node:http'
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { extname, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const previewDir = join(root, 'preview')
const outDir = join(root, '.output', 'chrome-mv3')
const PORT = Number(process.env.PREVIEW_PORT ?? 8787)

/**
 * 固件里统一引用 /css/xxx.css，由这里映射到构建产物。
 * 产物文件名带内容哈希，每次构建都变，固件不能直接写死。
 */
const CSS_ROUTES = {
  'content.css': ['content-scripts', 'content.css'],
  'options.css': ['assets', /^options-.*\.css$/],
  'popup.css': ['assets', /^popup-.*\.css$/],
}

async function resolveCss() {
  const map = new Map()

  for (const [route, [dir, name]] of Object.entries(CSS_ROUTES)) {
    const dirPath = join(outDir, dir)
    if (!existsSync(dirPath)) continue

    const file = typeof name === 'string'
      ? name
      : (await readdir(dirPath)).find(f => name.test(f))

    if (file) map.set(route, join(dirPath, file))
  }
  return map
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
}

/**
 * 固件和样式表对不上的地方。
 *
 * 静态固件最大的毛病是会悄悄过期：组件改了类名，固件还在用老的，
 * 预览出来一切正常，实际界面已经变了。这里两个方向都查一遍。
 */
async function audit(cssMap) {
  const extensionCss = (await Promise.all(
    [...cssMap.values()].map(f => readFile(f, 'utf8')),
  )).join('\n')

  // 预览页自己的外壳（.case / .page / .popup-frame）不属于扩展，
  // 但也不能算成"固件用了不存在的类"，所以一起当作已知类
  const chromeCss = await readFile(join(previewDir, 'preview.css'), 'utf8')
  const cssText = extensionCss + '\n' + chromeCss

  const fixtures = (await readdir(previewDir)).filter(f => f.endsWith('.html'))
  const fixtureText = (await Promise.all(
    fixtures.map(f => readFile(join(previewDir, f), 'utf8')),
  )).join('\n')

  const sourceText = await readSources(join(root, 'entrypoints'))

  const cssClasses = new Set([...cssText.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map(m => m[1]))
  const fixtureClasses = new Set(
    [...fixtureText.matchAll(/class="([^"]+)"/g)].flatMap(m => m[1].split(/\s+/)).filter(Boolean),
  )

  const has = (text, name) => new RegExp(`\\b${name.replace(/-/g, '\\-')}\\b`).test(text)

  // 固件用了、但样式表里已经没有的类 —— 固件过期了
  const stale = [...fixtureClasses].filter(c => !cssClasses.has(c) && !c.startsWith('wc-sk'))

  // 样式表里有、但固件和源码都没用的类 —— 多半是删组件时漏掉的死 CSS。
  // 只查扩展自己的样式表，预览页的外壳类不算。
  const extensionClasses = new Set(
    [...extensionCss.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map(m => m[1]),
  )
  const orphan = [...extensionClasses].filter(
    c => !fixtureClasses.has(c) && !has(sourceText, c),
  )

  if (stale.length) {
    console.log(`\n⚠ 固件里这些类样式表已经没有了，预览不准：\n  ${stale.join(', ')}`)
  }
  if (orphan.length) {
    console.log(`\n· 样式表里没人用的类（可能是死 CSS）：\n  ${orphan.join(', ')}`)
  }
  if (!stale.length && !orphan.length) {
    console.log('\n✔ 固件与样式表一致，没有孤立的类')
  }
}

async function readSources(dir) {
  let text = ''
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) text += await readSources(p)
    else if (/\.tsx?$/.test(entry.name)) text += await readFile(p, 'utf8')
  }
  return text
}

async function serve() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    let path = decodeURIComponent(url.pathname)
    if (path === '/') path = '/index.html'

    // 每次都必须拿到最新的 CSS。之前用现成的静态服务器，改完样式重新构建、
    // 截图却纹丝不动，两次都是浏览器缓存住了旧的 CSS——这个坑不能再踩。
    res.setHeader('Cache-Control', 'no-store, must-revalidate')

    try {
      /*
       * 每次请求都重新解析产物文件名，不能在启动时算一次就缓存。
       * 产物名带内容哈希，另一个终端里重新构建之后哈希就变了，
       * 缓存住的旧路径会 404——页面看起来是"样式全丢了"，很容易误判成 CSS 写坏了。
       */
      const cssName = path.startsWith('/css/') ? path.slice(5) : null
      const file = cssName
        ? (await resolveCss()).get(cssName) ?? join(previewDir, cssName)
        : join(previewDir, path)

      const body = await readFile(file)
      res.setHeader('Content-Type', MIME[extname(file)] ?? 'application/octet-stream')
      res.end(body)
    } catch {
      res.statusCode = 404
      res.end('not found')
    }
  })

  await new Promise(resolve => server.listen(PORT, resolve))
  return server
}

/** 截图是可选能力：playwright 太重，不值得为它进 devDependencies */
async function shoot() {
  let chromium
  try {
    ({ chromium } = await import('playwright'))
  } catch {
    console.log(
      '\n--shot 需要 playwright：\n'
      + '  pnpm add -D playwright && npx playwright install chromium',
    )
    return
  }

  const shotDir = join(previewDir, '__shots__')
  await mkdir(shotDir, { recursive: true })

  const fixtures = (await readdir(previewDir)).filter(f => f.endsWith('.html'))
  const browser = await chromium.launch()

  for (const scheme of ['light', 'dark']) {
    const page = await browser.newPage({ colorScheme: scheme, viewport: { width: 1180, height: 900 } })
    for (const f of fixtures) {
      await page.goto(`http://127.0.0.1:${PORT}/${f}`)
      // 固件里已经关掉了入场动画，这里只等字体和布局稳定
      await page.waitForTimeout(250)
      const out = join(shotDir, `${f.replace('.html', '')}-${scheme}.png`)
      await page.screenshot({ path: out, fullPage: true })
      console.log(`  ${out.replace(root + '\\', '').replace(root + '/', '')}`)
    }
    await page.close()
  }

  await browser.close()
}

// ── 主流程 ──────────────────────────────────────

if (!existsSync(outDir)) {
  console.error('没找到构建产物，先跑一次 pnpm build')
  process.exit(1)
}

const cssMap = await resolveCss()
if (cssMap.size === 0) {
  console.error('构建产物里没有 CSS，检查 .output/chrome-mv3')
  process.exit(1)
}

const server = await serve()
const fixtures = (await readdir(previewDir)).filter(f => f.endsWith('.html'))

console.log(`\n样式预览  http://127.0.0.1:${PORT}\n`)
for (const f of fixtures) console.log(`  http://127.0.0.1:${PORT}/${f}`)

await audit(cssMap)

if (process.argv.includes('--shot')) {
  console.log('\n截图：')
  await shoot()
  server.close()
} else {
  console.log('\nCtrl+C 退出')
}
