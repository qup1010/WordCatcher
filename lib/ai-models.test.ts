import { afterEach, describe, expect, it, vi } from 'vitest'
import { AiError, listModels } from './ai'
import { type AiProfile, DEFAULT_SETTINGS, type Settings } from './types'

function settings(profile: Partial<AiProfile> = {}): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ai: {
      profiles: [{
        id: 'test',
        name: '测试',
        baseURL: 'https://api.example.com/v1',
        apiKey: 'sk-test',
        model: 'gpt-4o-mini',
        ...profile,
      }],
      activeId: 'test',
    },
  }
}

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Error) {
  const calls: Array<{ url: string, init?: RequestInit }> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    const out = handler(url, init)
    if (out instanceof Error) throw out
    return out
  }))
  return calls
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('listModels', () => {
  it('请求 /models 并返回去重排序后的模型 id', async () => {
    const calls = mockFetch(() =>
      new Response(JSON.stringify({
        data: [
          { id: 'deepseek-v4-flash' },
          { id: 'gpt-4o-mini' },
          { id: 'deepseek-v4-flash' }, // 重复项
          { id: 'aaa-first' },
        ],
      })),
    )

    const models = await listModels(settings())
    expect(models).toEqual(['aaa-first', 'deepseek-v4-flash', 'gpt-4o-mini'])
    expect(calls[0].url).toBe('https://api.example.com/v1/models')
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe('Bearer sk-test')
  })

  it('baseURL 末尾多余的斜杠不会拼出坏地址', async () => {
    const calls = mockFetch(() => new Response(JSON.stringify({ data: [{ id: 'm' }] })))
    await listModels(settings({ baseURL: 'https://api.example.com/v1///' }))
    expect(calls[0].url).toBe('https://api.example.com/v1/models')
  })

  it('没填 key 时不带 Authorization 头（本地 Ollama 场景）', async () => {
    const calls = mockFetch(() => new Response(JSON.stringify({ data: [{ id: 'qwen2.5' }] })))
    await listModels(settings({ apiKey: '  ' }))
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBeUndefined()
  })

  it('401 时给出指向 API key 的友好报错', async () => {
    mockFetch(() => new Response('{}', { status: 401 }))
    const err = await listModels(settings()).catch(e => e)
    expect(err).toBeInstanceOf(AiError)
    expect(err.message).toContain('API key')
  })

  it('网络不通时提示检查 Base URL', async () => {
    mockFetch(() => new TypeError('Failed to fetch'))
    const err = await listModels(settings()).catch(e => e)
    expect(err).toBeInstanceOf(AiError)
    expect(err.message).toContain('Base URL')
  })

  it('端点返回空列表时提示手动填写', async () => {
    mockFetch(() => new Response(JSON.stringify({ data: [] })))
    const err = await listModels(settings()).catch(e => e)
    expect(err.message).toContain('手动填写')
  })

  it('响应缺 data 字段时同样走空列表提示，不崩', async () => {
    mockFetch(() => new Response(JSON.stringify({ object: 'list' })))
    const err = await listModels(settings()).catch(e => e)
    expect(err).toBeInstanceOf(AiError)
  })
})
