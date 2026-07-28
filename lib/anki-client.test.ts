import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AnkiError,
  addNote,
  checkConnection,
  ensureDeckAndModel,
  escapeQuery,
  findExisting,
  updateModelTemplates,
} from './anki'
import { DEFAULT_SETTINGS, type CapturedCard, type Settings } from './types'

interface Call { action: string, params: Record<string, any> }

/** 用假的 AnkiConnect 顶替 fetch，并记录收到的每个 action */
function mockAnki(reply: (action: string, params: any) => unknown) {
  const calls: Call[] = []

  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string)
    calls.push({ action: body.action, params: body.params })

    const result = reply(body.action, body.params)
    if (result instanceof Error) {
      return new Response(JSON.stringify({ result: null, error: result.message }), { status: 200 })
    }
    return new Response(JSON.stringify({ result, error: null }), { status: 200 })
  }))

  return calls
}

const settings: Settings = DEFAULT_SETTINGS

const sampleCard: CapturedCard = {
  entry: {
    word: 'devastate',
    reading: 'ˈdevəsteɪt',
    partOfSpeech: 'v.',
    definition: '使极度震惊',
    contextTranslation: '这个消息让他极度震惊。',
  },
  selection: 'devastated',
  sentence: 'He was devastated by the news.',
  sentenceOffset: 'He was '.length,
  pageUrl: 'https://example.com',
  pageTitle: 'Example',
  createdAt: 0,
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('checkConnection', () => {
  it('返回 AnkiConnect 版本号', async () => {
    mockAnki(() => 6)
    await expect(checkConnection(settings.anki.url)).resolves.toBe(6)
  })

  it('Anki 没开时报可读的错，并标记为 unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))

    const err = await checkConnection(settings.anki.url).catch(e => e)
    expect(err).toBeInstanceOf(AnkiError)
    expect(err.kind).toBe('unreachable')
    expect(err.message).toContain('Anki')
  })

  it('Anki 卡住不响应时报超时，而不是说「没在运行」', async () => {
    // 最典型的场景：Anki 开着，但弹了个同步冲突对话框把主线程堵死，
    // 这时候提示「请确认 Anki 正在运行」会让人一头雾水
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new DOMException('signal timed out', 'TimeoutError')
    }))

    const err = await checkConnection(settings.anki.url).catch(e => e)
    expect(err).toBeInstanceOf(AnkiError)
    expect(err.kind).toBe('unreachable')
    expect(err.message).toContain('没有响应')
    expect(err.message).not.toContain('正在运行')
  })

  it('每个请求都带上超时 signal', async () => {
    // 漏传 signal 的话对端吊着不返回时 Promise 永远不 settle，UI 会一直卡在「保存中」
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify({ result: 6, error: null }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await checkConnection(settings.anki.url)
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
  })

  it('HTTP 非 200 时抛 api 错误', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })))

    const err = await checkConnection(settings.anki.url).catch(e => e)
    expect(err).toBeInstanceOf(AnkiError)
    expect(err.kind).toBe('api')
    expect(err.message).toContain('500')
  })

  it('响应体里带 error 字段时抛出该错误', async () => {
    mockAnki(() => new Error('collection is not available'))

    const err = await checkConnection(settings.anki.url).catch(e => e)
    expect(err).toBeInstanceOf(AnkiError)
    expect(err.message).toBe('collection is not available')
  })
})

describe('ensureDeckAndModel', () => {
  it('牌组和笔记类型都不存在时创建它们', async () => {
    const calls = mockAnki((action) => {
      if (action === 'deckNames') return ['Default']
      if (action === 'modelNames') return ['Basic']
      return null
    })

    await ensureDeckAndModel(settings)

    const actions = calls.map(c => c.action)
    expect(actions).toContain('createDeck')
    expect(actions).toContain('createModel')

    const created = calls.find(c => c.action === 'createModel')!
    expect(created.params.inOrderFields).toContain('Word')
    expect(created.params.inOrderFields).toContain('SentencePlain')
    expect(created.params.isCloze).toBe(false)
  })

  it('已经存在时不重复创建', async () => {
    const calls = mockAnki((action) => {
      if (action === 'deckNames') return [settings.anki.deckName]
      if (action === 'modelNames') return [settings.anki.noteTypeName]
      return null
    })

    await ensureDeckAndModel(settings)

    const actions = calls.map(c => c.action)
    expect(actions).not.toContain('createDeck')
    expect(actions).not.toContain('createModel')
  })

  it('卡片模板把 tts 标签放在背面，避免正面就念出答案', async () => {
    const calls = mockAnki((action) => {
      if (action === 'deckNames' || action === 'modelNames') return []
      return null
    })

    await ensureDeckAndModel(settings)
    const tpl = calls.find(c => c.action === 'createModel')!.params.cardTemplates[0]

    expect(tpl.Back).toContain('{{tts en_US:Word}}')
    expect(tpl.Front).not.toContain('tts')
  })
})

