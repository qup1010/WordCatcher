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
  return {
    ...record.card,
    edits: record.edits ? structuredClone(record.edits) : undefined,
    recordId: record.id,
    recordRevision: record.revision ?? 0,
    entry: {
      ...record.card.entry,
      definition: definition ?? record.card.entry.definition,
      contextTranslation: contextTranslation ?? record.card.entry.contextTranslation,
    },
  }
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
    const record: LearningRecord = {
      id,
      card: snapshot,
      revision: (existing?.revision ?? 0) + 1,
      edits: structuredClone(card.edits ?? existing?.edits),
      savedAt: existing?.savedAt ?? Date.now(),
    }
    await storage.setItem(KEY, [record, ...list.filter(r => r.id !== id)])
    return record
  })
}

export function updateLearning(id: string, edits: LearningEdits): Promise<LearningRecord> {
  return mutate(async () => {
    if (!edits.definition?.trim()) throw new Error('语境义不能为空。')
    const list = await readLearning()
    const found = list.find(r => r.id === id)
    if (!found) throw new Error('未找到该条语境记录。')
    const record = {
      ...found,
      revision: (found.revision ?? 0) + 1,
      edits: structuredClone(edits),
      syncedAt: undefined,
      syncError: undefined,
    }
    await storage.setItem(KEY, list.map(r => r.id === id ? record : r))
    return record
  })
}

export function removeLearning(id: string): Promise<LearningRecord[]> {
  return mutate(async () => {
    const list = await readLearning()
    const next = list.filter(r => r.id !== id)
    await storage.setItem(KEY, next)
    return next
  })
}

export function importLearning(rawJson: string): Promise<number> {
  return mutate(async () => {
    let parsed: unknown
    try {
      parsed = JSON.parse(rawJson)
    } catch {
      throw new Error('备份文件不是有效的 JSON 格式。')
    }

    const list = await readLearning()
    const byKey = new Map<string, LearningRecord>()
    for (const item of list) {
      byKey.set(contextKey(item.card), item)
    }

    let incoming: unknown[] = []
    if (Array.isArray(parsed)) {
      incoming = parsed
    } else if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>
      if (Array.isArray(obj.records)) incoming = obj.records
      else if (Array.isArray(obj.history)) incoming = obj.history
    } else {
      throw new Error('备份文件结构不受支持。')
    }

    let added = 0
    for (const item of incoming) {
      if (!item || typeof item !== 'object') continue
      const rec = item as Partial<LearningRecord> & Record<string, unknown>
      if (rec.card && typeof rec.card === 'object' && rec.card.entry?.word && rec.card.entry?.definition) {
        const key = contextKey(rec.card)
        if (!byKey.has(key)) {
          const id = typeof rec.id === 'string' && rec.id ? rec.id : crypto.randomUUID()
          byKey.set(key, {
            id,
            card: { ...structuredClone(rec.card), recordId: id },
            revision: typeof rec.revision === 'number' ? rec.revision : 1,
            edits: rec.edits ? structuredClone(rec.edits) : undefined,
            savedAt: typeof rec.savedAt === 'number' ? rec.savedAt : Date.now(),
          })
          added++
        }
      }
    }

    if (added > 0) {
      const merged = Array.from(byKey.values()).sort((a, b) => b.savedAt - a.savedAt)
      await storage.setItem(KEY, merged)
    }
    return added
  })
}

export function markLearningSync(id: string, error?: string, revision?: number): Promise<void> {
  return mutate(async () => {
    const list = await readLearning()
    await storage.setItem(KEY, list.map(r => r.id === id && (revision === undefined || (r.revision ?? 0) === revision) ? {
      ...r,
      syncedAt: error ? undefined : Date.now(),
      syncError: error,
    } : r))
  })
}

export async function exportLearning(): Promise<string> {
  return JSON.stringify({
    format: 'word-catcher-learning',
    version: 1,
    exportedAt: new Date().toISOString(),
    records: await readLearning(),
  }, null, 2)
}
