import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '../../lib/types'
import SidePanel from '../../entrypoints/sidepanel/App'
import Popup from '../../entrypoints/popup/App'
const mock = vi.hoisted(() => ({ send: vi.fn(), stream: vi.fn(), cancel: vi.fn() }))
vi.mock('../../lib/messaging', () => ({ sendMessage: mock.send, openEntryStream: mock.stream }))
vi.mock('../../lib/settings', () => ({ getSettings: async () => structuredClone(DEFAULT_SETTINGS), watchSettings: () => () => {}, saveSettings: vi.fn(), isAiConfigured: () => false, activeAiProfile: () => DEFAULT_SETTINGS.ai.profiles[0] }))
vi.mock('../../lib/tts', () => ({ isTtsSupported: () => false, speak: vi.fn() }))
vi.mock('#imports', () => ({ browser: { runtime: { onMessage: { addListener: vi.fn(), removeListener: vi.fn() }, openOptionsPage: vi.fn() } } }))
let root: Root
let host: HTMLDivElement
const item = { id: 'history', word: 'remember', definition: '记得', sentence: 'Please remember this.', timestamp: Date.now(), savedToAnki: false }
const entry = { word: 'remember', reading: '', partOfSpeech: '', definition: '记得', contextTranslation: '' }
async function mount(component: typeof SidePanel) {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => { root.render(createElement(component)) })
}
async function click(text: string) {
  const button = Array.from(host.querySelectorAll<HTMLElement>('button,[role="button"]')).find(el => el.textContent?.trim() === text)
  expect(button, text).toBeDefined()
  await act(async () => { button!.click() })
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  mock.send.mockReset(); mock.stream.mockReset(); mock.cancel.mockReset()
  mock.send.mockImplementation(async (req: { type: string }) => {
    if (req.type === 'history-list') return { ok: true, data: [item] }
    if (req.type === 'quick-translate') return { ok: true, data: { mode: 'mt', translation: '新结果' } }
    return { ok: false, error: '示例失败' }
  })
  mock.stream.mockReturnValue(mock.cancel)
})
afterEach(async () => { if (root) await act(async () => root.unmount()); document.body.replaceChildren() })
describe('sidepanel transitions', () => {
  it('keeps a selected history item when an earlier lookup finishes', async () => {
    let finish!: (value: unknown) => void
    mock.send.mockImplementation((req: { type: string }) => req.type === 'quick-translate'
      ? new Promise(resolve => { finish = resolve }) : Promise.resolve({ ok: true, data: [item] }))
    await mount(SidePanel)
    await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    // 使用原生输入框 setter，模拟真实输入事件。
    const input = host.querySelector('input')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'old')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    await click('查词历史 (1)')
    await act(async () => { host.querySelector<HTMLElement>('.sp-history-item')!.click() })
    await act(async () => { finish({ ok: true, data: { mode: 'mt', translation: '迟到的错误内容' } }) })
    expect(host.querySelector('.sp-card-word')?.textContent).toBe('remember')
    expect(host.textContent).not.toContain('迟到的错误内容')
  })
  it('disables saving partial AI results and cancels streaming when history is selected', async () => {
    await mount(SidePanel); await click('查词历史 (1)')
    await act(async () => { host.querySelector<HTMLElement>('.sp-history-item')!.click() })
    await click('AI 释义')
    const handlers = mock.stream.mock.calls[0][1]
    await act(async () => handlers.onPartial({ ...entry, definition: '半成品' }))
    expect(host.querySelector<HTMLButtonElement>('.sp-btn-save')!.disabled).toBe(true)
    await click('查词历史 (1)')
    await act(async () => { host.querySelector<HTMLElement>('.sp-history-item')!.click() })
    expect(mock.cancel).toHaveBeenCalled()
    await act(async () => handlers.onDone({ ...entry, word: 'late', definition: '迟到的结果' }))
    expect(host.querySelector('.sp-card-word')?.textContent).toBe('remember')
  })
  it('does not apply an old save result to a newly selected item', async () => {
    let finish!: (value: unknown) => void
    mock.send.mockImplementation((req: { type: string }) => req.type === 'save-card'
      ? new Promise(resolve => { finish = resolve }) : Promise.resolve({ ok: true, data: [item] }))
    await mount(SidePanel); await click('查词历史 (1)')
    await act(async () => { host.querySelector<HTMLElement>('.sp-history-item')!.click() })
    await click('存入 Anki'); await click('查词历史 (1)')
    await act(async () => { host.querySelector<HTMLElement>('.sp-history-item')!.click() })
    await act(async () => { finish({ ok: true, data: { queued: true } }) })
    expect(host.querySelector('.sp-btn-save')?.textContent).toBe('存入 Anki')
  })
})
it.each([SidePanel, Popup])('shows history load failures instead of an empty-history guide', async Component => {
  mock.send.mockResolvedValue({ ok: false, error: '记录暂时无法读取' })
  await mount(Component); await click('查词历史 (0)')
  expect(host.textContent).toContain('记录暂时无法读取')
  expect(host.textContent).not.toContain('还没有查词记录')
  mock.send.mockResolvedValue({ ok: true, data: [item] })
  await click(Component === Popup ? '重新加载' : '重试')
  expect(host.textContent).toContain('remember')
})
