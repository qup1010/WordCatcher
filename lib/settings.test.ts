import { beforeEach, describe, expect, it } from 'vitest'
// 直接引 stub 文件而不是 '#imports'：vitest 的 alias 会把两者解析到同一模块实例，
// 而 '#imports' 在 tsc 眼里是 WXT 生成的类型，并不包含这个测试专用的重置函数
import { __resetStorage } from '../test/wxt-imports-stub'
import { activeAiProfile, getSettings, isAiConfigured, normalizeSettings, saveSettings } from './settings'
import { DEFAULT_SETTINGS } from './types'

beforeEach(() => {
  __resetStorage()
})

describe('normalizeSettings', () => {
  it('空值退回全套默认配置', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings('garbage')).toEqual(DEFAULT_SETTINGS)
  })

  it('旧版单配置自动迁移成第一套 profile，值不丢', () => {
    const out = normalizeSettings({
      ai: { apiKey: 'sk-legacy', model: 'deepseek-chat', baseURL: 'https://api.deepseek.com/v1' },
    })

    expect(out.ai.profiles).toHaveLength(1)
    const p = activeAiProfile(out)
    expect(p.apiKey).toBe('sk-legacy')
    expect(p.model).toBe('deepseek-chat')
    expect(p.baseURL).toBe('https://api.deepseek.com/v1')
  })

  it('旧配置缺字段时补默认值而不是整个丢弃', () => {
    const out = normalizeSettings({ ai: { apiKey: 'sk-old' } })

    const p = activeAiProfile(out)
    expect(p.apiKey).toBe('sk-old')
    expect(p.baseURL).toBe('https://api.openai.com/v1')
    expect(out.anki.deckName).toBe(DEFAULT_SETTINGS.anki.deckName)
  })

  it('新版多配置结构原样保留', () => {
    const out = normalizeSettings({
      ai: {
        profiles: [
          { id: 'a', name: '主力', baseURL: 'https://a.com/v1', apiKey: 'sk-a', model: 'm-a' },
          { id: 'b', name: '备用', baseURL: 'https://b.com/v1', apiKey: 'sk-b', model: 'm-b' },
        ],
        activeId: 'b',
      },
    })

    expect(out.ai.profiles).toHaveLength(2)
    expect(activeAiProfile(out).name).toBe('备用')
    expect(activeAiProfile(out).apiKey).toBe('sk-b')
  })

  it('activeId 指向不存在的配置时退回第一套', () => {
    const out = normalizeSettings({
      ai: {
        profiles: [{ id: 'a', name: '唯一', baseURL: 'https://a.com/v1', apiKey: 'sk-a', model: 'm' }],
        activeId: 'deleted-id',
      },
    })
    expect(out.ai.activeId).toBe('a')
    expect(activeAiProfile(out).name).toBe('唯一')
  })

  it('profiles 为空数组时退回默认配置', () => {
    const out = normalizeSettings({ ai: { profiles: [], activeId: 'x' } })
    expect(out.ai).toEqual(DEFAULT_SETTINGS.ai)
  })

  it('整段缺失时该段落用默认值', () => {
    const out = normalizeSettings({ explainLanguage: 'English' })
    expect(out.explainLanguage).toBe('English')
    expect(out.anki).toEqual(DEFAULT_SETTINGS.anki)
    expect(out.ai).toEqual(DEFAULT_SETTINGS.ai)
  })

  it('字段类型不对时退回默认，不让坏数据传播下去', () => {
    expect(normalizeSettings({ triggerMode: 'nonsense' })).toEqual(DEFAULT_SETTINGS)
  })
})

describe('getSettings / saveSettings', () => {
  it('还没存过任何配置时返回默认值', async () => {
    await expect(getSettings()).resolves.toEqual(DEFAULT_SETTINGS)
  })

  it('多套配置存进去再读出来是同一份', async () => {
    const next = {
      ...DEFAULT_SETTINGS,
      ai: {
        profiles: [
          { id: 'p1', name: '日常', baseURL: 'https://x.com/v1', apiKey: 'sk-1', model: 'm1' },
          { id: 'p2', name: '本地', baseURL: 'http://127.0.0.1:11434/v1', apiKey: 'ollama', model: 'qwen2.5' },
        ],
        activeId: 'p2',
      },
      triggerMode: 'quick' as const,
    }
    await saveSettings(next)

    const loaded = await getSettings()
    expect(loaded.ai.profiles).toHaveLength(2)
    expect(activeAiProfile(loaded).name).toBe('本地')
    expect(loaded.triggerMode).toBe('quick')
  })

  it('存储里是旧版脏数据时也能读出可用配置', async () => {
    __resetStorage({ 'local:settings': { ai: { apiKey: 'sk-partial' } } })

    const loaded = await getSettings()
    expect(activeAiProfile(loaded).apiKey).toBe('sk-partial')
    expect(loaded.anki.url).toBe(DEFAULT_SETTINGS.anki.url)
  })
})

describe('isAiConfigured', () => {
  it('缺 key 或缺模型都算没配好', () => {
    expect(isAiConfigured(DEFAULT_SETTINGS)).toBe(false)
    expect(isAiConfigured(normalizeSettings({ ai: { apiKey: '   ' } }))).toBe(false)
    expect(isAiConfigured(normalizeSettings({ ai: { apiKey: 'sk-x', model: '' } }))).toBe(false)
  })

  it('看的是当前生效的那套配置', () => {
    const s = normalizeSettings({
      ai: {
        profiles: [
          { id: 'empty', name: '空的', baseURL: 'https://a.com/v1', apiKey: '', model: 'm' },
          { id: 'full', name: '好的', baseURL: 'https://b.com/v1', apiKey: 'sk-b', model: 'm' },
        ],
        activeId: 'empty',
      },
    })
    expect(isAiConfigured(s)).toBe(false)

    const switched = { ...s, ai: { ...s.ai, activeId: 'full' } }
    expect(isAiConfigured(switched)).toBe(true)
  })
})
