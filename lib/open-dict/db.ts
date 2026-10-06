import { getLemmatizeCandidates } from './lemmatizer'
import type { DictMeta, OpenDictEntry, QuickDictResult } from './types'

const DB_NAME = 'word_catcher_open_dict'
const DB_VERSION = 1
const STORE_ENTRIES = 'entries'
const STORE_META = 'meta'
const META_KEY = 'dict_meta'

const DEFAULT_META: DictMeta = {
  status: 'uninstalled',
  entryCount: 0,
  updatedAt: 0,
}

let dbInstance: IDBDatabase | null = null

export function openDictDb(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance)

  return new Promise((resolve, reject) => {
    // 浏览器环境下 window.indexedDB 或 globalThis.indexedDB
    const idb = typeof indexedDB !== 'undefined' ? indexedDB : globalThis.indexedDB
    if (!idb) {
      reject(new Error('IndexedDB 在当前环境中不可用'))
      return
    }

    const req = idb.open(DB_NAME, DB_VERSION)

    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_ENTRIES)) {
        db.createObjectStore(STORE_ENTRIES, { keyPath: 'headword' })
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' })
      }
    }

    req.onsuccess = () => {
      dbInstance = req.result
      dbInstance.onclose = () => {
        dbInstance = null
      }
      resolve(dbInstance)
    }

    req.onerror = () => {
      reject(req.error || new Error('打开词典数据库失败'))
    }
  })
}

export async function getDictMeta(): Promise<DictMeta> {
  const db = await openDictDb()
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_META, 'readonly')
      const store = tx.objectStore(STORE_META)
      const req = store.get(META_KEY)

      req.onsuccess = () => {
        const record = req.result as { key: string, data: DictMeta } | undefined
        resolve(record?.data ?? DEFAULT_META)
      }
      req.onerror = () => resolve(DEFAULT_META)
    } catch {
      resolve(DEFAULT_META)
    }
  })
}

export async function saveDictMeta(meta: DictMeta): Promise<void> {
  const db = await openDictDb()
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_META, 'readwrite')
      const store = tx.objectStore(STORE_META)
      const req = store.put({ key: META_KEY, data: meta })

      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error || new Error('保存词库元数据失败'))
    } catch (err) {
      reject(err)
    }
  })
}

export async function saveBatchEntries(entries: OpenDictEntry[]): Promise<void> {
  if (entries.length === 0) return
  const db = await openDictDb()

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_ENTRIES, 'readwrite')
    const store = tx.objectStore(STORE_ENTRIES)

    for (const entry of entries) {
      if (entry && entry.headword) {
        store.put(entry)
      }
    }

    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error || new Error('批量写入词典失败'))
    tx.onabort = () => reject(new Error('词典写入事务被中止'))
  })
}

export async function getEntry(word: string): Promise<OpenDictEntry | null> {
  const normalized = word.trim().toLowerCase()
  if (!normalized) return null

  const db = await openDictDb()
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_ENTRIES, 'readonly')
      const store = tx.objectStore(STORE_ENTRIES)
      const req = store.get(normalized)

      req.onsuccess = () => {
        resolve((req.result as OpenDictEntry) || null)
      }
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

export function formatPosLabel(pos: string): string {
  const p = pos.trim().toLowerCase()
  if (p === 'noun' || p === 'n') return 'n.'
  if (p === 'verb' || p === 'v') return 'v.'
  if (p === 'adjective' || p === 'adj') return 'adj.'
  if (p === 'adverb' || p === 'adv') return 'adv.'
  if (p === 'preposition' || p === 'prep') return 'prep.'
  if (p === 'conjunction' || p === 'conj') return 'conj.'
  if (p === 'pronoun' || p === 'pron') return 'pron.'
  if (p === 'interjection' || p === 'int') return 'int.'
  if (p === 'phrase' || p === 'phr') return 'phr.'
  return p.endsWith('.') ? p : `${p}.`
}

/**
 * 转换 OpenDictEntry 为精简的快速查词结果 QuickDictResult
 */
function priorityRank(priority: string): number {
  switch (priority?.trim().toLowerCase()) {
    case 'core': return 0
    case 'rare': return 2
    default: return 1
  }
}

function isProperName(group: OpenDictEntry['pos_groups'][number]): boolean {
  const pos = group.pos.trim().replace(/\.$/, '').toLowerCase()
  return group.proper_name === true || ['name', 'proper noun', 'proper_noun', 'proper-noun', 'surname'].includes(pos)
}

export function formatQuickDictResult(entry: OpenDictEntry): QuickDictResult {
  const reading = entry.pronunciations?.us || entry.pronunciations?.uk || entry.pronunciations?.ipa || ''
  // 稳定排序只调整展示顺序，完整义项和原始词库对象均保留。
  const allPosGroups = [...(entry.pos_groups || [])]
    .sort((a, b) => Number(isProperName(a)) - Number(isProperName(b)))
    .map(group => ({
      ...group,
      meanings: [...(group.meanings || [])].sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority)),
    }))
  const coreGroups: Array<{ pos: string, meanings: string[], properName?: boolean }> = []
  const coreMeanings: string[] = []
  let primaryPos = ''

  for (const group of allPosGroups) {
    const formattedPos = formatPosLabel(group.pos || '')
    const heading = (meaning: typeof group.meanings[number]) =>
      meaning.short_gloss?.trim() ? meaning.short_gloss : meaning.learner_explanation || ''
    const readable = group.meanings.filter(meaning => heading(meaning).trim())
    const usual = readable.filter(meaning => priorityRank(meaning.priority) < 2)
    const selected = usual.length > 0 ? usual : readable
    const picked = [...new Set(selected.map(heading))].slice(0, 3)
    if (picked.length === 0 && group.summary?.trim()) picked.push(group.summary)
    if (picked.length === 0) continue

    if (!primaryPos) primaryPos = formattedPos
    coreGroups.push({ pos: formattedPos || 'def.', meanings: picked, ...(isProperName(group) ? { properName: true } : {}) })
    for (const gloss of picked) coreMeanings.push(formattedPos ? `${formattedPos} ${gloss}` : gloss)
  }

  return {
    headword: entry.headword,
    reading,
    memoryHook: entry.memory_hook,
    primaryPos,
    coreMeanings,
    coreGroups,
    allPosGroups,
  }
}

/**
 * 智能查词：先查单词本身，未命中则依次进行词形还原查找。
 */
export async function lookupWord(rawWord: string): Promise<QuickDictResult | null> {
  const candidates = getLemmatizeCandidates(rawWord)
  if (candidates.length === 0) return null

  for (const candidate of candidates) {
    const entry = await getEntry(candidate)
    if (entry) {
      return formatQuickDictResult(entry)
    }
  }

  return null
}

/**
 * 清空离线词库与元数据
 */
export async function clearDict(): Promise<void> {
  const db = await openDictDb()
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction([STORE_ENTRIES, STORE_META], 'readwrite')
      tx.objectStore(STORE_ENTRIES).clear()
      tx.objectStore(STORE_META).put({ key: META_KEY, data: DEFAULT_META })

      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error || new Error('清空词库失败'))
    } catch (err) {
      reject(err)
    }
  })
}
