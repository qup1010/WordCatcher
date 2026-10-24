import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AiSection } from '../../entrypoints/options/sections/AiSection'
import { AnkiSection } from '../../entrypoints/options/sections/AnkiSection'
import { DataSection } from '../../entrypoints/options/sections/DataSection'
import { DEFAULT_SETTINGS, type CapturedCard } from '../../lib/types'

const mock = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('../../lib/messaging', () => ({ sendMessage: mock.send }))
vi.mock('../../lib/learning', () => ({ contextKey: () => 'example-context' }))

const card: CapturedCard = {
  entry: { word: 'example', reading: '', partOfSpeech: 'n.', definition: '例子', contextTranslation: '' },
  selection: 'example', sentence: 'An example.', sentenceOffset: 3,
  pageUrl: 'https://example.test', pageTitle: '示例', createdAt: 1, recordId: 'example-record',
}
let host: HTMLDivElement
let root: Root | undefined

function Harness({ section }: { section: 'ai' | 'anki' | 'data' }) {
  const [s, onChange] = useState(() => {
    const initial = structuredClone(DEFAULT_SETTINGS)
    initial.anki.enabled = true
    initial.ai.profiles[0].apiKey = 'test-only'
    return initial
  })
  const props = { s, onChange, flush: async () => {}, connectionsDirty: true }
  if (section === 'ai') return createElement(AiSection, props)
  if (section === 'anki') return createElement(AnkiSection, { ...props, onAliveChange: () => {} })
  return createElement(DataSection, props)
}
async function mount(section: 'ai' | 'anki' | 'data') {
  host = document.createElement('div'); document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(createElement(Harness, { section })))
}
async function click(text: string) {
  const button = Array.from(host.querySelectorAll('button')).find(item => item.textContent === text)
  expect(button).toBeDefined()
  await act(async () => button!.click())
}
async function change(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  mock.send.mockReset()
  mock.send.mockImplementation(async (request) => {
    if (request.type === 'pending-list') return { ok: true, data: { cards: [card] } }
    if (request.type === 'library-list') return { ok: true, data: [] }
    if (request.type === 'cache-stats') return { ok: true, data: { size: 1 } }
    if (request.type === 'webdav-status') return { ok: true, data: {} }
    return { ok: true, data: null }
  })
})
afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  root = undefined
  document.body.replaceChildren()
})

it('discards an AI test response after its configuration changes', async () => {
  let finish!: (value: unknown) => void
  mock.send.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  await mount('ai')
  await click('测试 AI 详解')
  await change(host.querySelector<HTMLInputElement>('[aria-label="API Key"]')!, 'changed-test-key')
  await act(async () => finish({ ok: true, data: { sample: null, reply: 'old configuration response', structuredError: 'old error' } }))
  expect(host.textContent).not.toContain('old configuration response')
  expect(host.querySelector('.result')).toBeNull()
})

it('clears only the Anki queue after explicit confirmation and supports cancelling', async () => {
  await mount('anki')
  await click('清空待同步队列')
  expect(mock.send.mock.calls.some(([request]) => request.type === 'clear-pending')).toBe(false)
  await click('取消')
  expect(host.textContent).toContain('example')
  await click('清空待同步队列')
  await click('确认清空队列')
  expect(mock.send.mock.calls.filter(([request]) => request.type === 'clear-pending')).toHaveLength(1)
  expect(mock.send.mock.calls.some(([request]) => request.type.startsWith('library-'))).toBe(false)
})

it('discards an Anki connection test response after the address changes', async () => {
  let finish!: (value: unknown) => void
  const initialImplementation = mock.send.getMockImplementation()!
  mock.send.mockImplementation(request => request.type === 'check-anki'
    ? new Promise(resolve => { finish = resolve }) : initialImplementation(request))
  await mount('anki')
  await click('测试 Anki 连接')
  await change(host.querySelector<HTMLInputElement>('label.field input')!, 'http://127.0.0.1:8766')
  await act(async () => finish({ ok: true, data: { version: 6 } }))
  expect(host.querySelector('p.ok')).toBeNull()
})

it('shows a failed cache-clear result instead of reporting success or staying silent', async () => {
  const initialImplementation = mock.send.getMockImplementation()!
  mock.send.mockImplementation(request => request.type === 'clear-cache'
    ? Promise.resolve({ ok: false, error: '后台暂未响应' }) : initialImplementation(request))
  await mount('data')
  await click('清空 AI 缓存')
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('后台暂未响应')
  expect(host.querySelector('.block:last-child .chip')?.textContent).toBe('1 条')
})
