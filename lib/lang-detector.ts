/**
 * 轻量、零依赖的文本语种识别工具。
 *
 * 基于字符集分布与形态特征判定语言，用于智能匹配 TTS 发音与语种标签。
 */

export interface DetectedLanguage {
  /** 标准 BCP-47 标签，如 ja-JP, zh-CN, de-DE, en-US */
  bcp47: string
  /** Anki {{tts}} 模板格式，如 ja_JP, zh_CN, de_DE, en_US */
  ankiLang: string
  /** 识别出的主要语言名称 */
  name: string
}

const LANGUAGE_MAP: Record<string, { bcp47: string, ankiLang: string, name: string }> = {
  ja: { bcp47: 'ja-JP', ankiLang: 'ja_JP', name: '日语' },
  ko: { bcp47: 'ko-KR', ankiLang: 'ko_KR', name: '韩语' },
  ru: { bcp47: 'ru-RU', ankiLang: 'ru_RU', name: '俄语' },
  el: { bcp47: 'el-GR', ankiLang: 'el_GR', name: '希腊语' },
  zh: { bcp47: 'zh-CN', ankiLang: 'zh_CN', name: '中文' },
  de: { bcp47: 'de-DE', ankiLang: 'de_DE', name: '德语' },
  fr: { bcp47: 'fr-FR', ankiLang: 'fr_FR', name: '法语' },
  es: { bcp47: 'es-ES', ankiLang: 'es_ES', name: '西班牙语' },
  en: { bcp47: 'en-US', ankiLang: 'en_US', name: '英语' },
}

export function detectLanguage(text: string, fallbackBcp47 = 'en-US'): DetectedLanguage {
  const trimmed = text.trim()
  if (!trimmed) {
    return bcp47ToDetected(fallbackBcp47)
  }

  // 1. 日文：包含平假名或片假名（汉字可能混入日文句子，假名是确定标志）
  if (/[\u3040-\u309F\u30A0-\u30FF]/.test(trimmed)) {
    return LANGUAGE_MAP.ja
  }

  // 2. 韩文：包含韩文字母（谚文）
  if (/[\uAC00-\uD7AF\u1100-\u11FF]/.test(trimmed)) {
    return LANGUAGE_MAP.ko
  }

  // 3. 俄文：包含西里尔字母
  if (/[\u0400-\u04FF]/.test(trimmed)) {
    return LANGUAGE_MAP.ru
  }

  // 4. 希腊文：包含希腊字母
  if (/[\u0370-\u03FF]/.test(trimmed)) {
    return LANGUAGE_MAP.el
  }

  // 5. 中文：包含汉字且无假名
  if (/[\u4E00-\u9FFF]/.test(trimmed)) {
    return LANGUAGE_MAP.zh
  }

  // 6. 德语特有字符 (ä, ö, ü, ß 等)
  if (/[äöüßÄÖÜ]/.test(trimmed)) {
    return LANGUAGE_MAP.de
  }

  // 7. 法语特定重音字符 (é, è, ê, ë, à, â, ù, û, ç, œ, æ 等)
  if (/[éèêëàâùûçœæÉÈÊËÀÂÙÛÇŒÆ]/.test(trimmed)) {
    return LANGUAGE_MAP.fr
  }

  // 8. 西班牙语特有字符 (ñ, ¿, ¡, 或带重音的高频形态)
  if (/[ñ¿¡Ñ]/.test(trimmed)) {
    return LANGUAGE_MAP.es
  }

  // 9. 默认回退到指定默认语言（通常是用户的设置主语言）
  return bcp47ToDetected(fallbackBcp47)
}

function bcp47ToDetected(bcp47: string): DetectedLanguage {
  const norm = bcp47.replace('_', '-')
  const prefix = norm.split('-')[0].toLowerCase()
  const matched = LANGUAGE_MAP[prefix]
  if (matched) {
    return {
      bcp47: norm,
      ankiLang: norm.replace('-', '_'),
      name: matched.name,
    }
  }

  return {
    bcp47: norm,
    ankiLang: norm.replace('-', '_'),
    name: norm,
  }
}
