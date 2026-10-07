import { storage } from '#imports'
import type { CapturedCard, LearningEdits, LearningRecord } from './types'

const KEY = 'local:learning_records' as const
let writes: Promise<unknown> = Promise.resolve()

// 后台串行执行读改写，避免同时点击保存造成记录丢失。
function mutate<T>(action: () => Promise<T>): Promise<T> {
  const next = writes.then(action, action)
  writes = next.catch(() => {})
  return next
}

export function contextKey(card: Pick<CapturedCard, 'selection' | 'sentence' | 'sentenceOffset' | 'pageUrl'>): string {
  return JSON.stringify([card.selection, card.sentence, card.sentenceOffset, card.pageUrl])
}

export async function readLearning(): Promise<LearningRecord[]> {
  const raw = await storage.getItem<unknown>(KEY)
  return Array.isArray(raw) ? raw as LearningRecord[] : []
}

export function effectiveCard(record: LearningRecord): CapturedCard {
  const { definition, contextTranslation } = record.edits ?? {}
  return { ...record.card, recordId: record.id, recordRevision: record.revision ?? 0, entry: { ...record.card.entry,
    definition: definition ?? record.card.entry.definition,
    contextTranslation: contextTranslation ?? record.card.entry.contextTranslation } }
}

export function saveLearning(card: CapturedCard): Promise<LearningRecord> {
  return mutate(async () => {
    if (!card.selection.trim() || !card.entry.word.trim() || !card.entry.definition.trim()) {
      throw new Error('表达和释义不能为空，未保存。')
    }
    if (card.edits?.definition !== undefined && !card.edits.definition.trim()) {
      throw new Error('语境义不能为空。')
    }
    const list = await readLearning()
    const existing = list.find(r => contextKey(r.card) === contextKey(card))
    if (existing && !card.updateExisting) return existing
    const id = existing?.id ?? crypto.randomUUID()
    const snapshot = structuredClone(card)
    if (existing) {
      snapshot.createdAt = existing.card.createdAt
      snapshot.pageTitle = existing.card.pageTitle
    }
    delete snapshot.edits
    delete snapshot.updateExisting
    snapshot.recordId = id
    const record: LearningRecord = { id, card: snapshot, revision: (existing?.revision ?? 0) + 1, edits: structuredClone(card.edits ?? existing?.edits),
      savedAt: existing?.savedAt ?? Date.now() }
    await storage.setItem(KEY, [record, ...list.filter(r => r.id !== id)])
    return record
  })
}

export function updateLearning(id: string, edits: LearningEdits): Promise<LearningRecord> {
  return mutate(async () => {
    if (!edits.definition?.trim()) throw new Error('语境义不能为空。')
    const list = await readLearning()
    const found = list.find(r => r.id === id)
    if (!found) throw new Error('这条语境已不存在。')
    const record = { ...found, revision: (found.revision ?? 0) + 1, edits: structuredClone(edits), syncedAt: undefined, syncError: undefined }
    await storage.setItem(KEY, list.map(r => r.id === id ? record : r))
    return record
  })
}

export function markLearningSync(id: string, error?: string, revision?: number): Promise<void> {
  return mutate(async () => {
    const list = await readLearning()
    await storage.setItem(KEY, list.map(r => r.id === id && (revision === undefined || (r.revision ?? 0) === revision) ? { ...r,
      syncedAt: error ? undefined : Date.now(), syncError: error } : r))
  })
}

export async function exportLearning(): Promise<string> {
  return JSON.stringify({ format: 'word-catcher-learning', version: 1,
    exportedAt: new Date().toISOString(), records: await readLearning() }, null, 2)
}
