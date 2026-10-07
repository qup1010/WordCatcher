import { beforeEach, describe, expect, it } from 'vitest'
import { __resetStorage } from '../helpers/wxt-imports-stub'
import { readLearning, saveLearning, updateLearning, exportLearning, effectiveCard, markLearningSync } from '../../lib/learning'
import { enqueue, readPending } from '../../lib/pending'
import { buildNoteFields } from '../../lib/anki'
import { DEFAULT_SETTINGS, type CapturedCard } from '../../lib/types'

const card = (sentence = 'We sat on the bank.', definition = '河岸'): CapturedCard => ({
  entry: { word: 'bank', reading: '', partOfSpeech: 'n.', definition, contextTranslation: '我们坐在河岸边。',
    inputKind: 'word', expression: 'bank', keyExplanation: '这里描述地理位置。',
    generation: { model: 'test-model', promptVersion: 'learning-v1', generatedAt: '2026-10-07T00:00:00Z' } },
  selection: 'bank', sentence, sentenceOffset: sentence.indexOf('bank'),
  pageUrl: 'https://example.test', pageTitle: 'Example', createdAt: 1,
})
beforeEach(() => __resetStorage())
describe('context learning records', () => {
  it('retains capture facts on regeneration and ignores stale synchronization completion', async () => {
    const first = await saveLearning(card())
    const updated = await saveLearning({ ...card(undefined, '重新分析'), createdAt: 900, pageTitle: 'Changed', updateExisting: true })
    expect(updated.card.createdAt).toBe(1)
    expect(updated.card.pageTitle).toBe('Example')
    await markLearningSync(updated.id, undefined, first.revision)
    expect((await readLearning())[0].syncedAt).toBeUndefined()
    await markLearningSync(updated.id, undefined, updated.revision)
    expect((await readLearning())[0].syncedAt).toBeDefined()
  })
  it('keeps different senses and generated snapshots independently', async () => {
    const river = await saveLearning(card())
    await saveLearning(card('I went to the bank.', '银行'))
    expect(await readLearning()).toHaveLength(2)
    expect((await readLearning()).find(r => r.id === river.id)?.card.entry.definition).toBe('河岸')
    expect(JSON.parse(await exportLearning()).records).toHaveLength(2)
  })
  it('does not replace a saved context without explicit update', async () => {
    const first = await saveLearning(card())
    const again = await saveLearning(card(undefined, '新生成'))
    expect(again.id).toBe(first.id)
    expect(again.card.entry.definition).toBe('河岸')
    expect(await readLearning()).toHaveLength(1)
  })
  it('preserves user edits across regeneration while keeping the new original', async () => {
    const first = await saveLearning(card())
    await updateLearning(first.id, { definition: '我自己的解释', note: '个人笔记' })
    const updated = await saveLearning({ ...card(undefined, '新的原始分析'), updateExisting: true })
    expect(updated.id).toBe(first.id)
    expect(updated.card.entry.definition).toBe('新的原始分析')
    expect(effectiveCard(updated).entry.definition).toBe('我自己的解释')
    expect(updated.edits?.note).toBe('个人笔记')
    expect(await readLearning()).toHaveLength(1)
  })
  it('serializes simultaneous saves and does not mutate caller data', async () => {
    const original = card()
    await Promise.all([saveLearning(original), saveLearning(card('The bank approved it.', '银行'))])
    expect(await readLearning()).toHaveLength(2)
    expect(original.recordId).toBeUndefined()
  })
  it('queues separate contexts for the same word and uses context content in Anki', async () => {
    const river = await saveLearning(card())
    const money = await saveLearning(card('The bank approved it.', '银行'))
    await enqueue(effectiveCard(river)); await enqueue(effectiveCard(money))
    expect(await readPending()).toHaveLength(2)
    expect(buildNoteFields(effectiveCard(river), DEFAULT_SETTINGS).Definition).toBe('河岸')
    expect(buildNoteFields(effectiveCard(money), DEFAULT_SETTINGS).Definition).toBe('银行')
  })
  it('retains original selection for cloze even when the expression is expanded', async () => {
    const phrase = card('He took it in stride.', '从容面对')
    phrase.selection = 'stride'; phrase.sentenceOffset = phrase.sentence.indexOf('stride')
    phrase.entry.word = 'stride'; phrase.entry.expression = 'take something in stride'
    const saved = await saveLearning(phrase)
    const fields = buildNoteFields(effectiveCard(saved), DEFAULT_SETTINGS)
    expect(fields.Word).toBe('take something in stride')
    expect(fields.Sentence).toContain('He took it in ')
    expect(saved.card.selection).toBe('stride')
  })
  it('rejects empty definitions', async () => {
    await expect(saveLearning(card(undefined, ' '))).rejects.toThrow()
    await expect(saveLearning({ ...card(), edits: { definition: ' ' } })).rejects.toThrow()
    expect(await readLearning()).toEqual([])
  })
})
