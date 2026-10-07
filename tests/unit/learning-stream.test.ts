import { afterEach, describe, expect, it, vi } from 'vitest'
import { streamEntry } from '../../lib/ai'
import { DEFAULT_SETTINGS } from '../../lib/types'

afterEach(() => vi.unstubAllGlobals())
describe('real SDK generation path', () => {
  it('streams contextual output using the real SDK and records its generation version', async () => {
    const entry = { word: 'stride', reading: '', partOfSpeech: 'n.', definition: '从容面对',
      contextTranslation: '他坦然接受了她的批评。', inputKind: 'word', expression: 'take something in stride',
      keyExplanation: '这是固定表达，不能按步幅理解。', usageNote: '', example: '', exampleTranslation: '', memoryHook: '' }
    const json = JSON.stringify(entry)
    const chunks = [json.slice(0, json.indexOf('从容面对') + 2), json.slice(json.indexOf('从容面对') + 2)]
    const encode = (content: string) => 'data: ' + JSON.stringify({ id: 'demo', object: 'chat.completion.chunk', created: 1, model: 'test',
      choices: [{ index: 0, delta: { content }, finish_reason: null }] }) + '\n\n'
    const events = chunks.map(encode).join('') + 'data: ' + JSON.stringify({ id: 'demo', object: 'chat.completion.chunk', created: 1, model: 'test',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n'
    const fetch = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(events, { headers: { 'content-type': 'text/event-stream' } }))
    vi.stubGlobal('fetch', fetch)
    const partials: unknown[] = []
    const settings = structuredClone(DEFAULT_SETTINGS)
    settings.ai.profiles[0].apiKey = 'test'
    const result = await streamEntry({ selection: 'stride', sentence: 'He took her criticism in stride.', settings, onPartial: p => partials.push(p) })
    expect(result.expression).toBe('take something in stride')
    expect(result.generation?.promptVersion).toBe('learning-v1')
    expect(partials.length).toBeGreaterThan(0)
    const request = JSON.parse(fetch.mock.calls[0]?.[1]?.body as string ?? '{}')
    expect(request.messages.at(-1).content).toContain('stride')
  })
  it.each([
    { reason: 'stop', definition: '', label: 'empty definition' },
    { reason: 'length', definition: '河岸', label: 'truncated generation' },
  ])('rejects $label before returning a savable result', async ({ reason, definition }) => {
    const value = { word: 'bank', reading: '', partOfSpeech: 'n.', definition, contextTranslation: '河岸',
      inputKind: 'word', expression: 'bank', keyExplanation: '', usageNote: '', example: '', exampleTranslation: '', memoryHook: '' }
    const data = (content: string, finish_reason: string | null) => 'data: ' + JSON.stringify({
      id: 'demo', object: 'chat.completion.chunk', created: 1, model: 'test',
      choices: [{ index: 0, delta: { content }, finish_reason }] }) + '\n\n'
    vi.stubGlobal('fetch', vi.fn(async () => new Response(data(JSON.stringify(value), null) + data('', reason) + 'data: [DONE]\n\n',
      { headers: { 'content-type': 'text/event-stream' } })))
    const settings = structuredClone(DEFAULT_SETTINGS)
    settings.ai.profiles[0].apiKey = 'test'
    await expect(streamEntry({ selection: 'bank', sentence: 'We sat on the bank.', settings, onPartial: () => {} })).rejects.toThrow()
  })
  it('propagates cancellation to the network request', async () => {
    const controller = new AbortController()
    let requestSignal: AbortSignal | undefined
    let started!: () => void
    const begun = new Promise<void>(resolve => { started = resolve })
    vi.stubGlobal('fetch', vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      requestSignal = init?.signal ?? undefined
      requestSignal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
      started()
    })))
    const settings = structuredClone(DEFAULT_SETTINGS)
    settings.ai.profiles[0].apiKey = 'test'
    const pending = streamEntry({ selection: 'bank', sentence: 'We sat on the bank.', settings, onPartial: () => {}, signal: controller.signal })
    const rejected = expect(pending).rejects.toThrow()
    await begun
    controller.abort()
    await rejected
    expect(requestSignal?.aborted).toBe(true)
  })
})
