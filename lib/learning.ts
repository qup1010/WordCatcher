import { storage } from '#imports'
import type { CapturedCard, LearningEdits, LearningRecord, LearningWordMeta, WordEntry } from './types'

const STATE_KEY = 'local:learning_state' as const
const LEGACY_KEY = 'local:learning_records' as const
const LEGACY_TOMBSTONE_KEY = 'local:learning_tombstones' as const

let writes: Promise<unknown> = Promise.resolve()
let deviceIdCache: string | undefined

// 后台串行执行读改写，避免同时点击保存造成记录丢失。
function mutate<T>(action: () => Promise<T>): Promise<T> {
  const next = writes.then(action, action)
  writes = next.catch(() => {})
  return next
}

export function contextKey(card: Pick<CapturedCard, 'selection' | 'sentence' | 'sentenceOffset' | 'pageUrl'>): string {
  return JSON.stringify([card.selection, card.sentence, card.sentenceOffset, card.pageUrl])
}

interface LearningState {
  deviceId: string
  active: LearningRecord[]
  tombstones: LearningRecord[]
}

function versionVectorFor(record: LearningRecord, deviceId: string): Record<string, number> {
  return record.versionVector && Object.keys(record.versionVector).length > 0
    ? { ...record.versionVector }
    : { [deviceId]: Math.max(1, record.revision ?? 1) }
}

function advanceVersionVector(record: LearningRecord, deviceId: string): Record<string, number> {
  const vector = versionVectorFor(record, deviceId)
  const current = vector[deviceId] ?? 0
  if (current >= Number.MAX_SAFE_INTEGER) throw new Error('同步设备版本已超出安全范围。')
  vector[deviceId] = current + 1
  return vector
}

function normalizeState(active: LearningRecord[], tombstones: LearningRecord[], deviceId: string): LearningState {
  const activeById = new Map(active.filter(record => !record.deletedAt).map(record => [record.id, { ...record, versionVector: versionVectorFor(record, deviceId) }]))
  const tombstonesById = new Map(tombstones.filter(record => record.deletedAt).map(record => [record.id, { ...record, versionVector: versionVectorFor(record, deviceId) }]))

  for (const [id, tombstone] of tombstonesById) {
    const current = activeById.get(id)
    if (!current) continue

    const activeRevision = current.revision ?? 1
    const deletedRevision = tombstone.revision ?? 1
    const activeTime = current.updatedAt ?? current.savedAt ?? 0
    const deletedTime = tombstone.deletedAt ?? tombstone.updatedAt ?? tombstone.savedAt ?? 0
    if (activeRevision > deletedRevision || (activeRevision === deletedRevision && activeTime > deletedTime)) {
      tombstonesById.delete(id)
    } else {
      activeById.delete(id)
    }
  }

  return {
    deviceId,
    active: Array.from(activeById.values()),
    tombstones: Array.from(tombstonesById.values()),
  }
}

async function readState(): Promise<LearningState> {
  const rawState = await storage.getItem<unknown>(STATE_KEY)
  if (rawState && typeof rawState === 'object' && !Array.isArray(rawState)) {
    const state = rawState as Record<string, unknown>
    if (Array.isArray(state.active) && Array.isArray(state.tombstones)) {
      const deviceId = typeof state.deviceId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(state.deviceId)
        ? state.deviceId
        : (deviceIdCache ?? crypto.randomUUID())
      deviceIdCache = deviceId
      const normalized = normalizeState(state.active as LearningRecord[], state.tombstones as LearningRecord[], deviceId)
      if (JSON.stringify(normalized) !== JSON.stringify(state)) {
        await writeState(normalized)
      }
      return normalized
    }
  }

  // 旧版分别存储有效记录和删除标记；首次写入新状态时会合并迁移。
  const [legacyActive, legacyTombstones] = await Promise.all([
    storage.getItem<unknown>(LEGACY_KEY),
    storage.getItem<unknown>(LEGACY_TOMBSTONE_KEY),
  ])
  const active = Array.isArray(legacyActive) ? legacyActive as LearningRecord[] : []
  const tombstones = Array.isArray(legacyTombstones) ? legacyTombstones as LearningRecord[] : []
  const deviceId = deviceIdCache ?? crypto.randomUUID()
  deviceIdCache = deviceId
  const normalized = normalizeState(active, tombstones, deviceId)
  await writeState(normalized)
  return normalized
}

