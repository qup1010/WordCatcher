import { contextKey } from './learning'
import { storage } from '#imports'
import type { CapturedCard } from './types'

/**
 * Anki 没开时的待写队列。
 *
 * 没有这一层的话，Anki 不在线 = 查到的好词直接丢掉，用户被迫「先开 Anki 再看文章」。
 * 排进队列后可以照常读下去，等 Anki 起来了一次性补写。
 *
 * 只在 background 里用：内容脚本发消息过来，写盘和补写都由 background 完成。
 */

const PENDING_KEY = 'local:pending' as const

/** 队列上限。攒到这个数还没补写，多半是长期没开 Anki，丢掉最老的即可 */
const MAX_PENDING = 200
let writes: Promise<unknown> = Promise.resolve()
function mutate<T>(action: () => Promise<T>): Promise<T> {
  const next = writes.then(action, action)
  writes = next.catch(() => {})
  return next
}

export interface FlushResult {
  /** 成功写进 Anki 的条数 */
  written: number
  /** 因为重复等原因被 Anki 拒绝、已从队列里剔除的条数 */
  dropped: number
  /** 仍然留在队列里的条数（Anki 中途又断了） */
  remaining: number
}

export async function readPending(): Promise<CapturedCard[]> {
  const raw = await storage.getItem<unknown>(PENDING_KEY)
  return Array.isArray(raw) ? (raw as CapturedCard[]) : []
}

export async function pendingCount(): Promise<number> {
  return (await readPending()).length
}

function queueIdentity(card: CapturedCard): string {
  return card.recordId ? `id:${card.recordId}` : `context:${contextKey(card)}`
}

/** 同一记录只保留最新待同步版本；不同 ID 即使语境相同也各自排队。 */
export function enqueue(card: CapturedCard): Promise<number> {
  return mutate(async () => {
    const queue = await readPending()
    const key = queueIdentity(card)

    const existing = queue.findIndex(c => queueIdentity(c) === key)
    if (existing >= 0) {
      queue[existing] = card
      await storage.setItem(PENDING_KEY, queue)
      return queue.length
    }

    // 超上限时丢最老的：新划到的词比几天前那批更可能还想要
    const next = [...queue, card].slice(-MAX_PENDING)
    await storage.setItem(PENDING_KEY, next)
    return next.length
  })
}

export async function clearPending(): Promise<void> {
  await mutate(() => storage.removeItem(PENDING_KEY))
}

/** 设置页按语境删除；未提供语境身份的旧调用保留按词删除的行为。 */
export function removePending(word: string, key?: string, recordId?: string): Promise<number> {
  return mutate(async () => {
    const target = word.trim().toLowerCase()
    const queue = await readPending()
    const next = queue.filter(c => recordId !== undefined
      ? c.recordId !== recordId
      : key !== undefined ? contextKey(c) !== key : c.entry.word.trim().toLowerCase() !== target)

    if (next.length === queue.length) return queue.length
    await storage.setItem(PENDING_KEY, next)
    return next.length
  })
}

/**
 * 逐条补写。
 *
 * 顺序写而不是并发：AnkiConnect 是单线程的，并发只会让它排队，
 * 却让"写到哪一条断的"变得难以判断。
 *
 * 三种结果分开处理：写成功和被拒绝（重复词）都要出队——重试永远不会成功；
 * 只有连不上才保留，那是下次还能成的。
 */
export async function flushPending(
  write: (card: CapturedCard) => Promise<unknown>,
  isRetryable: (err: unknown) => boolean,
): Promise<FlushResult> {
  const snapshot = await readPending()
  let written = 0
  let dropped = 0
  for (const card of snapshot) {
    try { await write(card); written++ }
    catch (err) {
      if (isRetryable(err)) break
      dropped++
    }
    await mutate(async () => {
      const current = await readPending()
      // 同步过程中若发生编辑，保留新版本等待下次同步。
      await storage.setItem(PENDING_KEY, current.filter(c => JSON.stringify(c) !== JSON.stringify(card)))
    })
  }
  return { written, dropped, remaining: await pendingCount() }
}
