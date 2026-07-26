/** 常见 OpenAI 兼容服务商，省得用户自己去翻文档找 base URL */
export interface ProviderPreset {
  label: string
  baseURL: string
  model: string
  hint?: string
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  { label: 'OpenAI', baseURL: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { label: 'DeepSeek', baseURL: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { label: '月之暗面 Kimi', baseURL: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  { label: '智谱 GLM', baseURL: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  { label: '硅基流动', baseURL: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen2.5-7B-Instruct' },
  { label: 'OpenRouter', baseURL: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini' },
  {
    label: '本地 Ollama',
    baseURL: 'http://127.0.0.1:11434/v1',
    model: 'qwen2.5',
    hint: 'API key 随便填一个非空值即可。小模型可能不支持结构化输出，出错就换大一点的模型。',
  },
]

/** 学习语言决定两处发音：插件内试听用 BCP-47，Anki 卡片 {{tts}} 用下划线格式 */
export interface LanguagePreset {
  label: string
  ttsLang: string
  ankiTtsLang: string
}

export const LANGUAGE_PRESETS: LanguagePreset[] = [
  { label: '英语（美）', ttsLang: 'en-US', ankiTtsLang: 'en_US' },
  { label: '英语（英）', ttsLang: 'en-GB', ankiTtsLang: 'en_GB' },
  { label: '日语', ttsLang: 'ja-JP', ankiTtsLang: 'ja_JP' },
  { label: '韩语', ttsLang: 'ko-KR', ankiTtsLang: 'ko_KR' },
  { label: '法语', ttsLang: 'fr-FR', ankiTtsLang: 'fr_FR' },
  { label: '德语', ttsLang: 'de-DE', ankiTtsLang: 'de_DE' },
  { label: '西班牙语', ttsLang: 'es-ES', ankiTtsLang: 'es_ES' },
  { label: '俄语', ttsLang: 'ru-RU', ankiTtsLang: 'ru_RU' },
]

export const EXPLAIN_LANGUAGES = ['简体中文', '繁體中文', 'English', '日本語']