function writeState(state: LearningState): Promise<void> {
  deviceIdCache = state.deviceId
  return storage.setItem(STATE_KEY, state)
}

export async function readLearning(): Promise<LearningRecord[]> {
  return (await readState()).active
}

export async function readTombstones(): Promise<LearningRecord[]> {
  return (await readState()).tombstones
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
    const state = await readState()
    const list = state.active
    const tombstones = state.tombstones
    const targetKey = contextKey(card)
    const existing = list.find(r => card.recordId ? r.id === card.recordId : contextKey(r.card) === targetKey)
    if (existing && contextKey(existing.card) !== targetKey) throw new Error('同一记录标识不能用于不同语境。')
    if (existing && !card.updateExisting) return existing

    const existingTombstone = tombstones.find(t => existing
      ? t.id === existing.id
      : card.recordId ? t.id === card.recordId : contextKey(t.card) === targetKey)
    const id = existing?.id ?? existingTombstone?.id ?? card.recordId ?? crypto.randomUUID()
    const now = Date.now()
    const snapshot = structuredClone(card)
    if (existing) {
      snapshot.createdAt = existing.card.createdAt
      snapshot.pageTitle = existing.card.pageTitle
    }
    delete snapshot.edits
    delete snapshot.updateExisting
    snapshot.recordId = id
    const baseRevision = Math.max(existing?.revision ?? 0, existingTombstone?.revision ?? 0)
    const baseRecord = existing ?? existingTombstone ?? {
      id, card: snapshot, savedAt: now, versionVector: {},
    }
    const record: LearningRecord = {
      id,
      card: snapshot,
      revision: baseRevision + 1,
      versionVector: advanceVersionVector(baseRecord, state.deviceId),
      edits: structuredClone(card.edits ?? existing?.edits),
      savedAt: existing?.savedAt ?? existingTombstone?.savedAt ?? now,
      updatedAt: now,
      wordMeta: existing?.wordMeta,
    }
    await writeState({
      ...state,
      active: [record, ...list.filter(r => r.id !== id)],
      tombstones: existingTombstone ? tombstones.filter(t => t.id !== existingTombstone.id) : tombstones,
    })
    return record
  })
}

export function updateLearning(id: string, edits: LearningEdits): Promise<LearningRecord> {
  return mutate(async () => {
    if (!edits.definition?.trim()) throw new Error('语境义不能为空。')
    const state = await readState()
    const list = state.active
    const found = list.find(r => r.id === id)
    if (!found) throw new Error('未找到该条语境记录。')
    const record: LearningRecord = {
      ...found,
      revision: (found.revision ?? 0) + 1,
      versionVector: advanceVersionVector(found, state.deviceId),
      edits: structuredClone(edits),
      updatedAt: Date.now(),
      syncedAt: undefined,
      syncError: undefined,
    }
    await writeState({ ...state, active: list.map(r => r.id === id ? record : r) })
    return record
  })
}

export function removeLearning(id: string): Promise<LearningRecord[]> {
  return mutate(async () => {
    const state = await readState()
    const list = state.active
    const found = list.find(r => r.id === id)
    const next = list.filter(r => r.id !== id)
    if (found) {
      const now = Date.now()
      const tombstone: LearningRecord = {
        ...found,
        revision: (found.revision ?? 1) + 1,
        versionVector: advanceVersionVector(found, state.deviceId),
        updatedAt: now,
        deletedAt: now,
      }
      const nextTombstones = [
        tombstone,
        ...state.tombstones.filter(t => t.id !== id),
      ]
      await writeState({ ...state, active: next, tombstones: nextTombstones })
      return next
    }
    await writeState({ ...state, active: next })
    return next
  })
}

