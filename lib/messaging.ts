import { browser } from '#imports'
import type { QuickTranslation } from './machine-translate'
import type { CapturedCard, WordEntry } from './types'

/**
 * 内容脚本 ↔ background 的消息协议。
 *
 * AI、机器翻译、AnkiConnect 请求都必须走 background：background 拥有
 * host_permissions，发出的请求不受页面 CORS 限制，也不会把 API key
 * 暴露在页面上下文里。
 */
export type Request =
  | { type: 'generate-entry', payload: { selection: string, sentence: string } }
  | { type: 'quick-translate', payload: { text: string } }
  | { type: 'list-models' }
  | { type: 'test-ai' }
  | { type: 'save-card', payload: CapturedCard }
  | { type: 'check-anki' }
  | { type: 'sync-anki-templates' }
  | { type: 'open-options' }

export type ResponseMap = {
  'generate-entry': WordEntry
  'quick-translate': QuickTranslation
  'list-models': { models: string[] }
  'test-ai': { reply: string }
  'save-card': { noteId: number }
  'check-anki': { version: number }
  'sync-anki-templates': null
  'open-options': null
}

export type Result<T> = { ok: true, data: T } | { ok: false, error: string }

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
