import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, type WordEntry } from '../../lib/types'
import { __resetStorage } from '../helpers/wxt-imports-stub'
import { readLearning } from '../../lib/learning'
import { readPending } from '../../lib/pending'
import { readHistory } from '../../lib/history'
import { clearCache } from '../../lib/entry-cache'
import { ENTRY_STREAM_PORT } from '../../lib/messaging'
import startBackground from '../../entrypoints/background'

const mock = vi.hoisted(() => ({
  message: null as ((req: unknown, sender: unknown, reply: (value: unknown) => void) => boolean) | null,
  connect: null as ((port: unknown) => void) | null,
  stream: vi.fn(), addNote: vi.fn(),
}))
vi.mock('#imports', async () => {
  const actual = await import('../helpers/wxt-imports-stub')
  return { ...actual, browser: { ...actual.browser, runtime: { ...actual.browser.runtime,
    onMessage: { addListener: (fn: typeof mock.message) => { mock.message = fn } },
    onConnect: { addListener: (fn: typeof mock.connect) => { mock.connect = fn } },
  } } }
})
vi.mock('../../lib/settings', () => ({
  getSettings: async () => ({ ...DEFAULT_SETTINGS, dict: { ...DEFAULT_SETTINGS.dict, enabled: false } }),
  isAiConfigured: () => true,
  activeAiProfile: () => DEFAULT_SETTINGS.ai.profiles[0],
}))
vi.mock('../../lib/ai', async importOriginal => ({ ...await importOriginal<object>(), streamEntry: mock.stream }))
vi.mock('../../lib/anki', async importOriginal => ({ ...await importOriginal<object>(), addNote: mock.addNote }))

const entry: WordEntry = { word: 'bank', reading: '', partOfSpeech: 'n.', definition: '河岸', contextTranslation: '我们坐在河岸边。',
  inputKind: 'word', expression: 'bank', generation: { model: 'test', promptVersion: 'learning-v1', generatedAt: '2026-10-07T00:00:00Z' } }
const context = { selection: 'bank', sentence: 'We sat on the bank.', sentenceOffset: 14, pageUrl: 'https://example.test', pageTitle: 'Example' }
function request(req: unknown): Promise<any> {
  return new Promise(resolve => { expect(mock.message!(req, {}, resolve)).toBe(true) })
}
function port() {
  let receive!: (req: unknown) => void
  let disconnect!: () => void
  const value = { name: ENTRY_STREAM_PORT,
    onMessage: { addListener: (fn: typeof receive) => { receive = fn } },
    onDisconnect: { addListener: (fn: typeof disconnect) => { disconnect = fn } },
    postMessage: vi.fn(), disconnect: vi.fn(() => disconnect()),
  }
  mock.connect!(value)
  return { value, start: (req: unknown = context) => receive(req), cancel: () => disconnect() }
}
beforeEach(() => {
  __resetStorage(); clearCache(); mock.stream.mockReset(); mock.addNote.mockReset()
  mock.stream.mockResolvedValue(structuredClone(entry)); mock.addNote.mockResolvedValue(12)
  ;(startBackground as unknown as () => void)()
})
describe('learning background entry points', () => {
  it('saves locally and queues the same context when Anki is offline', async () => {
    mock.addNote.mockRejectedValue(new Error('Anki 未连接'))
    const reply = await request({ type: 'save-card', payload: { ...context, entry, createdAt: 1, edits: { definition: '我的河岸释义', note: '个人笔记' } } })
    expect(reply).toMatchObject({ ok: true, data: { queued: true, syncError: 'Anki 未连接' } })
    const records = await readLearning()
    expect(records).toHaveLength(1)
    expect(records[0].card.entry.definition).toBe('河岸')
    expect(records[0].edits?.definition).toBe('我的河岸释义')
    const queued = await readPending()
    expect(queued[0].recordId).toBe(records[0].id)
    expect(queued[0].entry.definition).toBe('我的河岸释义')
    expect((await request({ type: 'library-list' })).data[0].id).toBe(records[0].id)
  })
  it('disconnect cancels generation and a late result cannot enter history or cache', async () => {
    let finish!: (value: WordEntry) => void
    mock.stream.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const first = port(); first.start()
    await vi.waitFor(() => expect(mock.stream).toHaveBeenCalledTimes(1))
    const signal = mock.stream.mock.calls[0][0].signal as AbortSignal
    first.cancel(); expect(signal.aborted).toBe(true)
    finish(entry)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(first.value.postMessage).not.toHaveBeenCalled()
    expect(await readHistory()).toEqual([])
    mock.stream.mockResolvedValue(entry)
    const next = port(); next.start()
    await vi.waitFor(() => expect(next.value.postMessage).toHaveBeenCalledWith({ type: 'done', entry }))
    expect(mock.stream).toHaveBeenCalledTimes(2)
  })
  it('uses cache for repeated context and bypasses it for explicit regeneration', async () => {
    const first = port(); first.start()
    await vi.waitFor(() => expect(first.value.postMessage).toHaveBeenCalledWith({ type: 'done', entry }))
    const repeated = port(); repeated.start()
    await vi.waitFor(() => expect(repeated.value.postMessage).toHaveBeenCalledWith({ type: 'done', entry }))
    expect(mock.stream).toHaveBeenCalledTimes(1)
    const fresh = port(); fresh.start({ ...context, bypassCache: true })
    await vi.waitFor(() => expect(fresh.value.postMessage).toHaveBeenCalledWith({ type: 'done', entry }))
    expect(mock.stream).toHaveBeenCalledTimes(2)
    expect(await readLearning()).toEqual([])
  })
  it('failed generation reports an error without persisting partial history', async () => {
    mock.stream.mockImplementation(async ({ onPartial }) => { onPartial({ definition: '未完成' }); throw new Error('生成中断') })
    const current = port(); current.start()
    await vi.waitFor(() => expect(current.value.postMessage).toHaveBeenCalledWith({ type: 'error', message: '生成中断' }))
    expect(await readHistory()).toEqual([])
    expect(await readLearning()).toEqual([])
  })
})