function getProp(obj: Record<string, unknown>, ...names: string[]): unknown {
  for (const name of names) {
    if (name in obj && obj[name] !== undefined && obj[name] !== null) return obj[name]
    const lower = name.toLowerCase()
    for (const k of Object.keys(obj)) {
      if (k.toLowerCase() === lower && obj[k] !== undefined && obj[k] !== null) return obj[k]
    }
  }
  return undefined
}

function getStr(obj: Record<string, unknown>, ...names: string[]): string | undefined {
  const v = getProp(obj, ...names)
  return typeof v === 'string' ? v : undefined
}

function getNum(obj: Record<string, unknown>, ...names: string[]): number | undefined {
  const v = getProp(obj, ...names)
  if (typeof v === 'number' && Number.isFinite(v)) return v
  return undefined
}

function parseTimestampMs(val: unknown): number | undefined {
  if (typeof val === 'number' && Number.isFinite(val) && val > 0) return val
  if (typeof val === 'string' && val.trim()) {
    const parsed = Date.parse(val)
    if (!Number.isNaN(parsed) && parsed > 0) return parsed
  }
  return undefined
}

function normalizeEdits(raw: unknown): LearningEdits | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const obj = raw as Record<string, unknown>
  const definition = getStr(obj, 'definition', 'Definition')
  const contextTranslation = getStr(obj, 'contextTranslation', 'ContextTranslation')
  const note = getStr(obj, 'note', 'Note')
  return {
    ...(definition !== undefined ? { definition } : {}),
    ...(contextTranslation !== undefined ? { contextTranslation } : {}),
    ...(note !== undefined ? { note } : {}),
  }
}

