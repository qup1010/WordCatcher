import { beforeEach, describe, expect, it } from 'vitest'
import { __resetStorage } from '../test/wxt-imports-stub'
import { addHistory, clearHistory, markHistorySaved, readHistory, removeHistory } from './history'

beforeEach(() => __resetStorage())

describe('history module', () => {
  it('adds history item and puts it at front', async () => {
    await addHistory({
      word: 'devastate',
      definition: '彻底摧毁',
      source: 'dict',
    })

    const list = await readHistory()
    expect(list).toHaveLength(1)
    expect(list[0].word).toBe('devastate')
    expect(list[0].definition).toBe('彻底摧毁')
    expect(list[0].source).toBe('dict')
    expect(list[0].savedToAnki).toBe(false)
  })

  it('updates existing word and brings it to front without duplicate', async () => {
    await addHistory({ word: 'apple', definition: '苹果 1', source: 'dict' })
    await addHistory({ word: 'banana', definition: '香蕉', source: 'dict' })
    await addHistory({ word: 'Apple', definition: '苹果 2', source: 'ai' })

    const list = await readHistory()
    expect(list).toHaveLength(2)
    expect(list[0].word).toBe('Apple')
    expect(list[0].definition).toBe('苹果 2')
    expect(list[0].source).toBe('ai')
    expect(list[1].word).toBe('banana')
  })

  it('caps history at maximum limit', async () => {
    for (let i = 0; i < 110; i++) {
      await addHistory({ word: `word-${i}`, definition: `def-${i}`, source: 'dict' })
    }

    const list = await readHistory()
    expect(list).toHaveLength(100)
    expect(list[0].word).toBe('word-109')
    expect(list.at(-1)?.word).toBe('word-10')
  })

  it('removes item by id', async () => {
    await addHistory({ id: 'item-1', word: 'apple', definition: '苹果', source: 'dict' })
    await addHistory({ id: 'item-2', word: 'banana', definition: '香蕉', source: 'dict' })

    const updated = await removeHistory('item-1')
    expect(updated).toHaveLength(1)
    expect(updated[0].id).toBe('item-2')
  })

  it('clears all history', async () => {
    await addHistory({ word: 'apple', definition: '苹果', source: 'dict' })
    await clearHistory()
    expect(await readHistory()).toEqual([])
  })

  it('marks word as savedToAnki', async () => {
    await addHistory({ word: 'devastate', definition: '摧毁', source: 'dict' })
    expect((await readHistory())[0].savedToAnki).toBe(false)

    await markHistorySaved('Devastate')
    expect((await readHistory())[0].savedToAnki).toBe(true)
  })
})
