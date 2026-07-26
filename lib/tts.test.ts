import { afterEach, describe, expect, it, vi } from 'vitest'
import { isTtsSupported, speak, stopSpeaking } from './tts'

function mockSpeech(voices: Array<{ name: string, lang: string }> = []) {
  const spoken: SpeechSynthesisUtterance[] = []
  const cancel = vi.fn()

  vi.stubGlobal('speechSynthesis', {
    getVoices: () => voices,
    speak: (u: SpeechSynthesisUtterance) => spoken.push(u),
    cancel,
  })

  // jsdom 没有实现 SpeechSynthesisUtterance
  vi.stubGlobal('SpeechSynthesisUtterance', class {
    lang = ''
    rate = 1
    voice: unknown = null
    constructor(public text: string) {}
  })

  return { spoken, cancel }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('speak', () => {
  it('按设置的语言和语速朗读', () => {
    const { spoken } = mockSpeech()
    speak('devastate', { lang: 'en-US', rate: 0.9 })

    expect(spoken).toHaveLength(1)
    expect(spoken[0].text).toBe('devastate')
    expect(spoken[0].lang).toBe('en-US')
    expect(spoken[0].rate).toBe(0.9)
  })

  it('连点时打断上一条，而不是排队叠加', () => {
    const { cancel } = mockSpeech()
    speak('one', { lang: 'en-US', rate: 1 })
    speak('two', { lang: 'en-US', rate: 1 })

    expect(cancel).toHaveBeenCalledTimes(2)
  })

  it('优先选完全匹配的语音', () => {
    const { spoken } = mockSpeech([
      { name: 'A', lang: 'en-GB' },
      { name: 'B', lang: 'en-US' },
    ])
    speak('hello', { lang: 'en-US', rate: 1 })

    expect((spoken[0].voice as { name: string }).name).toBe('B')
  })

  it('没有完全匹配时退回同语种的任意语音', () => {
    const { spoken } = mockSpeech([{ name: 'A', lang: 'en-GB' }])
    speak('hello', { lang: 'en-US', rate: 1 })

    expect((spoken[0].voice as { name: string }).name).toBe('A')
  })

  it('系统一个语音都没有时也不报错', () => {
    const { spoken } = mockSpeech([])
    expect(() => speak('hello', { lang: 'en-US', rate: 1 })).not.toThrow()
    expect(spoken[0].voice).toBeNull()
  })

  it('空文本不触发朗读', () => {
    const { spoken } = mockSpeech()
    speak('   ', { lang: 'en-US', rate: 1 })
    expect(spoken).toHaveLength(0)
  })
})

describe('isTtsSupported / stopSpeaking', () => {
  it('浏览器不支持时安静降级，不抛异常', () => {
    vi.stubGlobal('speechSynthesis', undefined)
    // jsdom 里 window 上仍有该属性名，需要真正删掉才算不支持
    const original = Object.getOwnPropertyDescriptor(window, 'speechSynthesis')
    delete (window as unknown as Record<string, unknown>).speechSynthesis

    expect(isTtsSupported()).toBe(false)
    expect(() => speak('x', { lang: 'en-US', rate: 1 })).not.toThrow()
    expect(() => stopSpeaking()).not.toThrow()

    if (original) Object.defineProperty(window, 'speechSynthesis', original)
  })

  it('支持时 stopSpeaking 调用 cancel', () => {
    const { cancel } = mockSpeech()
    expect(isTtsSupported()).toBe(true)
    stopSpeaking()
    expect(cancel).toHaveBeenCalledOnce()
  })
})
