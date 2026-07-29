/**
 * 免费机器翻译：微软（Edge 临时 token）和谷歌（公开 gtx 端点）。
 *
 * 定位是「快速看一眼这个词什么意思」，和 AI 词条互补：
 * 不花 token、百毫秒级返回，但没有语境释义，也不做词形还原。
 *
 * 默认微软：它在谷歌被墙的网络环境下也能用。谷歌作为自动回退。
 * 谷歌额外解析词典字段（词性 + 多义项），微软只返回一句译文。
 * 两者都只能在 background 里调用（依赖扩展的 host_permissions 绕过 CORS）。
 */

import { TIMEOUT, isTimeout, timeout } from './net'

export type MtProvider = 'microsoft' | 'google'

export const MT_PROVIDER_LABELS: Record<MtProvider, string> = {
  microsoft: '微软翻译',
  google: '谷歌翻译',
}

/** 释义语言 → 两家翻译服务各自的目标语言代码 */
const TARGET_CODES: Record<string, { google: string, microsoft: string }> = {
  '简体中文': { google: 'zh-CN', microsoft: 'zh-Hans' },
  '繁體中文': { google: 'zh-TW', microsoft: 'zh-Hant' },
  'English': { google: 'en', microsoft: 'en' },
  '日本語': { google: 'ja', microsoft: 'ja' },
}

const DEFAULT_TARGET = TARGET_CODES['简体中文']

export class MtError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MtError'
  }
}

/** 统一把 fetch 的失败翻成一句人话，超时和连不上要分开说 */
function netError(who: string, err: unknown): MtError {
  return new MtError(isTimeout(err)
    ? `${who}超过 ${TIMEOUT.mt / 1000} 秒没有响应。`
    : `连不上${who}。`)
}

// ── 谷歌 ────────────────────────────────────────

export interface GoogleDictEntry {
  /** 词性，如 "名词" / "动词" / "noun" */
  pos: string
  /** 该词性下的若干义项 */
  meanings: string[]
}

export interface GoogleTranslation {
  translation: string
  /** 词典数据（有则带词性 + 多义项；短语/长句通常没有） */
  dictionary?: GoogleDictEntry[]
}

/**
 * 解析 gtx 响应。
 *
 * 结构大致是：
 *   [0] 译文分段 [[["译文","原文",...], ...], ...]
 *   [1] 词典     [["名词", ["义1","义2",...], ...], ["动词", [...], ...], ...]
 *
 * 词典段不是每次都有（句子、短语常缺），解析失败就只返回译文。
 */
export function parseGooglePayload(data: unknown): GoogleTranslation {
  if (!Array.isArray(data)) {
    throw new MtError('谷歌翻译返回了无法解析的内容')
  }

  const chunks = data[0]
  if (!Array.isArray(chunks)) {
    throw new MtError('谷歌翻译返回了无法解析的内容')
  }

  const translation = chunks
    .filter((c): c is unknown[] => Array.isArray(c))
    .map(c => c[0])
    .filter((s): s is string => typeof s === 'string')
    .join('')

  if (!translation) {
    throw new MtError('谷歌翻译返回了无法解析的内容')
  }

  const dictionary = parseGoogleDictionary(data[1])
  return dictionary.length > 0
    ? { translation, dictionary }
    : { translation }
}

/** 从响应的第 2 段抽出「词性 → 义项列表」 */
function parseGoogleDictionary(raw: unknown): GoogleDictEntry[] {
  if (!Array.isArray(raw)) return []

  const out: GoogleDictEntry[] = []
  for (const block of raw) {
    if (!Array.isArray(block) || block.length < 2) continue
    const pos = typeof block[0] === 'string' ? block[0].trim() : ''
    if (!pos) continue

    const meaningsRaw = block[1]
    if (!Array.isArray(meaningsRaw)) continue

    const meanings = meaningsRaw
      .filter((m): m is string => typeof m === 'string' && m.trim().length > 0)
      .map(m => m.trim())
      // 同一词性下义项去重，保持顺序
      .filter((m, i, arr) => arr.indexOf(m) === i)
      .slice(0, 8) // 面板空间有限，每组最多 8 条

    if (meanings.length === 0) continue
    out.push({ pos, meanings })
  }
  return out
}

/**
 * 谷歌 gtx：译文 + 可选词典。
 *
 * dt 参数：
 *   t  — 译文
 *   bd — 双语词典（词性分组的义项，我们主要吃这个）
 *   md — 单语定义（有时补充）
 *   at — 备选译法
 */
