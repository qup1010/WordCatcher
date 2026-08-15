import { browser } from '#imports'
import type { PartialEntry } from './ai'
import type { GoogleDictEntry, MtProvider, QuickTranslation } from './machine-translate'
import type { DictMeta, QuickDictResult } from './open-dict/types'
import type { FlushResult } from './pending'
import type { CapturedCard, WordEntry } from './types'

export type QuickLookupResult =
  | { mode: 'dict', dict: QuickDictResult }
  | ({ mode: 'mt' } & QuickTranslation)

/**
 * 内容脚本 ↔ background 的消息协议。
 *
 * AI、机器翻译、AnkiConnect 请求都必须走 background：background 拥有
 * host_permissions，发出的请求不受页面 CORS 限制，也不会把 API key
 * 暴露在页面上下文里。
 */
export type Request =
  | { type: 'quick-translate', payload: { text: string } }
  | { type: 'dict-status' }
  | { type: 'dict-clear' }
  | { type: 'dict-lookup', payload: { word: string } }
  | { type: 'list-models' }
  | { type: 'test-ai' }
  | { type: 'save-card', payload: CapturedCard }
  | { type: 'check-duplicate', payload: { word: string } }
  | { type: 'pending-count' }
  | { type: 'pending-list' }
  | { type: 'remove-pending', payload: { word: string } }
  | { type: 'clear-pending' }
  | { type: 'flush-pending' }
  | { type: 'cache-stats' }
  | { type: 'clear-cache' }
  | { type: 'check-anki' }
  | { type: 'sync-anki-templates' }
  | { type: 'open-options' }

export type ResponseMap = {
  'quick-translate': QuickLookupResult
  'dict-status': DictMeta
  'dict-clear': null
  'dict-lookup': QuickDictResult | null
  'list-models': { models: string[] }
  /**
   * sample 有值 = 整条链路都通，直接拿它渲染一张预览卡；
   * sample 为 null 但 reply 有值 = 端点通、模型答得出话，但不支持结构化输出。
   */
  'test-ai': {
    sample: WordEntry | null
    reply: string | null
    structuredError: string | null
  }
  /** Anki 没开时 noteId 为 null、queued 为 true，卡片进了待写队列 */
  'save-card': { noteId: number | null, queued: boolean, pending?: number }
  'check-duplicate': { exists: boolean }
  'pending-count': { count: number }
  'pending-list': { cards: CapturedCard[] }
  /** 删除/清空后都回传剩余条数，界面直接用它更新，不用再查一次 */
  'remove-pending': { count: number }
  'clear-pending': { count: number }
  'flush-pending': FlushResult
  'cache-stats': { size: number }
  'clear-cache': { cleared: number }
  'check-anki': { version: number }
  'sync-anki-templates': null
  'open-options': null
}

export type Result<T> = { ok: true, data: T } | { ok: false, error: string }

/* ── 流式词条 ──────────────────────────────────────
 *
 * AI 详解走独立的 port 而不是 sendMessage：后者是一问一答，
 * 没法把生成过程中的半成品持续推给内容脚本。
 */

export const ENTRY_STREAM_PORT = 'wc-entry-stream'

export interface StreamStart {
  selection: string
  sentence: string
}

export type StreamEvent =
  /** 又补齐了一些字段，用于逐字渲染 */
  | { type: 'partial', entry: PartialEntry }
  /** 生成结束，这份才是经过 schema 校验、可以存卡的完整结果 */
  | { type: 'done', entry: WordEntry }
  | { type: 'error', message: string }

export interface StreamHandlers {
  onPartial: (entry: PartialEntry) => void
  onDone: (entry: WordEntry) => void
  onError: (message: string) => void
}

/**
 * 开一条流式词条通道，返回取消函数。
 *
 * 取消后不会再回调任何 handler：用户可能已经划了下一个词，
 * 迟到的事件覆盖新状态会让界面串台。
 */
export function openEntryStream(req: StreamStart, handlers: StreamHandlers): () => void {
  // 收到 done/error 之后就算收工。background 收尾时会主动断开 port，
  // 不记这个标记的话，正常结束也会被当成"后台断开了"报一次错。
  let finished = false

  let port: ReturnType<typeof browser.runtime.connect>
  try {
    port = browser.runtime.connect({ name: ENTRY_STREAM_PORT })
  } catch {
    handlers.onError('扩展后台无响应，试试重新加载页面。')
    return () => {}
  }

  port.onMessage.addListener((raw) => {
    if (finished) return
    const event = raw as StreamEvent

    if (event.type === 'partial') {
      handlers.onPartial(event.entry)
    } else if (event.type === 'done') {
      finished = true
      handlers.onDone(event.entry)
    } else {
      finished = true
      handlers.onError(event.message)
    }
  })

  // 走到这里而 finished 还是 false，说明是异常断开：
  // service worker 被回收，或者 background 里抛了没接住的错
  port.onDisconnect.addListener(() => {
    if (finished) return
    finished = true
    handlers.onError('扩展后台断开了，请重试。')
  })

  port.postMessage(req)

  return () => {
    finished = true
    port.disconnect()
  }
}

export async function sendMessage<T extends Request['type']>(
  req: Extract<Request, { type: T }>,
): Promise<Result<ResponseMap[T]>> {
  try {
    return (await browser.runtime.sendMessage(req)) as Result<ResponseMap[T]>
  } catch (err) {
    // service worker 被回收、页面还没重载完等情况会走到这里
    return {
      ok: false,
      error: err instanceof Error ? err.message : '扩展后台无响应，试试重新加载页面。',
    }
  }
}
