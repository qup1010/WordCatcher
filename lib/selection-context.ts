/**
 * 从划选位置反推出完整原句。
 *
 * 这是整个插件里最容易做得半吊子的部分，思路是：
 *   1. 找到包住选区的那个块级元素（通常是 <p>）
 *   2. 在它的纯文本里精确算出选区的字符偏移（靠 TreeWalker，不靠字符串查找，
 *      否则同一个词在段落里出现多次时会定位到错的那个）
 *   3. 从偏移处向两边扩展到句子边界
 *
 * 全程在未规范化空白的原始文本上做偏移计算，最后才压缩空白，
 * 这样偏移不会因为空白被压掉而错位。
 */

const BLOCK_TAGS = new Set([
  'P', 'DIV', 'LI', 'TD', 'TH', 'BLOCKQUOTE', 'ARTICLE', 'SECTION', 'MAIN',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'DD', 'DT', 'FIGCAPTION', 'PRE', 'BODY',
])

/** 句子结束符。英文的 . 需要额外判断，避免 Mr. / e.g. 被当成句末 */
const SENTENCE_END = /[.!?。！？…；;]/

const MAX_SENTENCE_LENGTH = 400

function findBlockAncestor(node: Node): HTMLElement {
  let el: Node | null = node.nodeType === Node.ELEMENT_NODE ? node : node.parentNode

  while (el && el.nodeType === Node.ELEMENT_NODE) {
    const tag = (el as HTMLElement).tagName
    if (BLOCK_TAGS.has(tag)) return el as HTMLElement
    el = el.parentNode
  }
  return document.body
}

/** 算出 container/offset 这个位置，在 root 的纯文本里排第几个字符 */
function textOffsetWithin(root: Node, container: Node, offset: number): number {
  // 选区端点落在元素节点上时，offset 是子节点索引而非字符索引，
  // 先把它归一化成一个文本节点位置
  if (container.nodeType !== Node.TEXT_NODE) {
    const child = container.childNodes[offset]
    if (child) {
      container = child
      offset = 0
    }
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let total = 0
  let node = walker.nextNode()

  while (node) {
    if (node === container) return total + offset
    total += node.textContent?.length ?? 0
    node = walker.nextNode()
  }
  return -1
}

/** 判断 text[i] 处的 '.' 是不是真的句号（排除缩写和小数） */
function isRealPeriod(text: string, i: number): boolean {
  const next = text[i + 1]
  // 后面不是空白或结尾，多半是小数点或域名
  if (next && !/\s/.test(next)) return false

  // 常见缩写：句点前是单个大写字母，或落在已知缩写词尾
  const before = text.slice(Math.max(0, i - 5), i)
  if (/(^|\s)[A-Z]$/.test(before)) return false
  if (/(Mr|Mrs|Ms|Dr|Prof|St|Inc|Ltd|vs|etc|e\.g|i\.e)$/i.test(before)) return false

  return true
}

const INLINE_SPACE = /[ \t\r]/

/**
 * 换行是否构成段落分隔。
 *
 * HTML 里段落内部的 \n 绝大多数只是源码折行，不是断句——真正的段落分隔靠块级元素，
 * 已经由 findBlockAncestor 处理了。所以只有空行（连续换行）才算边界，
 * 这样 <pre> 里的分段仍然有效，普通段落又不会被源码缩进切碎。
 */
function isBlankLine(text: string, i: number): boolean {
  let before = i - 1
  while (before >= 0 && INLINE_SPACE.test(text[before])) before--
  if (before >= 0 && text[before] === '\n') return true

  let after = i + 1
  while (after < text.length && INLINE_SPACE.test(text[after])) after++
  return after < text.length && text[after] === '\n'
}

function isSentenceEnd(text: string, i: number): boolean {
  const ch = text[i]
  if (ch === '\n') return isBlankLine(text, i)
  if (!SENTENCE_END.test(ch)) return false
  if (ch === '.') return isRealPeriod(text, i)
  return true
}

function scanBackward(text: string, from: number): number {
  for (let i = from - 1; i >= 0; i--) {
    if (isSentenceEnd(text, i)) return i + 1
  }
  return 0
}

function scanForward(text: string, from: number): number {
  for (let i = from; i < text.length; i++) {
    if (isSentenceEnd(text, i)) return i + 1
  }
  return text.length
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export interface SelectionContext {
  /** 用户实际划选的文本 */
  selection: string
  /** 划选所在的完整句子；抓不到时退化成划选文本本身 */
  sentence: string
  /**
   * selection 在 sentence 中的起始字符偏移。
   *
   * 这个值必须一路带到高亮和 Anki 挖空：靠 indexOf 重新查找会匹配到
   * 第一个包含该子串的位置——划 "present" 会命中 "representation"，
   * 于是高亮错位、卡片挖错词。
   */
  offset: number
}

export function extractContext(range: Range): SelectionContext | null {
  const selection = collapseWhitespace(range.toString())
  if (!selection) return null

  const block = findBlockAncestor(range.commonAncestorContainer)
  const blockText = block.textContent ?? ''

  const start = textOffsetWithin(block, range.startContainer, range.startOffset)
  const end = textOffsetWithin(block, range.endContainer, range.endOffset)

  // 定位失败就老实退回划选文本，不要瞎猜一个句子出来
  if (start < 0 || end < 0 || start >= end) {
    return { selection, sentence: selection, offset: 0 }
  }

  let from = scanBackward(blockText, start)
  let to = scanForward(blockText, end)

  // 句子太长时以选区为中心裁剪，别把整段塞给 AI
  if (to - from > MAX_SENTENCE_LENGTH) {
    const pad = Math.floor((MAX_SENTENCE_LENGTH - (end - start)) / 2)
    from = Math.max(from, start - Math.max(pad, 0))
    to = Math.min(to, end + Math.max(pad, 0))
  }

  // 分三段压缩空白，这样选区的偏移在压缩后仍然算得准；
  // 整句一次性压缩会让偏移失去意义。
  const rawBefore = blockText.slice(from, start)
  const rawSel = blockText.slice(start, end)
  const rawAfter = blockText.slice(end, to)

  const before = collapseWhitespace(rawBefore)
  const middle = collapseWhitespace(rawSel)
  const after = collapseWhitespace(rawAfter)

  // collapseWhitespace 会 trim 掉两端，被吃掉的分词空格要补回来
  const gapBefore = before && middle && /\s$/.test(rawBefore) ? ' ' : ''
  const gapAfter = middle && after && /^\s/.test(rawAfter) ? ' ' : ''

  const sentence = before + gapBefore + middle + gapAfter + after
  if (!sentence) return { selection, sentence: selection, offset: 0 }

  return {
    selection: middle || selection,
    sentence,
    offset: before.length + gapBefore.length,
  }
}

export function getCurrentContext(): SelectionContext | null {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null
  return extractContext(sel.getRangeAt(0))
}
