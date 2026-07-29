import { z } from 'zod'

/**
 * AI 需要生成的部分。
 *
 * 注意这里刻意不包含原句：原句必须由内容脚本从 DOM 精确抓取，
 * 一旦交给 AI 复述，挖空时目标词就可能和句子对不上。
 */
export const wordEntrySchema = z.object({
  word: z
    .string()
    .describe('词条原形。把时态变位、复数、比较级等还原成词典里的形式'),
  reading: z
    .string()
    .describe('读音标注：英语用 IPA 音标（不带斜杠），日语用假名，中文用拼音。无法标注时返回空字符串'),
  partOfSpeech: z
    .string()
    .describe('词性缩写，如 n. / v. / adj. / adv. / phr.'),
  definition: z
    .string()
    .describe('该词在当前这句话语境下的释义，一句话，简明准确'),
  contextTranslation: z
    .string()
    .describe('整句原句的翻译'),
})

export type WordEntry = z.infer<typeof wordEntrySchema>

/** 一次完整的采集结果：AI 生成的部分 + 我们自己抓的事实部分 */
export interface CapturedCard {
  entry: WordEntry
  /** 用户实际划选的文本，可能是变位形式 */
  selection: string
  /** 从 DOM 抓到的完整原句 */
  sentence: string
  /** selection 在 sentence 中的精确偏移，挖空时用它而不是重新查找 */
  sentenceOffset: number
  pageUrl: string
  pageTitle: string
  createdAt: number
}

/** 一套可切换的 AI 端点配置 */
export const aiProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).default('默认'),
  baseURL: z.string().default('https://api.openai.com/v1'),
  apiKey: z.string().default(''),
  model: z.string().default('gpt-4o-mini'),
})

export type AiProfile = z.infer<typeof aiProfileSchema>

export const DEFAULT_AI_PROFILE: AiProfile = {
  id: 'default',
  name: '默认',
  baseURL: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini',
}

export const settingsSchema = z.object({
  /** 支持多套端点配置，activeId 指向当前使用的一套 */
  ai: z.object({
    profiles: z.array(aiProfileSchema).min(1).default([DEFAULT_AI_PROFILE]),
    activeId: z.string().default('default'),
  }),
  /** 释义和句子翻译用哪种语言书写 */
  explainLanguage: z.string().default('简体中文'),
  anki: z.object({
    url: z.string().default('http://127.0.0.1:8765'),
    deckName: z.string().default('Word Catcher'),
    noteTypeName: z.string().default('Word Catcher'),
    /** Anki 卡片模板里 {{tts}} 标签用的语言，决定复习时的朗读发音 */
    ttsLang: z.string().default('en_US'),
    /** 是否在卡片正面把原句里的目标词挖空 */
    clozeContext: z.boolean().default(true),
  }),
  tts: z.object({
    enabled: z.boolean().default(true),
    /** 插件内试听用的语音语言 */
    lang: z.string().default('en-US'),
    rate: z.number().default(0.9),
  }),
  /** 快速翻译（机器翻译，免费免配置）。默认微软：谷歌被墙的网络下也能用 */
  mt: z.object({
    provider: z.enum(['microsoft', 'google']).default('microsoft'),
  }),
  /** auto = 划完词直接查；icon = 先显示一个小图标，点了才查（省 token） */
  triggerMode: z.enum(['auto', 'icon']).default('icon'),
})

export type Settings = z.infer<typeof settingsSchema>

export const DEFAULT_SETTINGS: Settings = settingsSchema.parse({
  ai: {},
  anki: {},
  tts: {},
  mt: {},
})