function parseDesktopWordItem(wordObj: Record<string, unknown>): LearningRecord[] {
  const displayWord = getStr(wordObj, 'DisplayWord', 'displayWord', 'word', 'Word')?.trim()
  const wordDef = getStr(wordObj, 'Definition', 'definition')?.trim()
  if (!displayWord) return []

  const wordId = getStr(wordObj, 'Id', 'id')
  const wordReading = getStr(wordObj, 'Reading', 'reading') ?? ''
  const wordPos = getStr(wordObj, 'PartOfSpeech', 'partOfSpeech') ?? ''
  const wordHook = getStr(wordObj, 'MemoryHook', 'memoryHook')
  const wordCreatedAt = parseTimestampMs(getProp(wordObj, 'CreatedAtUtc', 'createdAtUtc', 'createdAt')) ?? Date.now()
  const wordUpdatedAt = parseTimestampMs(getProp(wordObj, 'UpdatedAtUtc', 'updatedAtUtc', 'updatedAt')) ?? wordCreatedAt
  const wordDeletedAt = parseTimestampMs(getProp(wordObj, 'DeletedAtUtc', 'deletedAtUtc', 'deletedAt'))

  const wordMeta: LearningWordMeta | undefined = wordDef
    ? {
        id: wordId,
        displayWord,
        reading: wordReading,
        partOfSpeech: wordPos,
        definition: wordDef,
        memoryHook: wordHook,
        updatedAt: wordUpdatedAt,
        deletedAt: wordDeletedAt,
      }
    : undefined

  const occRaw = getProp(wordObj, 'Occurrences', 'occurrences')
  if (Array.isArray(occRaw) && occRaw.length > 0) {
    const results: LearningRecord[] = []
    for (const occItem of occRaw) {
      if (!occItem || typeof occItem !== 'object') continue
      const occ = occItem as Record<string, unknown>
      const lrRaw = getProp(occ, 'LearningResult', 'learningResult')
      const lr = (lrRaw && typeof lrRaw === 'object' ? lrRaw : {}) as Record<string, unknown>
      const analysisRaw = getProp(lr, 'Analysis', 'analysis')
      const analysis = (analysisRaw && typeof analysisRaw === 'object' ? analysisRaw : null) as Record<string, unknown> | null
      const genRaw = getProp(lr, 'Generation', 'generation')
      const gen = (genRaw && typeof genRaw === 'object' ? genRaw : null) as Record<string, unknown> | null

      const entryWord = getStr(lr, 'Word', 'word')?.trim() || displayWord
      const entryDef = getStr(lr, 'Definition', 'definition')?.trim()
        || getStr(occ, 'Definition', 'definition')?.trim()
        || wordDef
      if (!entryWord || !entryDef) continue

      const selection = getStr(occ, 'SelectedText', 'selection')?.trim() || entryWord
      const sentence = getStr(occ, 'Sentence', 'sentence')?.trim() || selection
      const sentenceOffset = getNum(occ, 'SelectionOffset', 'sentenceOffset') ?? -1
      const contextTranslation = getStr(lr, 'ContextTranslation', 'contextTranslation')
        ?? getStr(occ, 'ContextTranslation', 'contextTranslation')
        ?? ''
      const pageUrl = getStr(occ, 'SourceUri', 'pageUrl') ?? ''
      const pageTitle = getStr(occ, 'SourceWindowTitle', 'pageTitle') ?? ''
      const sourceProcess = getStr(occ, 'SourceProcess', 'sourceProcess')
      const lookupSource = getStr(occ, 'LookupSource', 'lookupSource')
      const capturedAt = parseTimestampMs(getProp(occ, 'CapturedAtUtc', 'capturedAtUtc', 'createdAt', 'timestamp')) ?? wordCreatedAt
      const updatedAt = parseTimestampMs(getProp(occ, 'UpdatedAtUtc', 'updatedAtUtc', 'updatedAt')) ?? wordUpdatedAt ?? capturedAt
      const deletedAt = parseTimestampMs(getProp(occ, 'DeletedAtUtc', 'deletedAtUtc', 'deletedAt')) ?? wordDeletedAt
      const id = getStr(occ, 'Id', 'id') || crypto.randomUUID()
      const revision = getNum(occ, 'Revision', 'revision') ?? 1

      const inputKindRaw = analysis ? getStr(analysis, 'InputKind', 'inputKind') : undefined
      const inputKind = inputKindRaw === 'word' || inputKindRaw === 'phrase' || inputKindRaw === 'sentence'
        ? inputKindRaw
        : undefined

      const entry: WordEntry = {
        word: entryWord,
        reading: getStr(lr, 'Reading', 'reading') ?? wordReading,
        partOfSpeech: getStr(lr, 'PartOfSpeech', 'partOfSpeech') ?? wordPos,
        definition: entryDef,
        contextTranslation,
        ...(getStr(lr, 'MemoryHook', 'memoryHook') ?? wordHook ? { memoryHook: getStr(lr, 'MemoryHook', 'memoryHook') ?? wordHook } : {}),
        ...(inputKind ? { inputKind } : {}),
        ...(analysis && getStr(analysis, 'Expression', 'expression') ? { expression: getStr(analysis, 'Expression', 'expression') } : {}),
        ...(analysis && getStr(analysis, 'KeyExplanation', 'keyExplanation') ? { keyExplanation: getStr(analysis, 'KeyExplanation', 'keyExplanation') } : {}),
        ...(analysis && getStr(analysis, 'UsageNote', 'usageNote') ? { usageNote: getStr(analysis, 'UsageNote', 'usageNote') } : {}),
        ...(analysis && getStr(analysis, 'Example', 'example') ? { example: getStr(analysis, 'Example', 'example') } : {}),
        ...(analysis && getStr(analysis, 'ExampleTranslation', 'exampleTranslation') ? { exampleTranslation: getStr(analysis, 'ExampleTranslation', 'exampleTranslation') } : {}),
        ...(gen && getStr(gen, 'Model', 'model')
          ? {
              generation: {
                model: getStr(gen, 'Model', 'model') ?? '',
                promptVersion: getStr(gen, 'PromptVersion', 'promptVersion') ?? '',
                generatedAt: getStr(gen, 'GeneratedAtUtc', 'generatedAtUtc', 'generatedAt') ?? new Date(capturedAt).toISOString(),
              },
            }
          : {}),
      }

      const edits = normalizeEdits(getProp(occ, 'Edits', 'edits'))

      results.push({
        id,
        card: {
          recordId: id,
          recordRevision: revision,
          entry,
          selection,
          sentence,
          sentenceOffset,
          pageUrl,
          pageTitle,
          ...(sourceProcess ? { sourceProcess } : {}),
          ...(lookupSource ? { lookupSource } : {}),
          createdAt: capturedAt,
        },
        revision,
        ...(edits ? { edits } : {}),
        savedAt: capturedAt,
        updatedAt,
        ...(deletedAt ? { deletedAt } : {}),
        ...(wordMeta ? { wordMeta } : {}),
      })
    }
    return results
  }

  // 扁平词条或历史记录项（无 Occurrences 数组）
  if (!wordDef) return []
  const selection = getStr(wordObj, 'selection', 'SelectedText')?.trim() || displayWord
  const sentence = getStr(wordObj, 'sentence', 'Sentence')?.trim() || selection
  const sentenceOffset = getNum(wordObj, 'sentenceOffset', 'SelectionOffset') ?? -1
  const contextTranslation = getStr(wordObj, 'contextTranslation', 'ContextTranslation') ?? ''
  const pageUrl = getStr(wordObj, 'pageUrl', 'SourceUri') ?? ''
  const pageTitle = getStr(wordObj, 'pageTitle', 'SourceWindowTitle') ?? ''
  const createdAt = parseTimestampMs(getProp(wordObj, 'timestamp', 'createdAt', 'CapturedAtUtc', 'CreatedAtUtc')) ?? Date.now()
  const id = getStr(wordObj, 'id', 'Id') || crypto.randomUUID()

  return [{
    id,
    card: {
      recordId: id,
      recordRevision: 1,
      entry: {
        word: displayWord,
        reading: wordReading,
        partOfSpeech: wordPos,
        definition: wordDef,
        contextTranslation,
        ...(wordHook ? { memoryHook: wordHook } : {}),
      },
      selection,
      sentence,
      sentenceOffset,
      pageUrl,
      pageTitle,
      createdAt,
    },
    revision: 1,
    savedAt: createdAt,
    updatedAt: wordUpdatedAt,
    ...(wordDeletedAt ? { deletedAt: wordDeletedAt } : {}),
    ...(wordMeta ? { wordMeta } : {}),
  }]
}

