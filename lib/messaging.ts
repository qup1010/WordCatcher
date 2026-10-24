import { browser } from '#imports'
import type { PartialEntry } from './ai'
import type { GoogleDictEntry, MtProvider } from './machine-translate'
import type { DictMeta, QuickDictResult } from './open-dict/types'
import type { CapturedCard, HistoryItem, WordEntry, LearningEdits, LearningRecord, WebDavSyncState, Settings } from './types'

/**
 * 内容脚本 / 弹窗 / 设置页 与 background 之间的消息契约。
 *
 * 所有通过 sendMessage 走的请求都包在 Result<T> 里返回：
 * background 抓到任何异常都会转成 { ok: false, error }，
 * 调用方永远拿得到结构化的成功/失败，不会掉进 unhandled rejection。
 */

export type QuickLookupData =
  | {
    mode: 'dict'
    dict: QuickDictResult
  }
  | {
    mode: 'mt'
    translation: string
    provider: MtProvider
    fellBack: boolean
    dictionary?: GoogleDictEntry[]
  }

export interface LookupContextPayload {
  sentence?: string
  sentenceOffset?: number
  pageTitle?: string
  pageUrl?: string
}

export interface ActiveLookupSnapshot {
  word: string
  selection: string
  sentence: string
  sentenceOffset: number
  pageUrl: string
  pageTitle: string
  entry?: WordEntry
  dict?: QuickDictResult
  updatedAt: number
}

export type Request =
  | { type: 'quick-translate', payload: { text: string, context?: LookupContextPayload } }
  | { type: 'translate-sentence', payload: { sentence: string, selection?: string, mode?: 'mt' | 'ai' } }
  | { type: 'save-card', payload: CapturedCard }
  | { type: 'undo-save', payload: { id: string } }
  | { type: 'library-list' }
  | { type: 'library-update', payload: { id: string, edits: LearningEdits } }
  | { type: 'library-sync', payload: { id: string } }
  | { type: 'library-remove', payload: { id: string } }
  | { type: 'library-import', payload: { json: string } }
  | { type: 'library-export' }
  | { type: 'webdav-test', payload?: { settings: Settings } }
  | { type: 'webdav-sync', payload?: { forcePush?: boolean } }
  | { type: 'webdav-status' }
  | { type: 'webdav-resolve', payload: { token: string, keepLocal: boolean } }
  | { type: 'pending-count' }
  | { type: 'pending-list' }
  | { type: 'remove-pending', payload: { word: string, contextKey?: string, recordId?: string } }
  | { type: 'clear-pending' }
  | { type: 'cache-stats' }
  | { type: 'clear-cache' }
  | { type: 'flush-pending' }
  | { type: 'check-duplicate', payload: { word: string, context?: { selection: string, sentence: string, sentenceOffset: number, pageUrl: string } } }
  | { type: 'check-anki', payload?: { settings: Settings } }
  | { type: 'sync-anki-templates' }
  | { type: 'list-models', payload?: { settings: Settings } }
  | { type: 'test-ai', payload?: { settings: Settings } }
  | { type: 'open-options' }
  | { type: 'open-sidepanel' }
  | { type: 'sidepanel-set-active', payload: ActiveLookupSnapshot }
  | { type: 'sidepanel-get-active' }
  | { type: 'dict-status' }
  | { type: 'dict-clear' }
  | { type: 'dict-lookup', payload: { word: string } }
  | { type: 'history-list' }
  | { type: 'history-import', payload: { items: HistoryItem[] } }
  | { type: 'history-remove', payload: { id: string } }
  | { type: 'history-clear' }