describe('updateModelTemplates', () => {
  it('按当前语言设置刷新模板和样式', async () => {
    const calls = mockAnki(() => null)
    await updateModelTemplates({
      ...settings,
      anki: { ...settings.anki, ttsLang: 'ja_JP' },
    })

    const actions = calls.map(c => c.action)
    expect(actions).toEqual(['updateModelTemplates', 'updateModelStyling'])

    const tpl = calls[0].params.model.templates.Recall
    expect(tpl.Back).toContain('{{tts ja_JP:Word}}')
  })
})

describe('addNote', () => {
  it('把词条写入指定牌组并打上标签', async () => {
    const calls = mockAnki((action) => {
      if (action === 'deckNames') return [settings.anki.deckName]
      if (action === 'modelNames') return [settings.anki.noteTypeName]
      if (action === 'addNote') return 1748392847362
      return null
    })

    await expect(addNote(sampleCard, settings)).resolves.toBe(1748392847362)

    const note = calls.find(c => c.action === 'addNote')!.params.note
    expect(note.deckName).toBe(settings.anki.deckName)
    expect(note.tags).toContain('word-catcher')
    expect(note.fields.Word).toBe('devastate')
    expect(note.options.allowDuplicate).toBe(false)
  })

  it('重复词给出友好提示而不是抛 Anki 的原始英文报错', async () => {
    mockAnki((action) => {
      if (action === 'deckNames') return [settings.anki.deckName]
      if (action === 'modelNames') return [settings.anki.noteTypeName]
      if (action === 'addNote') return new Error('cannot create note because it is a duplicate')
      return null
    })

    const err = await addNote(sampleCard, settings).catch(e => e)
    expect(err).toBeInstanceOf(AnkiError)
    expect(err.message).toContain('devastate')
    expect(err.message).toContain('已经在牌组里')
  })

  it('其他错误原样上抛，不被重复词分支吞掉', async () => {
    mockAnki((action) => {
      if (action === 'deckNames') return [settings.anki.deckName]
      if (action === 'modelNames') return [settings.anki.noteTypeName]
      if (action === 'addNote') return new Error('model was not found')
      return null
    })

    const err = await addNote(sampleCard, settings).catch(e => e)
    expect(err.message).toBe('model was not found')
  })
})

describe('findExisting', () => {
  it('按牌组 + 笔记类型 + 首字段查重，口径和 addNote 的去重一致', async () => {
    const calls = mockAnki(() => [1748392847362])

    await expect(findExisting('devastate', settings)).resolves.toEqual([1748392847362])

    const { query } = calls[0].params
    expect(calls[0].action).toBe('findNotes')
    expect(query).toContain(`"deck:${settings.anki.deckName}"`)
    expect(query).toContain(`"note:${settings.anki.noteTypeName}"`)
    expect(query).toContain('"Word:devastate"')
  })

  /**
   * Anki 搜索里 * 和 _ 是通配符。不转义的话划到「*」这种词会把整个牌组
   * 匹配出来，界面上显示成"已收藏"，用户就永远存不进去了。
   */
  it('转义通配符和引号，避免误报成已收藏', () => {
    expect(escapeQuery('a*b')).toBe(String.raw`a\*b`)
    expect(escapeQuery('a_b')).toBe(String.raw`a\_b`)
    expect(escapeQuery('say "hi"')).toBe(String.raw`say \"hi\"`)
    expect(escapeQuery(String.raw`C:\path`)).toBe(String.raw`C\:\\path`)
  })

  it('空词不发请求', async () => {
    const calls = mockAnki(() => [])
    await expect(findExisting('   ', settings)).resolves.toEqual([])
    expect(calls).toHaveLength(0)
  })
})
