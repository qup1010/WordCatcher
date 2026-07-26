/**
 * 插件内试听，用浏览器自带的 Web Speech API：免费、离线、不依赖任何第三方接口。
 *
 * 进了 Anki 之后的朗读是另一套机制——由卡片模板里的 {{tts}} 标签负责，
 * 见 lib/anki.ts。两边都不需要下载或存储音频文件。
 */

export function isTtsSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

export function speak(text: string, opts: { lang: string, rate: number }): void {
  if (!isTtsSupported() || !text.trim()) return

  // 连点时不要排队叠加，直接打断上一条
  window.speechSynthesis.cancel()

  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = opts.lang
  utterance.rate = opts.rate

  const voice = pickVoice(opts.lang)
  if (voice) utterance.voice = voice

  window.speechSynthesis.speak(utterance)
}

function pickVoice(lang: string): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices()
  if (voices.length === 0) return null

  const normalized = lang.toLowerCase().replace('_', '-')
  return (
    voices.find(v => v.lang.toLowerCase().replace('_', '-') === normalized)
    ?? voices.find(v => v.lang.toLowerCase().startsWith(normalized.split('-')[0]))
    ?? null
  )
}

export function stopSpeaking(): void {
  if (isTtsSupported()) window.speechSynthesis.cancel()
}