export interface ResponseMap {
  'quick-translate': QuickLookupData
  'translate-sentence': {
    translation: string
    mode: 'mt' | 'ai'
  }
  'save-card': {
    noteId: number | null
    queued: boolean
    pending?: number
    recordId?: string
    syncError?: string
    undoId?: string
  }
  'undo-save': null
  'library-list': LearningRecord[]
  'library-update': LearningRecord
  'library-sync': { noteId: number | null, queued: boolean, syncError?: string }
  'library-remove': LearningRecord[]
  'library-import': { added: number, records: LearningRecord[] }
  'library-export': string
  'webdav-test': { exists: boolean, fileUrl: string }
  'webdav-sync': {
    added: number
    updated: number
    removed: number
    total: number
    pushed: boolean
    syncedAt: number
    records: LearningRecord[]
  }
  'webdav-resolve': ResponseMap['webdav-sync']
  'webdav-status': WebDavSyncState
  'pending-count': { count: number }
  'pending-list': { cards: CapturedCard[] }
  'remove-pending': { count: number }
  'clear-pending': { count: number }
  'cache-stats': { size: number }
  'clear-cache': { cleared: number }
  'flush-pending': { written: number, dropped: number, remaining: number }
  'check-duplicate': { exists: boolean }
  'check-anki': { version: number }
  'sync-anki-templates': null
  'list-models': { models: string[] }
  'test-ai': {
    sample: WordEntry | null
    reply: string | null
    structuredError: string | null
  }
  'open-options': null
  'open-sidepanel': null
  'sidepanel-set-active': null
  'sidepanel-get-active': ActiveLookupSnapshot | null
  'dict-status': DictMeta
  'dict-clear': null
  'dict-lookup': QuickDictResult | null
  'history-list': HistoryItem[]
  'history-import': HistoryItem[]
  'history-remove': HistoryItem[]
  'history-clear': null
}

export type Result<T> = { ok: true, data: T } | { ok: false, error: string }

export async function sendMessage<R extends Request>(
  req: R,
): Promise<Result<ResponseMap[R['type']]>> {
  try {
    const res = await browser.runtime.sendMessage(req)
    if (!res || typeof res !== 'object' || !('ok' in res)) {
      return { ok: false, error: '扩展后台未响应，请刷新当前页面后重试。' }
    }
    return res as Result<ResponseMap[R['type']]>
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : '与扩展后台通信失败，请刷新当前页面后重试。',
    }
  }
}

// ── 流式词条生成（Port 长连接） ─────────────────

export const ENTRY_STREAM_PORT = 'entry-stream' as const

export interface StreamStart {
  selection: string
  sentence: string
  sentenceOffset?: number
  pageUrl?: string
  pageTitle?: string
  bypassCache?: boolean
}

export type StreamEvent =
  | { type: 'partial', entry: PartialEntry }
  | { type: 'done', entry: WordEntry }
  | { type: 'error', message: string }

export interface StreamHandlers {
  onPartial: (partial: PartialEntry) => void
  onDone: (entry: WordEntry) => void
  onError: (message: string) => void
}

export function openEntryStream(
  req: StreamStart,
  handlers: StreamHandlers,
): () => void {
  let settled = false
  let port: ReturnType<typeof browser.runtime.connect>

  try {
    port = browser.runtime.connect({ name: ENTRY_STREAM_PORT })
  } catch {
    handlers.onError('扩展已更新或重载，请刷新当前网页后再试。')
    return () => {}
  }

  port.onMessage.addListener((msg: unknown) => {
    const ev = msg as StreamEvent
    if (ev.type === 'partial') {
      handlers.onPartial(ev.entry)
    } else if (ev.type === 'done') {
      settled = true
      handlers.onDone(ev.entry)
    } else if (ev.type === 'error') {
      settled = true
      handlers.onError(ev.message)
    }
  })

  port.onDisconnect.addListener(() => {
    if (!settled) {
      settled = true
      handlers.onError('与扩展后台的连接中断，请重试。')
    }
  })

  port.postMessage(req)

  return () => {
    settled = true
    try {
      port.disconnect()
    } catch {
      // ignore
    }
  }
}
