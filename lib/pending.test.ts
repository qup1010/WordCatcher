import { beforeEach, describe, expect, it, vi } from 'vitest'
// 直接引 stub 文件而不是 '#imports'，理由见 settings.test.ts
import { __resetStorage } from '../test/wxt-imports-stub'
import { enqueue, flushPending, pendingCount, readPending, removePending } from './pending'
import type { CapturedCard } from './types'

function card(word: string): CapturedCard {
  return {
    entry: {
      word,
      reading: '',
      partOfSpeech: 'v.',
      definition: `${word} 的释义`,
      contextTranslation: '',
    },
    selection: word,
    sentence: `A sentence with ${word} in it.`,
    sentenceOffset: 16,
    pageUrl: 'https://example.com',
    pageTitle: 'Example',
    createdAt: 0,
  }
}

/** 连不上 Anki —— 下次还能成，该留在队列里 */
class Unreachable extends Error {}
/** 重复词 —— 重试多少次都不会成，该丢掉 */
class Rejected extends Error {}

const retryable = (err: unknown) => err instanceof Unreachable

beforeEach(() => __resetStorage())

describe('enqueue', () => {
  it('排队后能读回来', async () => {
    await enqueue(card('devastate'))
    expect(await pendingCount()).toBe(1)
    expect((await readPending())[0].entry.word).toBe('devastate')
  })

  it('同一个词重复排队没有意义，忽略掉', async () => {
    await enqueue(card('devastate'))
    await enqueue(card('Devastate')) // 大小写不同也算同一个
    expect(await pendingCount()).toBe(1)
  })

  it('超过上限时丢最老的，保留最近划到的', async () => {
    for (let i = 0; i < 210; i++) await enqueue(card(`w${i}`))

    const queue = await readPending()
    expect(queue).toHaveLength(200)
    expect(queue[0].entry.word).toBe('w10')
    expect(queue.at(-1)?.entry.word).toBe('w209')
  })
})

describe('removePending', () => {
  it('按词删掉一条，返回剩余条数', async () => {
    for (const w of ['a', 'b', 'c']) await enqueue(card(w))

    expect(await removePending('b')).toBe(2)
    expect((await readPending()).map(c => c.entry.word)).toEqual(['a', 'c'])
  })

  it('大小写不敏感，和入队去重的口径一致', async () => {
    await enqueue(card('Devastate'))
    expect(await removePending('devastate')).toBe(0)
  })

  it('删不存在的词是空操作，不报错也不动队列', async () => {
    await enqueue(card('a'))
    expect(await removePending('zzz')).toBe(1)
    expect(await pendingCount()).toBe(1)
  })
})

describe('flushPending', () => {
  it('全部写成功后清空队列', async () => {
    await enqueue(card('a'))
    await enqueue(card('b'))

    const write = vi.fn().mockResolvedValue(1)
    const res = await flushPending(write, retryable)

    expect(res).toEqual({ written: 2, dropped: 0, remaining: 0 })
    expect(await pendingCount()).toBe(0)
  })

  it('被拒绝的（重复词）直接出队，不会永远堵在队首', async () => {
    await enqueue(card('dup'))
    await enqueue(card('ok'))

    const write = vi.fn(async (c: CapturedCard) => {
      if (c.entry.word === 'dup') throw new Rejected('duplicate')
      return 1
    })
    const res = await flushPending(write, retryable)

    expect(res).toEqual({ written: 1, dropped: 1, remaining: 0 })
    expect(await pendingCount()).toBe(0)
  })

  /**
   * 补写到一半 Anki 又断了：已写的不能重复写（会被判重复），
   * 没写的一条都不能丢——这正是队列存在的意义。
   */
  it('中途断连时保留剩余部分，已写的不再重试', async () => {
    for (const w of ['a', 'b', 'c']) await enqueue(card(w))

    const write = vi.fn(async (c: CapturedCard) => {
      if (c.entry.word === 'b') throw new Unreachable('anki gone')
      return 1
    })
    const res = await flushPending(write, retryable)

    expect(res).toEqual({ written: 1, dropped: 0, remaining: 2 })
    expect((await readPending()).map(c => c.entry.word)).toEqual(['b', 'c'])
  })

  it('空队列不调用写入', async () => {
    const write = vi.fn()
    expect(await flushPending(write, retryable))
      .toEqual({ written: 0, dropped: 0, remaining: 0 })
    expect(write).not.toHaveBeenCalled()
  })
})
