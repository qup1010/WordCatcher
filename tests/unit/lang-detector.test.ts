import { describe, expect, it } from 'vitest'
import { detectLanguage } from '../../lib/lang-detector'

describe('detectLanguage', () => {
  it('identifies Japanese with hiragana/katakana', () => {
    expect(detectLanguage('こんにちは').bcp47).toBe('ja-JP')
    expect(detectLanguage('東京に行きます').bcp47).toBe('ja-JP')
    expect(detectLanguage('カタカナ').bcp47).toBe('ja-JP')
  })

  it('identifies Korean with Hangul', () => {
    expect(detectLanguage('안녕하세요').bcp47).toBe('ko-KR')
    expect(detectLanguage('감사합니다').ankiLang).toBe('ko_KR')
  })

  it('identifies Russian with Cyrillic', () => {
    expect(detectLanguage('Привет мир').bcp47).toBe('ru-RU')
    expect(detectLanguage('Здравствуйте').ankiLang).toBe('ru_RU')
  })

  it('identifies Greek', () => {
    expect(detectLanguage('Γεια σας').bcp47).toBe('el-GR')
  })

  it('identifies Chinese characters without kana', () => {
    expect(detectLanguage('机器学习与自然语言处理').bcp47).toBe('zh-CN')
    expect(detectLanguage('词条捕手').name).toBe('中文')
  })

  it('identifies German with umlauts and eszett', () => {
    expect(detectLanguage('schön').bcp47).toBe('de-DE')
    expect(detectLanguage('Fußgänger').bcp47).toBe('de-DE')
  })

  it('identifies French with specific accents', () => {
    expect(detectLanguage('déjà vu').bcp47).toBe('fr-FR')
    expect(detectLanguage('cœur').bcp47).toBe('fr-FR')
  })

  it('identifies Spanish with ñ or inverted punctuation', () => {
    expect(detectLanguage('mañana').bcp47).toBe('es-ES')
    expect(detectLanguage('¿Cómo estás?').bcp47).toBe('es-ES')
  })

  it('falls back to provided fallback for plain English or unknown', () => {
    expect(detectLanguage('hello world', 'en-US').bcp47).toBe('en-US')
    expect(detectLanguage('12345', 'en-US').bcp47).toBe('en-US')
    expect(detectLanguage('', 'en-GB').bcp47).toBe('en-GB')
  })
})
