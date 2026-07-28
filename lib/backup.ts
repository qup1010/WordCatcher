import { normalizeSettings } from './settings'
import type { Settings } from './types'

/**
 * 配置的导出与导入。
 *
 * 用途是换机器：把一台电脑上配好的端点、key、牌组、语言原样搬到另一台。
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
}

export type ParseResult =
  | { ok: true, settings: Settings }
  | { ok: false, error: string }

/** settings 里认得出的顶层字段，用来判断"这看起来是不是我们的配置" */
const KNOWN_KEYS = ['ai', 'anki', 'tts', 'mt', 'explainLanguage', 'triggerMode']

export function buildBackup(settings: Settings, exportedAt: string): Backup {
  return { format: FORMAT, version: VERSION, exportedAt, settings }
}

export function backupFileName(exportedAt: string): string {
  // ISO 串前 10 位就是 YYYY-MM-DD
  return `word-catcher-settings-${exportedAt.slice(0, 10)}.json`
}

function looksLikeSettings(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
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

  if (!raw || typeof raw !== 'object') {
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
    return { ok: true, settings: normalizeSettings(obj.settings) }
  }

  // 没有信封：可能是手写的、或者从旧版本 storage 里直接拷出来的，认得出字段就收
  if (looksLikeSettings(obj)) {
    return { ok: true, settings: normalizeSettings(obj) }
  }

  return { ok: false, error: '文件里没有任何认得出的配置字段，确认一下是不是选错了文件。' }
}

/** 导入后给用户一句能核对的话，让他知道到底导进来了什么 */
export function describeSettings(s: Settings): string {
  const profiles = s.ai.profiles.length
  const withKey = s.ai.profiles.filter(p => p.apiKey.trim()).length
  return `${profiles} 套 AI 配置（${withKey} 套带 key）· 牌组「${s.anki.deckName}」· 释义语言 ${s.explainLanguage}`
}