export function parseIncomingLearningRecords(rawJson: string, strict = false): LearningRecord[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawJson)
  } catch {
    throw new Error('备份文件不是有效的 JSON 格式。')
  }

  if (strict) {
    const envelope = parsed as Record<string, unknown> | null
    if (!envelope || Array.isArray(envelope) || !Array.isArray(envelope.records)
      || envelope.version !== 3
      || envelope.format !== 'word-catcher-learning') {
      throw new Error('远端同步文件格式不受支持，已停止同步以保留远端数据。')
    }
    const ids = new Set<string>()
    for (const item of envelope.records) {
      const r = item as LearningRecord | null
      if (!r || typeof r.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(r.id) || ids.has(r.id)
        || typeof r.revision !== 'number' || !Number.isInteger(r.revision) || r.revision < 1 || r.revision > 2147483647
        || !r.versionVector || typeof r.versionVector !== 'object' || Array.isArray(r.versionVector)
        || Object.keys(r.versionVector).length === 0
        || Object.keys(r.versionVector).length > 64
        || Object.entries(r.versionVector).some(([device, counter]) => !/^[A-Za-z0-9_-]{1,128}$/.test(device)
          || !Number.isSafeInteger(counter) || counter <= 0)
        || !Number.isSafeInteger(r.savedAt) || r.savedAt <= 0 || r.savedAt > 253402300799999 || !Number.isSafeInteger(r.updatedAt) || !r.updatedAt || r.updatedAt <= 0 || r.updatedAt > 253402300799999
        || (r.deletedAt !== undefined && (!Number.isSafeInteger(r.deletedAt) || r.deletedAt <= 0 || r.deletedAt > 253402300799999))
        || typeof r.card?.entry?.word !== 'string' || !r.card.entry.word.trim()
        || typeof r.card?.entry?.definition !== 'string' || !r.card.entry.definition.trim()
        || typeof r.card.selection !== 'string' || !r.card.selection.trim() || typeof r.card.sentence !== 'string' || !r.card.sentence.trim()
        || typeof r.card.pageUrl !== 'string' || !Number.isInteger(r.card.sentenceOffset) || r.card.sentenceOffset < -2147483648 || r.card.sentenceOffset > 2147483647) {
        throw new Error('远端同步记录不完整或标识重复，已停止同步以保留远端数据。')
      }
      ids.add(r.id)
    }
  }

  let incoming: unknown[] = []
  if (Array.isArray(parsed)) {
    incoming = parsed
  } else if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>
    if (Array.isArray(obj.records)) incoming = obj.records
    else if (Array.isArray(obj.words)) incoming = obj.words
    else if (Array.isArray(obj.history)) incoming = obj.history
    else throw new Error('备份文件结构不受支持。')
  } else {
    throw new Error('备份文件结构不受支持。')
  }

  const parsedRecords: LearningRecord[] = []
  for (const item of incoming) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Partial<LearningRecord> & Record<string, unknown>
    if (rec.card && typeof rec.card === 'object' && rec.card.entry?.word && rec.card.entry?.definition) {
      const id = typeof rec.id === 'string' && rec.id ? rec.id : crypto.randomUUID()
      const savedAt = typeof rec.savedAt === 'number' ? rec.savedAt : (rec.card.createdAt || Date.now())
      const updatedAt = parseTimestampMs(rec.updatedAt) ?? savedAt
      const deletedAt = parseTimestampMs(rec.deletedAt)
      const revision = typeof rec.revision === 'number' ? rec.revision : 1
      const versionVector = rec.versionVector && typeof rec.versionVector === 'object' && !Array.isArray(rec.versionVector)
        ? rec.versionVector as Record<string, number>
        : undefined
      parsedRecords.push({
        id,
        card: { ...structuredClone(rec.card), recordId: id },
        revision,
        ...(versionVector ? { versionVector: structuredClone(versionVector) } : {}),
        edits: normalizeEdits(rec.edits),
        savedAt,
        updatedAt,
        ...(deletedAt ? { deletedAt } : {}),
        ...(!strict && typeof rec.syncedAt === 'number' ? { syncedAt: rec.syncedAt } : {}),
        ...(rec.wordMeta ? { wordMeta: structuredClone(rec.wordMeta) } : {}),
      })
    } else {
      parsedRecords.push(...parseDesktopWordItem(rec))
    }
  }

  return parsedRecords
}

