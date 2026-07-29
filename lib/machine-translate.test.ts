import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetMicrosoftToken,
  MtError,
  googleTranslate,
  microsoftTranslate,
  parseGooglePayload,
  quickTranslate,
} from './machine-translate'

/** 造一个带 exp 的假 JWT（微软 auth 返回的就是裸 JWT 文本） */
function fakeJwt(expiresInSeconds: number): string {
  const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expiresInSeconds }))
  return `header.${payload}.signature`
}

interface RouteLog { url: string, body?: unknown }

/** 按 URL 前缀分发的假 fetch，记录每次请求 */
function mockRoutes(routes: Record<string, (body?: unknown) => Response | Error>) {
  const log: RouteLog[] = []

  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(init.body as string) : undefined
    log.push({ url, body })

    for (const [prefix, handler] of Object.entries(routes)) {
      if (url.startsWith(prefix)) {
        const out = handler(body)
        if (out instanceof Error) throw out
        return out
      }
    }
    throw new Error(`未匹配的请求：${url}`)
  }))

  return log
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status })

const GOOGLE = 'https://translate.googleapis.com/'
const MS_AUTH = 'https://edge.microsoft.com/translate/auth'
const MS_API = 'https://api-edge.cognitive.microsofttranslator.com/'

beforeEach(() => {
  __resetMicrosoftToken()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('parseGooglePayload', () => {
  it('抽出译文，并按词性整理词典义项', () => {
    const raw = [
      [['主张', 'assertion', null]],
      [
        ['名词', ['主张', '断言', '声明']],
        ['动词', ['断言', '主张']],
      ],
      'en',
    ]
    expect(parseGooglePayload(raw)).toEqual({
      translation: '主张',
      dictionary: [
        { pos: '名词', meanings: ['主张', '断言', '声明'] },
        { pos: '动词', meanings: ['断言', '主张'] },
      ],
    })
  })

  it('没有词典段时只返回译文', () => {
    expect(parseGooglePayload([[['hello', '你好', null]], null, 'en'])).toEqual({
      translation: 'hello',
    })
  })

  it('义项去重并截断过长列表', () => {
    const many = Array.from({ length: 12 }, (_, i) => `义${i}`)
    const out = parseGooglePayload([
      [['x', 'y', null]],
      [['名词', ['义0', '义0', ...many]]],
    ])
    expect(out.dictionary![0].meanings).toHaveLength(8)
    expect(out.dictionary![0].meanings[0]).toBe('义0')
  })
})

describe('googleTranslate', () => {
  it('拼出 gtx 请求（含词典 dt）并返回译文', async () => {
    const log = mockRoutes({
      [GOOGLE]: () => json([[['极度震惊的', 'devastated', null]], null, 'en']),
    })

    await expect(googleTranslate('devastated', 'zh-CN')).resolves.toEqual({
      translation: '极度震惊的',
    })

    const url = new URL(log[0].url)
    expect(url.searchParams.get('client')).toBe('gtx')
    expect(url.searchParams.get('sl')).toBe('auto')
    expect(url.searchParams.get('tl')).toBe('zh-CN')
    expect(url.searchParams.get('q')).toBe('devastated')
    // 多个 dt 用 getAll；至少要有译文 + 词典
    expect(url.searchParams.getAll('dt')).toEqual(expect.arrayContaining(['t', 'bd']))
  })

  it('多段译文按顺序拼接', async () => {
    mockRoutes({
      [GOOGLE]: () => json([[['第一段。', 'a', null], ['第二段。', 'b', null]], null, 'en']),
    })
    await expect(googleTranslate('a b', 'zh-CN')).resolves.toEqual({
      translation: '第一段。第二段。',
    })
  })

  it('带词典响应时一并返回', async () => {
    mockRoutes({
      [GOOGLE]: () => json([
        [['主张', 'assertion', null]],
        [['名词', ['主张', '断言']]],
        'en',
      ]),
    })
    await expect(googleTranslate('assertion', 'zh-CN')).resolves.toEqual({
      translation: '主张',
      dictionary: [{ pos: '名词', meanings: ['主张', '断言'] }],
    })
  })

  it('HTTP 错误和坏响应都抛 MtError', async () => {
    mockRoutes({ [GOOGLE]: () => json({}, 429) })
    await expect(googleTranslate('x', 'zh-CN')).rejects.toBeInstanceOf(MtError)

    __resetMicrosoftToken()
    vi.unstubAllGlobals()
    mockRoutes({ [GOOGLE]: () => json({ not: 'expected' }) })
    await expect(googleTranslate('x', 'zh-CN')).rejects.toBeInstanceOf(MtError)
  })
})

describe('microsoftTranslate', () => {
  it('先鉴权再翻译，token 带在 Authorization 里', async () => {
    const token = fakeJwt(600)
    const log = mockRoutes({
      [MS_AUTH]: () => new Response(token),
      [MS_API]: () => json([{ translations: [{ text: '极度震惊的' }] }]),
    })

    await expect(microsoftTranslate('devastated', 'zh-Hans')).resolves.toBe('极度震惊的')

    expect(log[0].url).toBe(MS_AUTH)
    expect(log[1].url).toContain('to=zh-Hans')
    expect(log[1].body).toEqual([{ Text: 'devastated' }])
  })

  it('token 在有效期内被缓存，第二次翻译不再鉴权', async () => {
    const log = mockRoutes({
      [MS_AUTH]: () => new Response(fakeJwt(600)),
      [MS_API]: () => json([{ translations: [{ text: 'x' }] }]),
    })

    await microsoftTranslate('one', 'zh-Hans')
    await microsoftTranslate('two', 'zh-Hans')

    const authCalls = log.filter(r => r.url === MS_AUTH)
    expect(authCalls).toHaveLength(1)
  })

  it('token 快过期时（提前量 60 秒内）重新鉴权', async () => {
    const log = mockRoutes({
      [MS_AUTH]: () => new Response(fakeJwt(30)), // 只剩 30 秒，低于 60 秒提前量
      [MS_API]: () => json([{ translations: [{ text: 'x' }] }]),
    })

    await microsoftTranslate('one', 'zh-Hans')
    await microsoftTranslate('two', 'zh-Hans')

    expect(log.filter(r => r.url === MS_AUTH)).toHaveLength(2)
  })

  it('并发请求只发一次鉴权', async () => {
    const log = mockRoutes({
      [MS_AUTH]: () => new Response(fakeJwt(600)),
      [MS_API]: () => json([{ translations: [{ text: 'x' }] }]),
    })

    await Promise.all([
      microsoftTranslate('a', 'zh-Hans'),
      microsoftTranslate('b', 'zh-Hans'),
      microsoftTranslate('c', 'zh-Hans'),
    ])

    expect(log.filter(r => r.url === MS_AUTH)).toHaveLength(1)
  })

  it('401 时清掉缓存的 token，下次会重新鉴权', async () => {
    let apiCalls = 0
    const log = mockRoutes({
      [MS_AUTH]: () => new Response(fakeJwt(600)),
      [MS_API]: () => {
        apiCalls++
        return apiCalls === 1
          ? json({}, 401)
          : json([{ translations: [{ text: 'ok' }] }])
      },
    })

    await expect(microsoftTranslate('x', 'zh-Hans')).rejects.toBeInstanceOf(MtError)
    await expect(microsoftTranslate('x', 'zh-Hans')).resolves.toBe('ok')

    // 第一次 + 401 后重新来的一次
    expect(log.filter(r => r.url === MS_AUTH)).toHaveLength(2)
  })
})

describe('quickTranslate', () => {
  it('按设置使用首选服务', async () => {
    const log = mockRoutes({
      [MS_AUTH]: () => new Response(fakeJwt(600)),
      [MS_API]: () => json([{ translations: [{ text: '微软的结果' }] }]),
      [GOOGLE]: () => json([[['谷歌的结果', 'x', null]], null, 'en']),
    })

    const out = await quickTranslate('word', { provider: 'microsoft', explainLanguage: '简体中文' })
    expect(out).toEqual({ translation: '微软的结果', provider: 'microsoft', fellBack: false })
    expect(log.some(r => r.url.startsWith(GOOGLE))).toBe(false)
  })

  it('首选谷歌时带回词典字段', async () => {
    mockRoutes({
      [GOOGLE]: () => json([
        [['主张', 'assertion', null]],
        [['名词', ['主张', '断言']]],
        'en',
      ]),
    })

    const out = await quickTranslate('assertion', { provider: 'google', explainLanguage: '简体中文' })
    expect(out).toEqual({
      translation: '主张',
      provider: 'google',
      fellBack: false,
      dictionary: [{ pos: '名词', meanings: ['主张', '断言'] }],
    })
  })

  it('首选失败时自动回退到另一家，并标记 fellBack', async () => {
    mockRoutes({
      [MS_AUTH]: () => new TypeError('Failed to fetch'),
      [GOOGLE]: () => json([[['谷歌兜底', 'x', null]], null, 'en']),
    })

    const out = await quickTranslate('word', { provider: 'microsoft', explainLanguage: '简体中文' })
    expect(out).toEqual({ translation: '谷歌兜底', provider: 'google', fellBack: true })
  })

  it('两家都失败时报一条带原因的可读错误', async () => {
    mockRoutes({
      [MS_AUTH]: () => new TypeError('Failed to fetch'),
      [GOOGLE]: () => json({}, 429),
    })

    const err = await quickTranslate('word', { provider: 'google', explainLanguage: '简体中文' })
      .catch(e => e)
    expect(err).toBeInstanceOf(MtError)
    expect(err.message).toContain('两家')
  })

  it('释义语言映射到各家的语言代码；未知语言退回简体中文', async () => {
    const log = mockRoutes({
      [MS_AUTH]: () => new Response(fakeJwt(600)),
      [MS_API]: () => json([{ translations: [{ text: 'x' }] }]),
    })

    await quickTranslate('word', { provider: 'microsoft', explainLanguage: '日本語' })
    expect(log.find(r => r.url.startsWith(MS_API))!.url).toContain('to=ja')

    await quickTranslate('word', { provider: 'microsoft', explainLanguage: '火星文' })
    expect(log.filter(r => r.url.startsWith(MS_API))[1].url).toContain('to=zh-Hans')
  })
})
