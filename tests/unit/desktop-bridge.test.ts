import { afterEach, describe, expect, it, vi } from 'vitest'
import { syncCardToDesktop } from '../../lib/desktop-bridge'
import { DEFAULT_SETTINGS, type CapturedCard } from '../../lib/types'

afterEach(() => vi.unstubAllGlobals())

describe('desktop bridge protocol', () => {
  it('preserves source metadata, analysis, generation and edits for desktop import', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const card: CapturedCard = {
      entry: { word: 'bank', reading: '', partOfSpeech: 'n.', definition: '河岸', contextTranslation: '河边。',
        inputKind: 'word', expression: 'bank', keyExplanation: '地理位置',
        generation: { model: 'test', promptVersion: 'learning-v1', generatedAt: '2026-10-15T00:00:00Z' } },
      selection: 'bank', sentence: 'We sat on the bank.', sentenceOffset: 14,
      pageUrl: 'https://example.test/book', pageTitle: 'Book', createdAt: 1,
      edits: { definition: '我的释义', note: '笔记' }, updateExisting: true, recordId: 'shared-context-id',
    }
    expect(await syncCardToDesktop(card, DEFAULT_SETTINGS)).toBe(true)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:18765/api/v1/words')
    expect(JSON.parse(init.body as string)).toMatchObject({
      sourceUri: card.pageUrl, sourceTitle: 'Book', sentenceOffset: 14, createdAt: 1,
      analysis: { inputKind: 'word', expression: 'bank', keyExplanation: '地理位置' },
      generation: { model: 'test', generatedAtUtc: '2026-10-15T00:00:00Z' },
      edits: card.edits, updateExisting: true, recordId: 'shared-context-id',
    })
  })
})
