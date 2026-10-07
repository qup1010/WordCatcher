import { storage } from '#imports'
import type { HistoryItem } from './types'

const HISTORY_KEY = 'local:lookup_history' as const
const MAX_HISTORY = 100

export async function readHistory(): Promise<HistoryItem[]> {
  const raw = await storage.getItem<unknown>(HISTORY_KEY)
  return Array.isArray(raw) ? (raw as HistoryItem[]) : []
}

export async function addHistory(
  item: Omit<HistoryItem, 'id' | 'timestamp'> & { id?: string, timestamp?: number },
): Promise<HistoryItem[]> {
  const list = await readHistory()
  const wordKey = item.word.trim().toLowerCase()

  // 找到是否已经有相同词形的记录
  const existingIdx = list.findIndex(h => h.word.trim().toLowerCase() === wordKey && h.sentence === item.sentence)
  const isPreviouslySaved = existingIdx >= 0 ? Boolean(list[existingIdx].savedToAnki) : false

  const newItem: HistoryItem = {
    id: item.id || crypto.randomUUID(),
    entry: item.entry,
    selection: item.selection,
    sentenceOffset: item.sentenceOffset,
    word: item.word.trim(),
    reading: item.reading,
    definition: item.definition,
    sentence: item.sentence,
    pageTitle: item.pageTitle,
    pageUrl: item.pageUrl,
    timestamp: item.timestamp ?? Date.now(),
    savedLocally: item.savedLocally,
    savedToAnki: item.savedToAnki ?? isPreviouslySaved,
    source: item.source,
  }

  // 移出旧的，把最新的放在头部
  const filtered = list.filter((_, idx) => idx !== existingIdx)
  const next = [newItem, ...filtered].slice(0, MAX_HISTORY)

  await storage.setItem(HISTORY_KEY, next)
  return next
}

export async function removeHistory(id: string): Promise<HistoryItem[]> {
  const list = await readHistory()
  const next = list.filter(item => item.id !== id)
  await storage.setItem(HISTORY_KEY, next)
  return next
}

export async function clearHistory(): Promise<void> {
  await storage.removeItem(HISTORY_KEY)
}

export async function markHistorySaved(word: string): Promise<HistoryItem[]> {
  const list = await readHistory()
  const target = word.trim().toLowerCase()
  let changed = false

  const next = list.map((item) => {
    if (item.word.trim().toLowerCase() === target && !item.savedToAnki) {
      changed = true
      return { ...item, savedToAnki: true }
    }
    return item
  })

  if (changed) {
    await storage.setItem(HISTORY_KEY, next)
  }
  return next
}
