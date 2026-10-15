import { beforeEach, describe, expect, it } from 'vitest'
import { __resetStorage } from '../helpers/wxt-imports-stub'
import { addHistory, clearHistory, importHistoryItems, markHistorySaved, readHistory, removeHistory } from '../../lib/history'

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

  it('updates existing word, preserves context metadata, and brings it to front without duplicate', async () => {
    await addHistory({
      word: 'apple',
      selection: 'apples',
      partOfSpeech: 'n.',
      definition: '苹果 1',
      sentence: 'I ate two apples.',
      sentenceOffset: 10,
      pageUrl: 'https://example.com',
      pageTitle: 'Example',
      source: 'dict',
    })
    await addHistory({ word: 'banana', definition: '香蕉', source: 'dict' })
    await addHistory({ word: 'Apple', definition: '苹果 2', contextTranslation: '我吃了两个苹果。', source: 'ai' })

    const list = await readHistory()
    expect(list).toHaveLength(2)
    expect(list[0].word).toBe('Apple')
    expect(list[0].definition).toBe('苹果 2')
    expect(list[0].partOfSpeech).toBe('n.')
    expect(list[0].sentence).toBe('I ate two apples.')
    expect(list[0].sentenceOffset).toBe(10)
    expect(list[0].contextTranslation).toBe('我吃了两个苹果。')
    expect(list[0].pageUrl).toBe('https://example.com')
    expect(list[0].source).toBe('ai')
    expect(list[1].word).toBe('banana')
  })

  it('imports history items and deduplicates by word', async () => {
    await addHistory({ word: 'apple', definition: '旧释义', timestamp: 100, source: 'dict' })
    const merged = await importHistoryItems([
      { id: '1', word: 'apple', definition: '新释义', timestamp: 200, source: 'ai', savedToAnki: true },
      { id: '2', word: 'pear', definition: '梨', timestamp: 150, source: 'dict' },
    ])
    expect(merged).toHaveLength(2)
    expect(merged[0].word).toBe('apple')
    expect(merged[0].definition).toBe('新释义')
    expect(merged[0].savedToAnki).toBe(true)
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
