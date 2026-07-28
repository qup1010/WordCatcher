/**
 * 从 assets/*.svg 生成 public/icon 下的各尺寸 PNG。
 *
 *   node scripts/build-icons.mjs
 *
 * 改了图标设计就重跑一次，别手工去 P 四个 PNG——尺寸之间对不齐是必然的。
 *
 * 小尺寸单独用一份 SVG：128 版直接缩到 16px 会糊，见 icon-small.svg 里的说明。
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'public', 'icon')

/** 尺寸 → 用哪份源文件 */
const TARGETS = [
  { size: 16, src: 'icon-small.svg' },
  { size: 32, src: 'icon-small.svg' },
  { size: 48, src: 'icon.svg' },
  { size: 96, src: 'icon.svg' },
  { size: 128, src: 'icon.svg' },
]

/** 底色，用来判断"这个像素上画了东西没有" */
const BG = { r: 0x0e, g: 0x6f, b: 0x63 }

/**
 * 字母是用 <text> 画的，依赖系统里有 Georgia 之类的衬线字体。
 * 缺字体时 librsvg 不会报错，只会安静地少画一个字母——生成的图标就是
 * 一个纯色方块加一道横线，不盯着看根本发现不了。这里主动验一下。
 *
 * 判据是"比底色亮很多的像素占比"，不是"纯白像素数"：16px 那版整个字母
 * 都由抗锯齿的过渡色构成，按纯白去数会把正常的图也判成失败。
 */
async function assertGlyphRendered(png, size) {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })

  let painted = 0
  for (let i = 0; i < data.length; i += info.channels) {
    const delta = Math.abs(data[i] - BG.r) + Math.abs(data[i + 1] - BG.g) + Math.abs(data[i + 2] - BG.b)
    if (delta > 90) painted++
  }

  // 字母加划线正常占画面 15% 以上，只有划线的话大约 6%，取中间划线
  const ratio = painted / (size * size)
  if (ratio < 0.1) {
    throw new Error(
      `${size}px 的字母没画出来（非底色像素只占 ${(ratio * 100).toFixed(1)}%）。`
      + '多半是系统里没有 Georgia 等衬线字体，装一个再重跑。',
    )
  }
}

await mkdir(outDir, { recursive: true })

for (const { size, src } of TARGETS) {
  const svg = await readFile(join(root, 'assets', src))

  // 一律先渲染成 512 再降采样：直接按目标尺寸渲染的话，
  // 小图的字母边缘会被 librsvg 硬切出锯齿
  const png = await sharp(svg, { density: 512 })
    .resize(512, 512)
    .resize(size, size, { kernel: 'lanczos3' })
    .png({ compressionLevel: 9 })
    .toBuffer()

  await assertGlyphRendered(png, size)
  await writeFile(join(outDir, `${size}.png`), png)
  console.log(`✔ ${size}.png  ←  ${src}`)
}
