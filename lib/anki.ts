import { TIMEOUT, isTimeout, timeout } from './net'
import type { CapturedCard, Settings } from './types'

/**
 * AnkiConnect 客户端。
 *
 * 协议极简：所有请求都是 POST 到同一个地址，靠 action 字段区分，
 * 响应固定是 { result, error }，error 非空即失败。
 *
 * 注意：这些函数只能在 background 里调用。background 有 host_permissions，
 * 发出的请求不受 CORS 限制；从内容脚本直接发会被浏览器按页面 origin 拦下来。
 */

export const ANKI_FIELDS = [
  'Word',
  'Reading',
  'PartOfSpeech',
  'Definition',
  'MemoryHook',
  'Sentence',
  'SentencePlain',
  'SentenceTranslation',
  'Source',
] as const

export class AnkiError extends Error {
  constructor(message: string, readonly kind: 'unreachable' | 'api') {
    super(message)
    this.name = 'AnkiError'
  }
}

async function invoke<T>(
  url: string,
  action: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, version: 6, params }),
      signal: timeout(TIMEOUT.anki),
    })
  } catch (err) {
    throw new AnkiError(
      isTimeout(err)
        // 本地请求正常是毫秒级，超时几乎只有一个原因：Anki 被模态框卡住了
        ? `Anki 超过 ${TIMEOUT.anki / 1000} 秒没有响应。切到 Anki 窗口看看是不是有对话框等着确认。`
        : '连不上 Anki。请确认 Anki 桌面版正在运行，且已安装 AnkiConnect 插件。',
      'unreachable',
    )
  }

  if (!res.ok) {
    throw new AnkiError(`AnkiConnect 返回 HTTP ${res.status}`, 'api')
  }

  const data = (await res.json()) as { result: T, error: string | null }
  if (data.error) throw new AnkiError(data.error, 'api')
  return data.result
}

export async function checkConnection(url: string): Promise<number> {
  return invoke<number>(url, 'version')
}

/**
 * 转义 Anki 搜索语法里的元字符。
 *
 * `*` 和 `_` 是通配符，`"` 会截断搜索词，`\` 是转义符本身。
 * 不转义的话，划到「*」开头的词会把整个牌组匹配出来，误报成"已收藏"。
 */
