import { describe, expect, it } from 'vitest'
import { formatQuickDictResult } from '../../../lib/open-dict/db'
import type { DictMeaning, OpenDictEntry } from '../../../lib/open-dict/types'

const meaning = (sense_id: string, short_gloss: string, priority = 'common'): DictMeaning => ({ sense_id, short_gloss, priority })

describe('offline dictionary presentation', () => {
  it('keeps ordinary groups first, stable sense priorities, full details and matching save summaries', () => {
    const entry: OpenDictEntry = {
      headword: 'agent',
      pos_groups: [
        { pos: 'name', meanings: [meaning('name', '姓氏', 'core')] },
        { pos: 'noun', meanings: [
          meaning('rare', '少见义', 'rare'), meaning('common', '常用义'),
          meaning('core1', '代理人', 'core'), meaning('core2', '作用者', 'core'),
          meaning('duplicate', '代理人', 'core'), meaning('extra', '其他常用义'),
        ] },
        { pos: 'noun', proper_name: true, meanings: [meaning('proper', '专名', 'core')] },
        { pos: 'verb', meanings: [meaning('verb', '动词义', 'rare')] },
        { pos: 'adjective', summary: '形容词摘要', meanings: [] },
        { pos: 'adverb', meanings: [meaning('adverb', '副词义')] },
      ],
    }
    const before = structuredClone(entry)
    const result = formatQuickDictResult(entry)
    expect(result.allPosGroups.map(g => g.pos)).toEqual(['noun', 'verb', 'adjective', 'adverb', 'name', 'noun'])
    expect(result.primaryPos).toBe('n.')
    expect(result.allPosGroups[0].meanings.map(m => m.sense_id)).toEqual(['core1', 'core2', 'duplicate', 'common', 'extra', 'rare'])
    expect(result.coreGroups[0].meanings).toEqual(['代理人', '作用者', '常用义'])
    expect(result.coreGroups).toHaveLength(6)
    expect(result.coreMeanings).toEqual(['n. 代理人', 'n. 作用者', 'n. 常用义', 'v. 动词义', 'adj. 形容词摘要', 'adv. 副词义', 'name. 姓氏', 'n. 专名'])
    expect(result.coreMeanings).toEqual(result.coreGroups.flatMap(g => g.meanings.map(m => `${g.pos} ${m}`)))
    expect(entry).toEqual(before)
  })

  it('uses readable rare meanings when usual senses are empty', () => {
    const result = formatQuickDictResult({ headword: 'word', pos_groups: [{ pos: 'noun', meanings: [
      meaning('empty', ' '), { ...meaning('rare', '', 'rare'), learner_explanation: '可读的少见义' },
    ] }] })
    expect(result.coreMeanings).toEqual(['n. 可读的少见义'])
    expect(result.allPosGroups[0].meanings).toHaveLength(2)
  })

  it('normalizes priority labels and recognizes proper noun labels without flags', () => {
    const result = formatQuickDictResult({ headword: 'word', pos_groups: [
      { pos: 'Proper Noun.', meanings: [meaning('name', '专名')] },
      { pos: 'verb', meanings: [meaning('rare', '少见', ' RARE '), meaning('common', '常用', 'unknown'), meaning('core', '核心', ' CORE ')] },
    ] })
    expect(result.coreGroups[0]).toEqual({ pos: 'v.', meanings: ['核心', '常用'] })
    expect(result.allPosGroups[0].meanings.map(m => m.sense_id)).toEqual(['core', 'common', 'rare'])
  })
})
