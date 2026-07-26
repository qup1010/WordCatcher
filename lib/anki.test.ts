import { describe, expect, it } from 'vitest'
import { buildClozeSentence, buildNoteFields } from './anki'
import { DEFAULT_SETTINGS, type CapturedCard, type Settings } from './types'

function card(over: Partial<CapturedCard> = {}): CapturedCard {
  return {
    entry: {
      word: 'devastate',
      reading: 'ˈdevəsteɪt',
      partOfSpeech: 'v.',
      definition: '使极度震惊、悲痛',
      contextTranslation: '这个消息让他极度震惊。',
    },
    selection: 'devastated',
    sentence: 'He was devastated by the news.',
    pageUrl: 'https://example.com/article',
    pageTitle: 'An Article',
    createdAt: 0,
    ...over,
  }
}

function settings(over: Partial<Settings['anki']> = {}): Settings {
  return { ...DEFAULT_SETTINGS, anki: { ...DEFAULT_SETTINGS.anki, ...over } }
}

describe('buildClozeSentence', () => {
  it('把目标词替换成空位', () => {
    const out = buildClozeSentence('He was devastated by the news.', 'devastated')
    expect(out).toBe('He was <span class="wc-blank">[&nbsp;?&nbsp;]</span> by the news.')
  })

  it('大小写不一致时仍能挖空', () => {
    const out = buildClozeSentence('Devastated, he left the room.', 'devastated')
    expect(out).toContain('wc-blank')
    expect(out).toContain(', he left the room.')
  })

  it('目标词不在句子里时原样返回，不瞎挖', () => {
    const sentence = 'A completely unrelated sentence.'
    expect(buildClozeSentence(sentence, 'devastated')).toBe(sentence)
  })

  it('划选为空时原样返回', () => {
    const sentence = 'Nothing selected here.'
    expect(buildClozeSentence(sentence, '   ')).toBe(sentence)
  })

  it('只替换第一次出现，不会把整句挖成筛子', () => {
    const out = buildClozeSentence('The bank is next to the bank.', 'bank')
    expect(out.match(/wc-blank/g)).toHaveLength(1)
  })
})

describe('buildNoteFields', () => {
  it('产出 Anki 笔记类型定义的全部字段', () => {
    const fields = buildNoteFields(card(), settings())
    expect(Object.keys(fields).sort()).toEqual([
      'Definition', 'PartOfSpeech', 'Reading', 'Sentence',
      'SentencePlain', 'SentenceTranslation', 'Source', 'Word',
    ])
  })

  it('SentencePlain 始终保留完整原句，即使正面挖了空', () => {
    const fields = buildNoteFields(card(), settings({ clozeContext: true }))
    expect(fields.SentencePlain).toBe('He was devastated by the news.')
    expect(fields.Sentence).toContain('wc-blank')
  })

  it('关掉挖空时正反面句子一致', () => {
    const fields = buildNoteFields(card(), settings({ clozeContext: false }))
    expect(fields.Sentence).toBe(fields.SentencePlain)
  })

  it('转义网页原文里的 HTML，避免脏内容进 Anki 卡片', () => {
    const fields = buildNoteFields(
      card({ sentence: 'Use <script>alert(1)</script> carefully.', selection: 'carefully' }),
      settings(),
    )
    expect(fields.SentencePlain).toBe('Use &lt;script&gt;alert(1)&lt;/script&gt; carefully.')
    expect(fields.SentencePlain).not.toContain('<script>')
  })

  it('划选文本含 & 等需转义字符时仍能挖空', () => {
    const fields = buildNoteFields(
      card({
        sentence: 'Tom & Jerry are on TV.',
        selection: 'Tom & Jerry',
      }),
      settings({ clozeContext: true }),
    )
    expect(fields.Sentence).toContain('wc-blank')
    expect(fields.Sentence).toContain('are on TV.')
  })

  it('来源渲染成链接并转义 URL', () => {
    const fields = buildNoteFields(
      card({ pageUrl: 'https://e.com/a?x=1&y=2', pageTitle: 'A & B' }),
      settings(),
    )
    expect(fields.Source).toBe('<a href="https://e.com/a?x=1&amp;y=2">A &amp; B</a>')
  })

  it('没有来源 URL 时 Source 为空而不是坏链接', () => {
    const fields = buildNoteFields(card({ pageUrl: '', pageTitle: '' }), settings())
    expect(fields.Source).toBe('')
  })
})
