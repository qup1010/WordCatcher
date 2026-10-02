import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, type Settings } from './types'
import App from '../entrypoints/options/App'
const mock = vi.hoisted(() => ({ save: vi.fn(), get: vi.fn() }))
vi.mock('./settings', () => ({ getSettings: mock.get, saveSettings: mock.save, isAiConfigured: () => false }))
vi.mock('./messaging', () => ({ sendMessage: async () => ({ ok: false, error: 'stub' }) }))
vi.mock('#imports', () => ({ browser: { runtime: { getManifest: () => ({ version: '0.1.4' }) } } }))
vi.mock('../entrypoints/options/sections/AiSection', () => ({ AiSection: ({ s, onChange }: { s: Settings, onChange: (s: Settings) => void }) => createElement('input', {
  'aria-label': '测试牌组', value: s.anki.deckName,
  onChange: (event: { target: { value: string } }) => onChange({ ...s, anki: { ...s.anki, deckName: event.target.value } }),
}) }))
vi.mock('../entrypoints/options/sections/AnkiSection', () => ({ AnkiSection: () => null }))
vi.mock('../entrypoints/options/sections/MtSection', () => ({ MtSection: () => null }))
vi.mock('../entrypoints/options/sections/DictSection', () => ({ DictSection: () => null }))
vi.mock('../entrypoints/options/sections/UxSection', () => ({ UxSection: () => null }))
vi.mock('../entrypoints/options/sections/DataSection', () => ({ DataSection: () => null }))
vi.mock('../entrypoints/options/sections/AboutSection', () => ({ AboutSection: () => null }))
let root: Root
let host: HTMLDivElement
async function mount() {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root.render(createElement(App)))
}
async function change(value: string) {
  const input = host.querySelector('input')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, IntersectionObserver: class { observe() {} disconnect() {} } })
  mock.save.mockReset(); mock.get.mockReset()
  mock.get.mockResolvedValue(structuredClone(DEFAULT_SETTINGS)); mock.save.mockResolvedValue(undefined)
})
afterEach(async () => { if (root) await act(async () => root.unmount()); document.body.replaceChildren() })
it('starts saving immediately and serializes rapid changes', async () => {
  let finish!: () => void
  mock.save.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
  await mount(); expect(mock.save).not.toHaveBeenCalled()
  await change('First'); expect(mock.save).toHaveBeenCalledOnce()
  await change('Latest'); expect(mock.save).toHaveBeenCalledOnce()
  expect(host.textContent).toContain('保存中')
  await act(async () => finish())
  expect(mock.save).toHaveBeenCalledTimes(2)
  expect(mock.save.mock.calls[1][0].anki.deckName).toBe('Latest')
  expect(host.textContent).toContain('已自动保存')
})
it('retries failed saves without another artificial form edit', async () => {
  mock.save.mockRejectedValueOnce(new Error('storage unavailable'))
  await mount(); await change('Retry me')
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('保存失败')
  await act(async () => { host.querySelector<HTMLButtonElement>('.save-retry')!.click() })
  expect(mock.save).toHaveBeenCalledTimes(2)
  expect(host.textContent).toContain('已自动保存')
})
it('shows an actionable load error instead of a blank settings page', async () => {
  mock.get.mockRejectedValue(new Error('storage unavailable'))
  await mount()
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('无法读取设置')
  expect(host.querySelector('button')?.textContent).toBe('重新加载')
})