export function escapeQuery(value: string): string {
  return value.replace(/[\\"*_:]/g, ch => `\\${ch}`)
}

/**
 * 这个词是不是已经在牌组里了。
 *
 * 用途是在存卡之前就把「已收藏」显示出来——等点了保存才被 Anki 以
 * duplicate 拒绝，用户已经白白读完一遍面板了。
 *
 * 查重口径和 addNote 的 duplicateScope 保持一致：同牌组 + 同笔记类型 + 首字段相同。
 */
export async function findExisting(word: string, s: Settings): Promise<number[]> {
  const needle = word.trim()
  if (!needle) return []

  const query = [
    `"deck:${escapeQuery(s.anki.deckName)}"`,
    `"note:${escapeQuery(s.anki.noteTypeName)}"`,
    `"Word:${escapeQuery(needle)}"`,
  ].join(' ')

  return invoke<number[]>(s.anki.url, 'findNotes', { query })
}

/** 把原句里的目标词换成空格，正面才有"在语境中回忆"的效果 */
export function buildClozeSentence(sentence: string, selection: string, offset = -1): string {
  const at = resolveOffset(sentence, selection, offset)
  if (at < 0) return escapeHtml(sentence) // 对不上就不挖，宁可不挖也别挖错

  const needle = selection.trim()
  return (
    escapeHtml(sentence.slice(0, at))
    + '<span class="wc-blank">[&nbsp;?&nbsp;]</span>'
    + escapeHtml(sentence.slice(at + needle.length))
  )
}

/**
 * 定位目标词在原句中的位置。
 *
 * 优先用内容脚本给的精确偏移，只有它对不上（旧数据、原句被改写）时才退回查找。
 * 纯查找会挖错词：划 "present" 会命中 "representation" 里的那个。
 */
export function resolveOffset(sentence: string, selection: string, hint: number): number {
  const needle = selection.trim()
  if (!needle) return -1

  if (hint >= 0 && sentence.slice(hint, hint + needle.length) === needle) return hint
  return sentence.toLowerCase().indexOf(needle.toLowerCase())
}

/** 四种复习模式，顺序即卡片模板 ord（0..3），分流到子牌组时按此映射 */
export const ANKI_MODES = ['Context', 'Recognition', 'Production', 'Listening'] as const
export type AnkiMode = (typeof ANKI_MODES)[number]

export function modeDeckName(deckName: string, mode: AnkiMode): string {
  return `${deckName}::${mode}`
}

function cardTemplates(ttsLang: string) {
  return [
    {
      Name: 'Context' as const,
      Front: `
<div class="wc-sentence">{{Sentence}}</div>
{{#PartOfSpeech}}<div class="wc-pos">{{PartOfSpeech}}</div>{{/PartOfSpeech}}
`.trim(),
      Back: `
{{FrontSide}}
<hr id=answer>
<div class="wc-word">{{Word}}{{#Reading}} <span class="wc-reading">/{{Reading}}/</span>{{/Reading}}</div>
<div class="wc-tts">{{tts ${ttsLang}:Word}}</div>
<div class="wc-def">{{Definition}}</div>
{{#MemoryHook}}<div class="wc-hook"><span class="wc-hook-label">💡 记忆线索</span> {{MemoryHook}}</div>{{/MemoryHook}}
{{#SentencePlain}}<div class="wc-full">{{SentencePlain}}</div>{{/SentencePlain}}
{{#SentenceTranslation}}<div class="wc-trans">{{SentenceTranslation}}</div>{{/SentenceTranslation}}
{{#Source}}<div class="wc-source">{{Source}}</div>{{/Source}}
`.trim(),
    },
    {
      Name: 'Recognition' as const,
      Front: `
<div class="wc-word">{{Word}}</div>
`.trim(),
      Back: `
{{FrontSide}}
<hr id=answer>
<div class="wc-def">{{Definition}}</div>
{{#MemoryHook}}<div class="wc-hook"><span class="wc-hook-label">💡 记忆线索</span> {{MemoryHook}}</div>{{/MemoryHook}}
<div class="wc-tts">{{tts ${ttsLang}:Word}}</div>
`.trim(),
    },
    {
      Name: 'Production' as const,
      Front: `
<div class="wc-def">{{Definition}}</div>
`.trim(),
      Back: `
{{FrontSide}}
<hr id=answer>
<div class="wc-word">{{Word}}{{#Reading}} <span class="wc-reading">/{{Reading}}/</span>{{/Reading}}</div>
<div class="wc-tts">{{tts ${ttsLang}:Word}}</div>
{{#MemoryHook}}<div class="wc-hook"><span class="wc-hook-label">💡 记忆线索</span> {{MemoryHook}}</div>{{/MemoryHook}}
`.trim(),
    },
    {
      Name: 'Listening' as const,
      Front: `
<div class="wc-tts">{{tts ${ttsLang}:Word}}</div>
<div class="wc-listen-hint">听音</div>
`.trim(),
      Back: `
{{FrontSide}}
<hr id=answer>
<div class="wc-word">{{Word}}{{#Reading}} <span class="wc-reading">/{{Reading}}/</span>{{/Reading}}</div>
<div class="wc-tts">{{tts ${ttsLang}:Word}}</div>
<div class="wc-def">{{Definition}}</div>
{{#MemoryHook}}<div class="wc-hook"><span class="wc-hook-label">💡 记忆线索</span> {{MemoryHook}}</div>{{/MemoryHook}}
`.trim(),
    },
  ]
}

const MODEL_CSS = `
.card {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
  font-size: 21px;
  text-align: left;
  color: #221f1a;
  background: #fdfcf9;
  padding: 28px 32px;
  line-height: 1.8;
  max-width: 460px;
  margin: 0 auto;
  border-radius: 12px;
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.04);
}

.wc-sentence {
  font-size: 24px;
  margin-bottom: 16px;
  font-weight: 500;
}

.wc-blank {
  color: #b45309;
  font-weight: 700;
  border-bottom: 2px solid #b45309;
  padding: 0 4px;
  background: rgba(180, 83, 9, 0.06);
  border-radius: 2px;
}

.wc-pos {
  margin-top: 12px;
  font-family: Georgia, "Times New Roman", serif;
  font-size: 16px;
  color: #0e6f63;
  font-style: italic;
}

.wc-word {
  margin-top: 8px;
  font-family: Georgia, "Times New Roman", serif;
  font-size: 36px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: #221f1a;
  line-height: 1.1;
}

.wc-reading {
  font-family: Georgia, "Times New Roman", serif;
  font-size: 20px;
  font-weight: 400;
  color: #a39c8f;
  margin-left: 4px;
}

.wc-listen-hint {
  margin-top: 14px;
  font-size: 16px;
  color: #a39c8f;
  letter-spacing: 0.06em;
  font-weight: 500;
}

.wc-def {
  margin-top: 14px;
  font-size: 20px;
  color: #3f3f3f;
  line-height: 1.6;
}

.wc-hook {
  margin-top: 16px;
  padding: 10px 14px 10px 12px;
  background: #f6f2e9;
  border-radius: 8px;
  border-left: 3px solid #b45309;
  font-size: 15px;
  color: #635b4f;
  line-height: 1.6;
}

.wc-hook-label {
  font-weight: 600;
  color: #92400e;
  margin-right: 4px;
}

.wc-full {
  margin-top: 18px;
  padding-left: 14px;
  border-left: 3px solid #0e6f63;
  color: #6d675d;
  font-size: 17px;
  line-height: 1.7;
}

.wc-trans {
  margin-top: 8px;
  font-size: 15px;
  color: #a39c8f;
  line-height: 1.6;
}

.wc-source {
  margin-top: 16px;
  font-size: 13px;
  color: #a39c8f;
}

.wc-source a {
  color: #a39c8f;
  text-decoration: none;
}

hr#answer {
  border: none;
  border-top: 1px solid #e8e3d9;
  margin: 22px 0 8px;
}

.nightMode .card,
.night_mode .card {
  color: #ece7dd;
  background: #23211d;
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.3);
}

.nightMode .wc-word,
.night_mode .wc-word {
  color: #ece7dd;
}

.nightMode .wc-pos,
.night_mode .wc-pos {
  color: #4fd1bb;
}

.nightMode .wc-blank,
.night_mode .wc-blank {
  color: #e8a94e;
  border-bottom-color: #e8a94e;
  background: rgba(232, 169, 78, 0.12);
}

.nightMode .wc-hook,
.night_mode .wc-hook {
  background: #2e2a24;
  color: #cfc6b8;
  border-left-color: #e8a94e;
}

.nightMode .wc-hook-label,
.night_mode .wc-hook-label {
  color: #e8a94e;
}

.nightMode .wc-full,
.night_mode .wc-full {
  color: #a89f90;
  border-left-color: #4fd1bb;
}

.nightMode .wc-listen-hint,
.night_mode .wc-listen-hint {
  color: #a89f90;
}

.nightMode hr#answer,
.night_mode hr#answer {
  border-top-color: #3a362e;
}
`.trim()

/** 确保牌组、子牌组和 Note Type 都存在；模型已存在时也会把模板刷到最新。 */
export async function ensureDeckAndModel(s: Settings): Promise<void> {
  const { url, deckName, noteTypeName, ttsLang } = s.anki

  const decks = await invoke<string[]>(url, 'deckNames')
  const wantedDecks = [deckName, ...ANKI_MODES.map(mode => modeDeckName(deckName, mode))]
  for (const name of wantedDecks) {
    if (!decks.includes(name)) {
      await invoke(url, 'createDeck', { deck: name })
    }
  }

  const models = await invoke<string[]>(url, 'modelNames')
  if (!models.includes(noteTypeName)) {
    await invoke(url, 'createModel', {
      modelName: noteTypeName,
      inOrderFields: [...ANKI_FIELDS],
      css: MODEL_CSS,
      isCloze: false,
      // AnkiConnect createModel 只认 Name/Front/Back，子牌组分流靠 addNote 后 changeDeck
      cardTemplates: cardTemplates(ttsLang),
    })
  } else {
    // 检查字段是否存在，缺少 MemoryHook 则补充
    try {
      const existingFields = await invoke<string[]>(url, 'modelFieldNames', { modelName: noteTypeName })
      for (const field of ANKI_FIELDS) {
        if (!existingFields.includes(field)) {
          await invoke(url, 'modelFieldSet', { modelName: noteTypeName, fields: [...existingFields, field] }).catch(() => {})
        }
      }
    } catch {
      // ignore
    }
    // 老模型（单模板 / 坏 Listening 正面）在这里修到最新四模式
    await updateModelTemplates(s)
  }
}

/** 改了 ttsLang 或想升级样式时调用，把模板刷成最新的 */
export async function updateModelTemplates(s: Settings): Promise<void> {
  const { url, noteTypeName, ttsLang } = s.anki
  const templates = cardTemplates(ttsLang)
  // 一次请求刷完所有模板，避免多次往返 + 中途失败留下半新半旧
  const templateMap: Record<string, { Front: string, Back: string }> = {}
  for (const tpl of templates) {
    templateMap[tpl.Name] = { Front: tpl.Front, Back: tpl.Back }
  }
  await invoke(url, 'updateModelTemplates', {
    model: { name: noteTypeName, templates: templateMap },
  })
  await invoke(url, 'updateModelStyling', {
    model: { name: noteTypeName, css: MODEL_CSS },
  })
}

/**
 * 把刚写入的笔记按模板 ord 拆到对应子牌组。
 *
 * 库存 AnkiConnect 的 createModel 不支持 deckOverride，只能 addNote 后 changeDeck。
 * 失败不致命：卡仍在主牌组，用户还能按模板筛选复习。
 */
async function routeCardsToModeDecks(noteId: number, s: Settings): Promise<void> {
  const { url, deckName } = s.anki
  const cardIds = await invoke<number[]>(url, 'findCards', { query: `nid:${noteId}` })
  if (cardIds.length === 0) return

  const infos = await invoke<Array<{ cardId: number, ord: number }>>(url, 'cardsInfo', {
    cards: cardIds,
  })

  const byDeck = new Map<string, number[]>()
  for (const info of infos) {
    const mode = ANKI_MODES[info.ord]
    if (!mode) continue
    const target = modeDeckName(deckName, mode)
    const list = byDeck.get(target) ?? []
    list.push(info.cardId)
    byDeck.set(target, list)
  }

  for (const [deck, cards] of byDeck) {
    await invoke(url, 'changeDeck', { cards, deck })
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function buildNoteFields(card: CapturedCard, s: Settings): Record<string, string> {
  // 挖空在未转义的原文上定位，由 buildClozeSentence 内部分段转义
  const cloze = buildClozeSentence(card.sentence, card.selection, card.sentenceOffset ?? -1)

  return {
    Word: escapeHtml(card.entry.word),
    Reading: escapeHtml(card.entry.reading),
    PartOfSpeech: escapeHtml(card.entry.partOfSpeech),
    Definition: escapeHtml(card.entry.definition),
    MemoryHook: escapeHtml(card.entry.memoryHook || ''),
    Sentence: s.anki.clozeContext ? cloze : escapeHtml(card.sentence),
    SentencePlain: escapeHtml(card.sentence),
    SentenceTranslation: escapeHtml(card.entry.contextTranslation),
    Source: card.pageUrl
      ? `<a href="${escapeHtml(card.pageUrl)}">${escapeHtml(card.pageTitle || card.pageUrl)}</a>`
      : '',
  }
}

export async function addNote(card: CapturedCard, s: Settings): Promise<number> {
  await ensureDeckAndModel(s)

  try {
    const noteId = await invoke<number>(s.anki.url, 'addNote', {
      note: {
        deckName: s.anki.deckName,
        modelName: s.anki.noteTypeName,
        fields: buildNoteFields(card, s),
        tags: ['word-catcher'],
        options: {
          // 靠首个字段（Word）查重，同一个词第二次划到时 Anki 会拒绝，避免刷屏
          allowDuplicate: false,
          duplicateScope: 'deck',
        },
      },
    })

    // 一笔记四模板：按模式挪到子牌组，复习时自己选子牌组即可
    try {
      await routeCardsToModeDecks(noteId, s)
    } catch {
      // 分流失败不影响已写入；卡留在主牌组仍可按模板复习
    }

    return noteId
  } catch (err) {
    if (err instanceof AnkiError && /duplicate/i.test(err.message)) {
      throw new AnkiError(`「${card.entry.word}」已经在牌组里了，不用重复添加。`, 'api')
    }
    throw err
  }
}
