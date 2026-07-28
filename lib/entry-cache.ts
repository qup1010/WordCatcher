import { activeAiProfile } from './settings'
import type { Settings, WordEntry } from './types'

/**
 * AI 词条的内存缓存。
 *
 * 同一个词在同一页反复划选是常态（回头再看一眼），每次都重新请求既慢又花钱。
 * 缓存放在 background 的模块作用域里：service worker 被回收时自然清空，
 * 正好是合理的生命周期——不用考虑失效策略，也不占用户的磁盘配额。
 *
 * 刻意不做持久化：模型和提示词都可能改，落盘的旧结果比没有结果更麻烦。
 */

const MAX_ENTRIES = 50

/** Map 的插入顺序就是 LRU 顺序，命中时删了重插即可 */
const cache = new Map<string, WordEntry>()

/**
 * 缓存键要包含所有会改变结果的输入。
 *
 * 原句必须进键：同一个词在不同句子里的释义本来就该不同，
 * 这正是这个插件和普通词典的区别所在，漏掉它等于把核心功能缓存坏了。
 */
export function cacheKey(params: {
  selection: string
  sentence: string
  settings: Settings
}): string {
  const profile = activeAiProfile(params.settings)
  return [
    profile.baseURL.trim(),
    profile.model.trim(),
    params.settings.explainLanguage,
    params.sentence,
    params.selection,
  // NUL 不会出现在正文里，用它当分隔符可以避免「a|b」和「a」+「|b」撞成同一个键
  ].join('\u0000')
}

export function getCached(key: string): WordEntry | undefined {
  const hit = cache.get(key)
  if (!hit) return undefined

  // 重新插到队尾，标记为最近使用
  cache.delete(key)
  cache.set(key, hit)
  return hit
}

export function setCached(key: string, entry: WordEntry): void {
  cache.delete(key)
  cache.set(key, entry)

  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next()
    if (oldest.done) break
    cache.delete(oldest.value)
  }
}

/** 仅供测试与配置变更时使用 */
export function clearCache(): void {
  cache.clear()
}

export function cacheSize(): number {
  return cache.size
}
