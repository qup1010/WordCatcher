import { beforeEach, describe, expect, it } from 'vitest'
import { cacheKey, cacheSize, clearCache, getCached, setCached } from './entry-cache'
import { DEFAULT_SETTINGS, type Settings, type WordEntry } from './types'

function settings(over: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, ...over }
}

function entry(word: string): WordEntry {
  return {
    word,
    reading: '',
    partOfSpeech: 'v.',
    definition: `${word} 的释义`,
    contextTranslation: '',
  }
}

const base = { selection: 'devastated', sentence: 'He was devastated by the news.' }

beforeEach(clearCache)

describe('cacheKey', () => {
  it('同样的输入得到同样的键', () => {
    expect(cacheKey({ ...base, settings: settings() }))
      .toBe(cacheKey({ ...base, settings: settings() }))
  })

  /**
   * 这条是整个缓存的正确性底线：同一个词在不同句子里的释义本来就该不同，
   * 这正是本插件区别于普通词典的地方。原句漏出缓存键 = 核心功能被缓存坏掉。
   */
  it('换一句话就是另一个键', () => {
    const other = { ...base, sentence: 'The earthquake devastated the city.' }
    expect(cacheKey({ ...base, settings: settings() }))
      .not.toBe(cacheKey({ ...other, settings: settings() }))
  })

  it('换模型、换端点、换释义语言都要各自成键', () => {
    const key = cacheKey({ ...base, settings: settings() })
    const profile = DEFAULT_SETTINGS.ai.profiles[0]

    const withModel = settings({
      ai: { ...DEFAULT_SETTINGS.ai, profiles: [{ ...profile, model: 'gpt-4o' }] },
    })
    const withBase = settings({
      ai: { ...DEFAULT_SETTINGS.ai, profiles: [{ ...profile, baseURL: 'https://other/v1' }] },
    })
    const withLang = settings({ explainLanguage: 'English' })

    expect(cacheKey({ ...base, settings: withModel })).not.toBe(key)
    expect(cacheKey({ ...base, settings: withBase })).not.toBe(key)
    expect(cacheKey({ ...base, settings: withLang })).not.toBe(key)
  })

  it('拼接不会让相邻字段串味', () => {
    // 「a」+「bc」和「ab」+「c」必须是两个键
    const left = cacheKey({ selection: 'a', sentence: 'bc', settings: settings() })
    const right = cacheKey({ selection: 'ab', sentence: 'c', settings: settings() })
    expect(left).not.toBe(right)
  })
})

describe('LRU', () => {
  it('存进去能取出来', () => {
    setCached('k', entry('devastate'))
    expect(getCached('k')?.word).toBe('devastate')
  })

  it('没存过返回 undefined', () => {
    expect(getCached('missing')).toBeUndefined()
  })

  it('超出容量后淘汰最久没用的', () => {
    for (let i = 0; i < 60; i++) setCached(`k${i}`, entry(`w${i}`))

    expect(cacheSize()).toBe(50)
    expect(getCached('k0')).toBeUndefined()
    expect(getCached('k59')?.word).toBe('w59')
  })

  it('命中会把条目刷新到队尾，不再被优先淘汰', () => {
    for (let i = 0; i < 50; i++) setCached(`k${i}`, entry(`w${i}`))

    getCached('k0') // 用一下最老的那条
    setCached('new', entry('new')) // 触发一次淘汰

    expect(getCached('k0')?.word).toBe('w0') // 刚用过，保住了
    expect(getCached('k1')).toBeUndefined() // 变成了最老的，被淘汰
  })
})
