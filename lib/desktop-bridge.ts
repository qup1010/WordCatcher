import { timeout } from './net'
import type { CapturedCard, Settings } from './types'

const BRIDGE_TIMEOUT_MS = 1500

/**
 * 探测 Windows 桌面端本地桥接服务是否在线。
 */
export async function checkDesktopBridge(baseUrl: string): Promise<boolean> {
  const url = baseUrl.trim().replace(/\/+$/, '')
  if (!url) return false

  try {
    const res = await fetch(`${url}/api/v1/health`, {
      method: 'GET',
      signal: timeout(BRIDGE_TIMEOUT_MS),
    })
    return res.ok
  } catch {
    return false
  }
}

/**
 * 将浏览器端收藏的词条与语境同步写入 Windows 桌面版的本地 SQLite 词库。
 * 桌面端未运行时静默忽略，不阻塞插件自身的存卡流程。
 */
export async function syncCardToDesktop(card: CapturedCard, settings: Settings): Promise<boolean> {
  if (!settings.desktopBridge?.enabled) return false
  const baseUrl = settings.desktopBridge.url.trim().replace(/\/+$/, '')
  if (!baseUrl) return false

  try {
    const res = await fetch(`${baseUrl}/api/v1/words`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        word: card.entry.word,
        reading: card.entry.reading,
        partOfSpeech: card.entry.partOfSpeech,
        definition: card.entry.definition,
        contextTranslation: card.entry.contextTranslation,
        memoryHook: card.entry.memoryHook ?? '',
        selection: card.selection,
        sentence: card.sentence,
        sentenceOffset: card.sentenceOffset,
        sourceUri: card.pageUrl,
        sourceTitle: card.pageTitle,
        createdAt: card.createdAt,
        recordId: card.recordId,
        analysis: card.entry.inputKind ? {
          inputKind: card.entry.inputKind,
          expression: card.entry.expression || card.entry.word,
          keyExplanation: card.entry.keyExplanation || '',
          usageNote: card.entry.usageNote || '',
          example: card.entry.example || '',
          exampleTranslation: card.entry.exampleTranslation || '',
        } : undefined,
        generation: card.entry.generation ? {
          model: card.entry.generation.model,
          promptVersion: card.entry.generation.promptVersion,
          generatedAtUtc: card.entry.generation.generatedAt,
        } : undefined,
        edits: card.edits,
        updateExisting: card.updateExisting,
      }),
      signal: timeout(BRIDGE_TIMEOUT_MS),
    })
    return res.ok
  } catch {
    return false
  }
}
