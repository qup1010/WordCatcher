import { beforeEach, describe, expect, it } from 'vitest'
import { extractContext } from './selection-context'

/** 在给定文本节点上按字符下标造一个选区 */
function rangeIn(node: Node, start: number, end: number): Range {
  const range = document.createRange()
  range.setStart(node, start)
  range.setEnd(node, end)
  return range
}

function textNodeOf(el: Element, index = 0): Text {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let n = walker.nextNode()
  for (let i = 0; i < index && n; i++) n = walker.nextNode()
  return n as Text
}

/** 在 html 里找到 needle 第 occurrence 次出现的位置并选中它 */
function selectWord(html: string, needle: string, occurrence = 1): Range {
  document.body.innerHTML = html
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)

  let seen = 0
  let node = walker.nextNode()
  while (node) {
    const text = node.textContent ?? ''
    let from = 0
    for (;;) {
      const at = text.indexOf(needle, from)
      if (at === -1) break
      seen++
      if (seen === occurrence) return rangeIn(node, at, at + needle.length)
      from = at + 1
    }
    node = walker.nextNode()
  }
  throw new Error(`没找到第 ${occurrence} 个「${needle}」`)
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('extractContext', () => {
  it('从段落中抓出划选词所在的那一句', () => {
    const range = selectWord(
      '<p>This is the first sentence. The cat sat on the mat. And a third one.</p>',
      'sat',
    )
    const ctx = extractContext(range)!

    expect(ctx.selection).toBe('sat')
    expect(ctx.sentence).toBe('The cat sat on the mat.')
  })

  it('同一个词在段落里出现多次时，定位到实际划选的那个', () => {
    const html = '<p>The bank was closed. I walked along the river bank yesterday.</p>'

    const first = extractContext(selectWord(html, 'bank', 1))!
    expect(first.sentence).toBe('The bank was closed.')

    const second = extractContext(selectWord(html, 'bank', 2))!
    expect(second.sentence).toBe('I walked along the river bank yesterday.')
  })

  it('跨行内标签时仍能还原完整句子', () => {
    const range = selectWord(
      '<p>He was <em>utterly</em> <strong>devastated</strong> by the news. Then he left.</p>',
      'devastated',
    )
    const ctx = extractContext(range)!

    expect(ctx.selection).toBe('devastated')
    expect(ctx.sentence).toBe('He was utterly devastated by the news.')
  })

  it('不把英文缩写里的句点当成句子结尾', () => {
    const range = selectWord(
      '<p>Dr. Smith explained the mechanism clearly. Everyone understood.</p>',
      'mechanism',
    )
    expect(extractContext(range)!.sentence).toBe('Dr. Smith explained the mechanism clearly.')
  })

  it('不把小数点当成句子结尾', () => {
    const range = selectWord(
      '<p>The ratio increased to 3.14 during the surge. Later it fell.</p>',
      'surge',
    )
    expect(extractContext(range)!.sentence).toBe('The ratio increased to 3.14 during the surge.')
  })

  it('支持中文标点作为句子边界', () => {
    const range = selectWord(
      '<p>今天天气很好。我们去公园散步吧！明天再说。</p>',
      '散步',
    )
    expect(extractContext(range)!.sentence).toBe('我们去公园散步吧！')
  })

  it('压缩换行和多余空白', () => {
    const range = selectWord(
      '<p>The quick\n   brown   fox\tjumps over it. Next.</p>',
      'fox',
    )
    expect(extractContext(range)!.sentence).toBe('The quick brown fox jumps over it.')
  })

  it('列表项各自独立成上下文，不会串到相邻条目', () => {
    const range = selectWord(
      '<ul><li>Install the plugin first.</li><li>Then configure the endpoint.</li></ul>',
      'configure',
    )
    expect(extractContext(range)!.sentence).toBe('Then configure the endpoint.')
  })

  it('段落只有一句且没有结尾标点时，取整段', () => {
    const range = selectWord('<p>A lone fragment without punctuation</p>', 'fragment')
    expect(extractContext(range)!.sentence).toBe('A lone fragment without punctuation')
  })

  it('超长句子会以选区为中心裁剪', () => {
    const filler = 'padding words '.repeat(60)
    const range = selectWord(`<p>${filler}target ${filler}</p>`, 'target')
    const ctx = extractContext(range)!

    expect(ctx.sentence).toContain('target')
    expect(ctx.sentence.length).toBeLessThanOrEqual(420)
  })

  it('空选区返回 null', () => {
    document.body.innerHTML = '<p>hello world</p>'
    const node = textNodeOf(document.body)
    expect(extractContext(rangeIn(node, 3, 3))).toBeNull()
  })

  it('选区跨越两个段落时不会崩，且仍包含划选文本', () => {
    document.body.innerHTML = '<div><p>First para here.</p><p>Second para there.</p></div>'
    const first = textNodeOf(document.body, 0)
    const second = textNodeOf(document.body, 1)

    const range = document.createRange()
    range.setStart(first, 6)
    range.setEnd(second, 6)

    const ctx = extractContext(range)!
    expect(ctx.selection.length).toBeGreaterThan(0)
    expect(ctx.sentence.length).toBeGreaterThan(0)
  })
})
