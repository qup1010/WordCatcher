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
    })
  } catch {
    throw new AnkiError(
      '连不上 Anki。请确认 Anki 桌面版正在运行，且已安装 AnkiConnect 插件。',
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

/** 把原句里的目标词换成空格，正面才有"在语境中回忆"的效果 */
export function buildClozeSentence(sentence: string, selection: string): string {
  const needle = selection.trim()
  if (!needle) return sentence

  const at = sentence.toLowerCase().indexOf(needle.toLowerCase())
  if (at === -1) return sentence // 抓取的原句和划选文本对不上就不挖，宁可不挖也别挖错

  return (
    sentence.slice(0, at)
    + '<span class="wc-blank">[&nbsp;?&nbsp;]</span>'
    + sentence.slice(at + needle.length)
  )
}

function cardTemplates(ttsLang: string) {
  return [
    {
      Name: 'Recall',
      Front: `
<div class="wc-sentence">{{Sentence}}</div>
{{#PartOfSpeech}}<div class="wc-pos">{{PartOfSpeech}}</div>{{/PartOfSpeech}}
`.trim(),
      // {{tts}} 只放背面：放正面会在你回忆出来之前就把答案念出来
      Back: `
{{FrontSide}}
<hr id=answer>
<div class="wc-word">{{Word}}{{#Reading}} <span class="wc-reading">/{{Reading}}/</span>{{/Reading}}</div>
<div class="wc-tts">{{tts ${ttsLang}:Word}}</div>
<div class="wc-def">{{Definition}}</div>
{{#SentencePlain}}<div class="wc-full">{{SentencePlain}}</div>{{/SentencePlain}}
{{#SentenceTranslation}}<div class="wc-trans">{{SentenceTranslation}}</div>{{/SentenceTranslation}}
{{#Source}}<div class="wc-source">{{Source}}</div>{{/Source}}
`.trim(),
    },
  ]
}

const MODEL_CSS = `
.card {
  font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
  font-size: 20px;
  text-align: left;
  color: #221f1a;
  background: #fdfcf9;
  padding: 22px 24px;
  line-height: 1.75;
}
.wc-sentence { font-size: 22px; }
.wc-blank {
  color: #b45309;
  font-weight: 700;
  border-bottom: 2px solid #b45309;
  padding: 0 2px;
}
.wc-pos {
  margin-top: 10px;
  font-family: Georgia, "Times New Roman", serif;
  font-size: 15px;
  color: #0e6f63;
  font-style: italic;
}
.wc-word {
  margin-top: 6px;
  font-family: Georgia, "Times New Roman", serif;
  font-size: 32px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: #221f1a;
}
.wc-reading {
  font-family: Georgia, "Times New Roman", serif;
  font-size: 19px;
  font-weight: 400;
  color: #a39c8f;
}
.wc-def { margin-top: 10px; font-size: 19px; }
.wc-full {
  margin-top: 16px;
  padding-left: 13px;
  border-left: 2px solid #e8e3d9;
  color: #6d675d;
  font-size: 17px;
}
.wc-trans { padding-left: 13px; color: #a39c8f; font-size: 15px; }
.wc-source { margin-top: 16px; font-size: 13px; color: #a39c8f; }
.wc-source a { color: #a39c8f; }
hr#answer { border: none; border-top: 1px solid #e8e3d9; margin: 18px 0 4px; }
.nightMode .card, .night_mode .card { color: #ece7dd; background: #23211d; }
.nightMode .wc-word, .night_mode .wc-word { color: #ece7dd; }
.nightMode .wc-pos, .night_mode .wc-pos { color: #4fd1bb; }
.nightMode .wc-blank, .night_mode .wc-blank { color: #e8a94e; border-bottom-color: #e8a94e; }
.nightMode .wc-full, .night_mode .wc-full { color: #a89f90; border-left-color: #3a362e; }
.nightMode hr#answer, .night_mode hr#answer { border-top-color: #3a362e; }
`.trim()

/** 确保牌组和 Note Type 都存在，不存在就建。可重复调用。 */
export async function ensureDeckAndModel(s: Settings): Promise<void> {
  const { url, deckName, noteTypeName, ttsLang } = s.anki

  const decks = await invoke<string[]>(url, 'deckNames')
  if (!decks.includes(deckName)) {
    await invoke(url, 'createDeck', { deck: deckName })
  }

  const models = await invoke<string[]>(url, 'modelNames')
  if (!models.includes(noteTypeName)) {
    await invoke(url, 'createModel', {
      modelName: noteTypeName,
      inOrderFields: [...ANKI_FIELDS],
      css: MODEL_CSS,
      isCloze: false,
      cardTemplates: cardTemplates(ttsLang),
    })
  }
}

/** 改了 ttsLang 或想升级样式时调用，把模板刷成最新的 */
export async function updateModelTemplates(s: Settings): Promise<void> {
  const { url, noteTypeName, ttsLang } = s.anki
  const [tpl] = cardTemplates(ttsLang)
  await invoke(url, 'updateModelTemplates', {
    model: { name: noteTypeName, templates: { [tpl.Name]: { Front: tpl.Front, Back: tpl.Back } } },
  })
  await invoke(url, 'updateModelStyling', {
    model: { name: noteTypeName, css: MODEL_CSS },
  })
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function buildNoteFields(card: CapturedCard, s: Settings): Record<string, string> {
  const sentence = escapeHtml(card.sentence)
  // 必须拿转义后的划选文本去匹配转义后的句子，否则含 & < > 的词组
  // （例如 "Tom & Jerry"）会因为两边编码不一致而静默挖不上空
  const selection = escapeHtml(card.selection)

  return {
    Word: escapeHtml(card.entry.word),
    Reading: escapeHtml(card.entry.reading),
    PartOfSpeech: escapeHtml(card.entry.partOfSpeech),
    Definition: escapeHtml(card.entry.definition),
    Sentence: s.anki.clozeContext ? buildClozeSentence(sentence, selection) : sentence,
    SentencePlain: sentence,
    SentenceTranslation: escapeHtml(card.entry.contextTranslation),
    Source: card.pageUrl
      ? `<a href="${escapeHtml(card.pageUrl)}">${escapeHtml(card.pageTitle || card.pageUrl)}</a>`
      : '',
  }
}

export async function addNote(card: CapturedCard, s: Settings): Promise<number> {
  await ensureDeckAndModel(s)

  try {
    return await invoke<number>(s.anki.url, 'addNote', {
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
  } catch (err) {
    if (err instanceof AnkiError && /duplicate/i.test(err.message)) {
      throw new AnkiError(`「${card.entry.word}」已经在牌组里了，不用重复添加。`, 'api')
    }
    throw err
  }
}
