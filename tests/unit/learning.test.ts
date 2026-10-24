import { beforeEach, describe, expect, it } from 'vitest'
import { __resetStorage } from '../helpers/wxt-imports-stub'
import {
  readLearning,
  readTombstones,
  saveLearning,
  saveLearningWithReceipt,
  updateLearning,
  removeLearning,
  importLearning,
  exportLearning,
  exportSyncLearning,
  mergeLearningRecords,
  effectiveCard,
  markLearningSync,
} from '../../lib/learning'
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
  it('imports Windows desktop exported JSON format with Occurrences and Edits', async () => {
    const desktopJson = JSON.stringify([
      {
        Id: 'word-1',
        NormalizedWord: 'serendipity',
        DisplayWord: 'serendipity',
        Reading: '/ˌserənˈdɪpəti/',
        PartOfSpeech: 'n.',
        Definition: '意外发现珍奇事物的本领',
        MemoryHook: 'serendip + ity',
        Occurrences: [
          {
            Id: 'occ-1',
            WordId: 'word-1',
            SelectedText: 'serendipity',
            Sentence: 'It was pure serendipity.',
            SelectionOffset: 12,
            ContextTranslation: '这完全是机缘巧合。',
            SourceProcess: 'reader.exe',
            SourceWindowTitle: 'Book',
            SourceUri: 'https://example.com/1',
            CapturedAtUtc: '2026-10-15T10:00:00Z',
            LearningResult: {
              Word: 'serendipity',
              Reading: '/ˌserənˈdɪpəti/',
              PartOfSpeech: 'n.',
              Definition: '机缘巧合',
              ContextTranslation: '这完全是机缘巧合。',
              Analysis: {
                InputKind: 'word',
                Expression: 'serendipity',
                KeyExplanation: '指偶遇美好事物的运气。',
                UsageNote: '常与 pure 搭配',
                Example: 'Finding that café was pure serendipity.',
                ExampleTranslation: '找到那家咖啡馆纯属意外之喜。',
              },
            },
            Edits: {
              Definition: '我的自定义释义',
              ContextTranslation: '我的自定义译文',
              Note: '重点词汇',
            },
          },
        ],
      },
    ])

    const added = await importLearning(desktopJson)
    expect(added).toBe(1)
    const list = await readLearning()
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe('occ-1')
    expect(list[0].card.entry.word).toBe('serendipity')
    expect(list[0].card.entry.keyExplanation).toBe('指偶遇美好事物的运气。')
    expect(list[0].edits?.definition).toBe('我的自定义释义')
    expect(list[0].edits?.note).toBe('重点词汇')
  })
  it('records soft-delete tombstones and merges causally newer remote edits', async () => {
    const river = await saveLearning(card('We sat on the bank.', '河岸'))
    const money = await saveLearning(card('I went to the bank.', '银行'))

    await removeLearning(river.id)
    expect(await readLearning()).toHaveLength(1)
    expect(await readTombstones()).toHaveLength(1)

    const syncPayload = JSON.parse(await exportSyncLearning())
    expect(syncPayload.records).toHaveLength(2)

    // 模拟远端把 money 更新为 revision 5，并新增一条 bridge 语境，同时携带旧版未删除的 river (revision 1)
    const remotePayload = JSON.stringify({
      format: 'word-catcher-learning',
      version: 3,
      exportedAt: new Date().toISOString(),
      records: [
        {
          ...river,
          revision: 1,
          updatedAt: river.savedAt,
        },
        {
          ...money,
          revision: 5,
          versionVector: { ...money.versionVector, 'fixture-remote': 1 },
          updatedAt: Date.now() + 5000,
          edits: { definition: '远端修改后的银行释义', note: '多端同步笔记' },
        },
        {
          id: 'remote-new-1',
          revision: 1,
          versionVector: { 'fixture-remote': 1 },
          savedAt: Date.now() + 1000,
          updatedAt: Date.now() + 1000,
          card: card('They crossed the bridge.', '桥'),
        },
      ],
    })

    const merged = await mergeLearningRecords(remotePayload)
    expect(merged.added).toBe(1)
    expect(merged.updated).toBe(1)
    expect(merged.removed).toBe(0)
    expect(merged.total).toBe(2)

    const finalRecords = await readLearning()
    expect(finalRecords.some(r => r.id === river.id)).toBe(false)
    expect(finalRecords.find(r => r.id === money.id)?.edits?.note).toBe('多端同步笔记')
    expect(finalRecords.some(r => r.id === 'remote-new-1')).toBe(true)
  })
})

 it('issues undo receipts only for newly created contexts and preserves other contexts', async () => {
   const first = await saveLearningWithReceipt(card())
   expect(first.created).toBe(true)
   expect((await saveLearningWithReceipt(card())).created).toBe(false)
   const second = await saveLearningWithReceipt(card('I went to the bank.', '银行'))
   await removeLearning(second.record.id, 1)
   expect((await readLearning()).map(r => r.id)).toEqual([first.record.id])
   expect((await readTombstones())[0].id).toBe(second.record.id)
 })
 it('refuses undo after a later edit', async () => {
   const { record } = await saveLearningWithReceipt(card())
   await updateLearning(record.id, { definition: '编辑后的释义' })
   await expect(removeLearning(record.id, 1)).rejects.toThrow('后续修改')
   expect((await readLearning())[0].edits?.definition).toBe('编辑后的释义')
 })