export async function googleTranslate(text: string, targetLang: string): Promise<GoogleTranslation> {
  // URLSearchParams 同名 key 会覆盖，多个 dt 要手动拼
  const qs = [
    'client=gtx',
    'sl=auto',
    `tl=${encodeURIComponent(targetLang)}`,
    'dt=t',
    'dt=bd',
    'dt=md',
    'dt=at',
    `q=${encodeURIComponent(text)}`,
  ].join('&')

  let res: Response
  try {
    res = await fetch(`https://translate.googleapis.com/translate_a/single?${qs}`, {
      signal: timeout(TIMEOUT.mt),
    })
  } catch (err) {
    throw netError('谷歌翻译', err)
  }
  if (!res.ok) throw new MtError(`谷歌翻译返回 HTTP ${res.status}`)

  const data = await res.json()
  return parseGooglePayload(data)
}

// ── 微软 ────────────────────────────────────────

interface CachedToken {
  value: string
  expiresAt: number
}

let msToken: CachedToken | null = null
let msTokenInflight: Promise<string> | null = null

/** 从 JWT 里解出过期时间；解不出来就按 8 分钟算（Edge token 实际约 10 分钟） */
function jwtExpiry(token: string): number {
  try {
    const payload = JSON.parse(
      atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')),
    ) as { exp?: number }
    if (typeof payload.exp === 'number') return payload.exp * 1000
  } catch {
    // token 不是标准 JWT 时走保守估计
  }
  return Date.now() + 8 * 60_000
}

/**
 * 拿微软翻译的临时 token。
 * 带缓存（提前 60 秒过期）和并发去重——同时来 N 个请求只发一次 auth。
 */
async function getMicrosoftToken(): Promise<string> {
  if (msToken && Date.now() < msToken.expiresAt - 60_000) {
    return msToken.value
  }

  if (!msTokenInflight) {
    msTokenInflight = (async () => {
      let res: Response
      try {
        res = await fetch('https://edge.microsoft.com/translate/auth', {
          signal: timeout(TIMEOUT.mt),
        })
      } catch (err) {
        throw netError('微软翻译鉴权服务', err)
      }
      if (!res.ok) throw new MtError(`微软翻译鉴权失败：HTTP ${res.status}`)
      const value = await res.text()
      msToken = { value, expiresAt: jwtExpiry(value) }
      return value
    })().finally(() => {
      msTokenInflight = null
    })
  }
  return msTokenInflight
}

/** 仅供测试：清掉模块级 token 缓存 */
export function __resetMicrosoftToken(): void {
  msToken = null
  msTokenInflight = null
}

export async function microsoftTranslate(text: string, targetLang: string): Promise<string> {
  const token = await getMicrosoftToken()

  // 不传 from 即自动检测源语言
  let res: Response
  try {
    res = await fetch(
      `https://api-edge.cognitive.microsofttranslator.com/translate?to=${targetLang}&api-version=3.0`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify([{ Text: text }]),
        signal: timeout(TIMEOUT.mt),
      },
    )
  } catch (err) {
    throw netError('微软翻译', err)
  }

  if (res.status === 401) {
    // token 提前失效的兜底：清缓存，让下一次请求重新鉴权
    msToken = null
    throw new MtError('微软翻译 token 失效，请重试一次。')
  }
  if (!res.ok) throw new MtError(`微软翻译返回 HTTP ${res.status}`)

  const data = (await res.json()) as Array<{ translations?: Array<{ text?: string }> }>
  const out = data?.[0]?.translations?.[0]?.text
  if (typeof out !== 'string') throw new MtError('微软翻译返回了无法解析的内容')
  return out
}

// ── 统一入口 ────────────────────────────────────

export interface QuickTranslation {
  translation: string
  /** 实际使用的服务（回退后与首选不同） */
  provider: MtProvider
  /** 首选服务失败、自动切换到了另一家 */
  fellBack: boolean
  /**
   * 词性 + 多义项。目前只有谷歌路径会填；
   * 微软或回退到微软时为 undefined。
   */
  dictionary?: GoogleDictEntry[]
}

export async function quickTranslate(
  text: string,
  opts: { provider: MtProvider, explainLanguage: string },
): Promise<QuickTranslation> {
  const codes = TARGET_CODES[opts.explainLanguage] ?? DEFAULT_TARGET

  const order: MtProvider[] =
    opts.provider === 'google' ? ['google', 'microsoft'] : ['microsoft', 'google']

  let firstError: unknown
  for (const provider of order) {
    try {
      if (provider === 'google') {
        const g = await googleTranslate(text, codes.google)
        return {
          translation: g.translation,
          provider: 'google',
          fellBack: provider !== order[0],
          dictionary: g.dictionary,
        }
      }

      const translation = await microsoftTranslate(text, codes.microsoft)
      return { translation, provider: 'microsoft', fellBack: provider !== order[0] }
    } catch (err) {
      if (provider === order[0]) firstError = err
    }
  }

  const detail = firstError instanceof Error ? firstError.message : String(firstError)
  throw new MtError(`两家翻译服务都没能连上（${detail}），请检查网络。`)
}
