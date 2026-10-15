import { normalizeSettings } from './settings'
import type { HistoryItem, Settings } from './types'

/**
 * 配置与查词历史的导出与导入。
 *
 * 用途是换机器或与桌面端互通：把配好的端点、key、牌组、语言以及最近查词记录原样迁移。
 *
 * 注意导出的文件里包含明文 API key——这是它有用的前提（不带 key 就还得手输一遍），
 * 但也意味着这个文件和 key 本身一样敏感，界面上必须说清楚。
 */

const FORMAT = 'word-catcher-settings'
const VERSION = 1

/** 认得出来是自家文件的信封。缺了它就没法把"格式不对"和"内容坏了"分开报错 */
export interface Backup {
  format: typeof FORMAT
  version: number
  exportedAt: string
  settings: Settings
  history?: HistoryItem[]
}

export type ParseResult =
  | { ok: true, settings: Settings, history?: HistoryItem[] }
  | { ok: false, error: string }

/** settings 里认得出的顶层字段（含插件端 camelCase 与桌面端 PascalCase），用来判断"这看起来是不是我们的配置" */
const KNOWN_KEYS = [
  'ai',
  'anki',
  'tts',
  'mt',
  'explainLanguage',
  'triggerMode',
  'TranslationProfiles',
  'ExplainLanguage',
  'Anki',
]

export function buildBackup(settings: Settings, exportedAt: string, history?: HistoryItem[]): Backup {
  return history && history.length > 0
    ? { format: FORMAT, version: VERSION, exportedAt, settings, history }
    : { format: FORMAT, version: VERSION, exportedAt, settings }
}

export function backupFileName(exportedAt: string): string {
  // ISO 串前 10 位就是 YYYY-MM-DD
  return `word-catcher-settings-${exportedAt.slice(0, 10)}.json`
}

function looksLikeSettings(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return KNOWN_KEYS.some(k => k in (value as Record<string, unknown>))
}

/**
 * 解析导入的文件。
 *
 * 每一步失败都给出各自的说法，而不是笼统一句"文件无效"——用户拿到的可能是
 * 选错了文件、文件被截断、或者是别的扩展的配置，三种情况该做的事完全不同。
 *
 * 关键：绝不能把无法识别的内容交给 normalizeSettings。它对垃圾输入的兜底是
 * 返回一整套默认值，直接存下去等于把用户的配置静默清空。
 */
export function parseBackup(text: string): ParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: '这不是一个有效的 JSON 文件，可能选错了文件或者文件损坏。' }
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: '文件内容不是一个配置对象。' }
  }

  const obj = raw as Record<string, unknown>

  // 带信封的正常导出文件
  if (typeof obj.format === 'string') {
    if (obj.format !== FORMAT) {
      return { ok: false, error: `这是「${obj.format}」的配置文件，不是 Word Catcher 的。` }
    }
    if (!looksLikeSettings(obj.settings)) {
      return { ok: false, error: '文件格式认得，但里面没有配置内容，可能是导出时中断了。' }
    }
    const history = Array.isArray(obj.history) ? (obj.history as HistoryItem[]) : undefined
    return { ok: true, settings: normalizeSettings(obj.settings), ...(history ? { history } : {}) }
  }

  // 没有信封：可能是手写的、或者从桌面端 settings.json / 旧版本 storage 里直接拷出来的
  if (looksLikeSettings(obj)) {
    return { ok: true, settings: normalizeSettings(obj) }
  }

  return { ok: false, error: '文件里没有任何认得出的配置字段，确认一下是不是选错了文件。' }
}

/** 导入后给用户一句能核对的话，让他知道到底导进来了什么 */
export function describeSettings(s: Settings, historyCount = 0): string {
  const profiles = s.ai.profiles.length
  const withKey = s.ai.profiles.filter(p => p.apiKey.trim()).length
  const historyPart = historyCount > 0 ? ` · 历史词条 ${historyCount} 条` : ''
  return `${profiles} 套 AI 配置（${withKey} 套带 key）· 牌组「${s.anki.deckName}」· 释义语言 ${s.explainLanguage}${historyPart}`
}