export function importLearning(rawJson: string): Promise<number> {
  return mutate(async () => {
    const incoming = parseIncomingLearningRecords(rawJson)
    const state = await readState()
    const byId = new Map(state.active.map(item => [item.id, item]))
    const tombstonesById = new Map(state.tombstones.map(item => [item.id, item]))

    let added = 0
    const restoredIds = new Set<string>()
    for (const rec of incoming) {
      if (rec.deletedAt) continue
      const existing = byId.get(rec.id)
      const tombstone = tombstonesById.get(rec.id)
      if (existing && contextKey(existing.card) !== contextKey(rec.card)) {
        throw new Error('同一记录标识对应了不同语境，无法导入该备份。')
      }
      if (tombstone && contextKey(tombstone.card) !== contextKey(rec.card)) {
        throw new Error('同一记录标识对应了不同语境，无法导入该备份。')
      }
      // 同一 ID 的本地活动记录可能含有尚未同步的编辑，导入只补缺失记录。
      if (existing) continue
      byId.set(rec.id, { ...rec, versionVector: versionVectorFor(rec, state.deviceId) })
      if (tombstone) restoredIds.add(rec.id)
      added++
    }

    if (added > 0) {
      const active = Array.from(byId.values()).sort((a, b) => b.savedAt - a.savedAt)
      const tombstones = state.tombstones.filter(t => !restoredIds.has(t.id))
      await writeState({ ...state, active, tombstones })
    }
    return added
  })
}

