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

/** 入队。同一个词重复排队没有意义，按词形去重 */
export async function enqueue(card: CapturedCard): Promise<number> {
  const queue = await readPending()
  const word = card.entry.word.trim().toLowerCase()

  if (queue.some(c => c.entry.word.trim().toLowerCase() === word)) {
    return queue.length
  }

  // 超上限时丢最老的：新划到的词比几天前那批更可能还想要
  const next = [...queue, card].slice(-MAX_PENDING)
  await storage.setItem(PENDING_KEY, next)
  return next.length
}

export async function clearPending(): Promise<void> {
  await storage.removeItem(PENDING_KEY)
}

/**
 * 按词删掉一条。
 *
 * 用词而不是下标定位：设置页上看到的列表和 storage 里的顺序之间隔着一次
 * 异步读取，中间可能又排进来一条新的，按下标删会删错人。
 * enqueue 本来就按词去重，所以词在队列里是唯一的。
 */
export async function removePending(word: string): Promise<number> {
  const target = word.trim().toLowerCase()
  const queue = await readPending()
  const next = queue.filter(c => c.entry.word.trim().toLowerCase() !== target)

  if (next.length === queue.length) return queue.length
  await storage.setItem(PENDING_KEY, next)
  return next.length
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
  const queue = await readPending()
  let written = 0
  let dropped = 0

  for (let i = 0; i < queue.length; i++) {
    try {
      await write(queue[i])
      written++
    } catch (err) {
      if (isRetryable(err)) {
        // Anki 又断了，剩下的（含当前这条）原样留到下次
        const rest = queue.slice(i)
        await storage.setItem(PENDING_KEY, rest)
        return { written, dropped, remaining: rest.length }
      }
      dropped++
    }
  }

  await clearPending()
  return { written, dropped, remaining: 0 }
}
