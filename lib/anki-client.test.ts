import { afterEach, describe, expect, it, vi } from 'vitest'
import { AnkiError, addNote, checkConnection, ensureDeckAndModel, updateModelTemplates } from './anki'
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
