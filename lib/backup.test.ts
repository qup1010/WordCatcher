import { describe, expect, it } from 'vitest'
import { backupFileName, buildBackup, describeSettings, parseBackup } from './backup'
import { DEFAULT_SETTINGS, type Settings } from './types'

const AT = '2026-07-26T12:34:56.000Z'

function settings(over: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, ...over }
}

describe('导出', () => {
  it('文件名带日期', () => {
    expect(backupFileName(AT)).toBe('word-catcher-settings-2026-07-26.json')
  })

  it('带信封，导入时才能认出是自家文件', () => {
    const b = buildBackup(settings(), AT)
    expect(b.format).toBe('word-catcher-settings')
    expect(b.version).toBe(1)
  })
})

describe('parseBackup', () => {
  it('自家导出的文件能原样读回来', () => {
    const original = settings({
      explainLanguage: '日本語',
      anki: { ...DEFAULT_SETTINGS.anki, deckName: '我的牌组' },
    })
    const text = JSON.stringify(buildBackup(original, AT))

    const res = parseBackup(text)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.settings.explainLanguage).toBe('日本語')
    expect(res.settings.anki.deckName).toBe('我的牌组')
  })

  it('没有信封但字段认得出的裸配置也收', () => {
    const res = parseBackup(JSON.stringify({ explainLanguage: 'English' }))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.settings.explainLanguage).toBe('English')
    // 缺的字段补默认值，而不是整份丢弃
    expect(res.settings.anki.deckName).toBe(DEFAULT_SETTINGS.anki.deckName)
  })

  /**
   * 这几条是这个模块存在的理由：normalizeSettings 对垃圾输入的兜底是返回一整套
   * 默认值，要是直接把无法识别的内容喂给它再存盘，用户的配置就被静默清空了。
   */
  it('不是 JSON 时明确报错，而不是当成空配置', () => {
    const res = parseBackup('这不是 json')
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toContain('JSON')
  })

  it('别的软件的配置文件会被认出来并点名', () => {
    const res = parseBackup(JSON.stringify({ format: 'some-other-tool', settings: {} }))
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toContain('some-other-tool')
  })

  it('信封对但内容空，说明导出时中断了', () => {
    const res = parseBackup(JSON.stringify({ format: 'word-catcher-settings', settings: {} }))
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toContain('没有配置内容')
  })

  it('一个字段都不认得就拒绝', () => {
    const res = parseBackup(JSON.stringify({ foo: 1, bar: 2 }))
    expect(res.ok).toBe(false)
  })

  it('JSON 里的 null 不会被当成对象', () => {
    expect(parseBackup('null').ok).toBe(false)
  })

  it('数组也不是配置', () => {
    expect(parseBackup('[1,2,3]').ok).toBe(false)
  })
})

describe('describeSettings', () => {
  it('说清楚导进来的是什么，让用户能核对', () => {
    const profile = DEFAULT_SETTINGS.ai.profiles[0]
    const s = settings({
      ai: {
        activeId: 'a',
        profiles: [
          { ...profile, id: 'a', apiKey: 'sk-1' },
          { ...profile, id: 'b', apiKey: '' },
        ],
      },
    })
    const text = describeSettings(s)
    expect(text).toContain('2 套')
    expect(text).toContain('1 套带 key')
  })
})