function learningContent(record: LearningRecord): string {
  const e = record.card.entry
  return JSON.stringify([
    e.word, e.reading ?? '', e.partOfSpeech ?? '', e.definition, e.contextTranslation ?? '', e.memoryHook ?? '',
    e.inputKind ?? '', e.expression ?? '', e.keyExplanation ?? '', e.usageNote ?? '', e.example ?? '', e.exampleTranslation ?? '',
    e.generation?.model ?? '', e.generation?.promptVersion ?? '', e.generation ? Date.parse(e.generation.generatedAt) : null,
    record.edits?.definition ?? null, record.edits?.contextTranslation ?? null, record.edits?.note ?? '',
  ])
}

type VersionVectorOrder = 'equal' | 'local-dominates' | 'remote-dominates' | 'concurrent'

function compareVersionVectors(local: Record<string, number>, remote: Record<string, number>): VersionVectorOrder {
  let greater = false
  let less = false
  for (const device of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    const left = local[device] ?? 0
    const right = remote[device] ?? 0
    greater ||= left > right
    less ||= left < right
  }
  if (greater && less) return 'concurrent'
  if (greater) return 'local-dominates'
  if (less) return 'remote-dominates'
  return 'equal'
}

function mergeVersionVectors(left: Record<string, number>, right: Record<string, number>): Record<string, number> {
  const merged = { ...left }
  for (const [device, counter] of Object.entries(right)) merged[device] = Math.max(merged[device] ?? 0, counter)
  return merged
}

function sameWordMetaContent(left: LearningWordMeta, right: LearningWordMeta): boolean {
  return JSON.stringify([
    left.displayWord, left.reading ?? '', left.partOfSpeech ?? '', left.definition,
    left.memoryHook ?? '', left.deletedAt ?? null,
  ]) === JSON.stringify([
    right.displayWord, right.reading ?? '', right.partOfSpeech ?? '', right.definition,
    right.memoryHook ?? '', right.deletedAt ?? null,
  ])
}

function mergeWordMeta(local?: LearningWordMeta, remote?: LearningWordMeta): LearningWordMeta | undefined {
  if (!remote) return local
  if (!local) return remote
  const localTime = local.updatedAt ?? 0
  const remoteTime = remote.updatedAt ?? 0
  if (localTime === remoteTime && !sameWordMetaContent(local, remote)) {
    throw new Error('同一词条摘要在两端具有相同时间戳但内容不同，已停止同步并保留两端内容。')
  }
  return remoteTime > localTime ? remote : local
}

/**
 * 使用每条记录的设备版本向量检测并合并 WebDAV 更新。
 */
export function mergeLearningRecords(rawJson: string): Promise<{
  added: number
  updated: number
  removed: number
  total: number
  needsPush: boolean
}> {
  return mutate(async () => {
    const incoming = parseIncomingLearningRecords(rawJson, true)
    const state = await readState()
    const activeList = state.active
    const tombstones = state.tombstones

    const byKey = new Map<string, LearningRecord>()


    for (const t of tombstones) {
      const k = t.id
      byKey.set(k, t)

    }
    for (const r of activeList) {
      const k = r.id
      byKey.set(k, r)

    }

    let added = 0
    let updated = 0
    let removed = 0
    const seenKeys = new Set<string>()
    let remoteDiffersFromMerged = false

    for (const rem of incoming) {
      const key = rem.id
      seenKeys.add(key)
      const loc = byKey.get(key)

      if (!loc) {
        byKey.set(key, rem)

        if (!rem.deletedAt) added++
        continue
      }

      if (contextKey(loc.card) !== contextKey(rem.card)) {
        throw new Error('同一同步记录标识对应了不同语境，已停止同步，请检查冲突记录。')
      }
      const order = compareVersionVectors(versionVectorFor(loc, state.deviceId), versionVectorFor(rem, state.deviceId))
      const sameContent = Boolean(loc.deletedAt) === Boolean(rem.deletedAt)
        && learningContent(loc) === learningContent(rem)
      if ((order === 'equal' || order === 'concurrent') && !sameContent) {
        throw new Error(order === 'equal'
          ? '同一记录在两端具有相同因果版本但内容不同，已停止同步并保留两端内容。'
          : '检测到两端离线期间并发修改了同一记录，已停止同步并保留两端内容，请先处理冲突。')
      }

      const vectorOrder = order
      if (vectorOrder === 'remote-dominates') {
        const wasDeleted = Boolean(loc.deletedAt)
        const nowDeleted = Boolean(rem.deletedAt)
        const mergedRecord: LearningRecord = {
          ...rem,
          versionVector: versionVectorFor(rem, state.deviceId),
          syncedAt: undefined,
          syncError: undefined,
          wordMeta: mergeWordMeta(loc.wordMeta, rem.wordMeta),
        }
        byKey.set(key, mergedRecord)


        if (!wasDeleted && nowDeleted) removed++
        else if (wasDeleted && !nowDeleted) added++
        else if (!nowDeleted) updated++
      } else if (vectorOrder === 'concurrent') {
        const mergedRecord: LearningRecord = {
          ...loc,
          revision: Math.max(loc.revision ?? 1, rem.revision ?? 1),
          updatedAt: Math.max(loc.updatedAt ?? 0, rem.updatedAt ?? 0),
          versionVector: mergeVersionVectors(versionVectorFor(loc, state.deviceId), versionVectorFor(rem, state.deviceId)),
          wordMeta: mergeWordMeta(loc.wordMeta, rem.wordMeta),
        }
        byKey.set(key, mergedRecord)
        remoteDiffersFromMerged = true
      } else {
        const mergedMeta = mergeWordMeta(loc.wordMeta, rem.wordMeta)
        if (mergedMeta !== loc.wordMeta) byKey.set(key, { ...loc, wordMeta: mergedMeta })
        if (vectorOrder === 'local-dominates') {
          remoteDiffersFromMerged = true
        }
      }
    }

    for (const k of byKey.keys()) {
      if (!seenKeys.has(k)) {
        remoteDiffersFromMerged = true
        break
      }
    }

    const nextActive: LearningRecord[] = []
    const nextTombstones: LearningRecord[] = []
    for (const rec of byKey.values()) {
      if (rec.deletedAt) nextTombstones.push(rec)
      else nextActive.push(rec)
    }

    nextActive.sort((a, b) => b.savedAt - a.savedAt)
    nextTombstones.sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0))

    await writeState({ ...state, active: nextActive, tombstones: nextTombstones })

    return {
      added,
      updated,
      removed,
      total: nextActive.length,
      needsPush: remoteDiffersFromMerged,
    }
  })
}

export function markLearningSync(id: string, error?: string, revision?: number): Promise<void> {
  return mutate(async () => {
    const state = await readState()
    await writeState({
      ...state,
      active: state.active.map(r => r.id === id && (revision === undefined || (r.revision ?? 0) === revision) ? {
        ...r,
        syncedAt: error ? undefined : Date.now(),
        syncError: error,
      } : r),
    })
  })
}

export async function exportLearning(): Promise<string> {
  return JSON.stringify({
    format: 'word-catcher-learning',
    version: 2,
    exportedAt: new Date().toISOString(),
    records: await readLearning(),
  }, null, 2)
}

export function exportSyncLearning(): Promise<string> {
  return mutate(async () => {
    const state = await readState()
    return JSON.stringify({
      format: 'word-catcher-learning',
      version: 3,
      exportedAt: new Date().toISOString(),
      records: [...state.active, ...state.tombstones].map(({ syncedAt: _syncedAt, syncError: _syncError, ...record }) => record),
    }, null, 2)
  })
}
