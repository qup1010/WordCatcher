import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, type Settings } from '../../lib/types'
import App from '../../entrypoints/options/App'
const mock = vi.hoisted(() => ({ save: vi.fn(), get: vi.fn() }))
vi.mock('../../lib/settings', () => ({ getSettings: mock.get, saveSettings: mock.save, isAiConfigured: () => false }))
vi.mock('../../lib/messaging', () => ({ sendMessage: async () => ({ ok: false, error: 'stub' }) }))
vi.mock('#imports', () => ({ browser: { runtime: { getManifest: () => ({ version: '0.1.4' }) } } }))
vi.mock('../../entrypoints/options/sections/AiSection', () => ({ AiSection: ({ s, onChange }: { s: Settings, onChange: (s: Settings) => void }) => createElement('input', {
  'aria-label': '测试牌组', value: s.anki.deckName,
  onChange: (event: { target: { value: string } }) => onChange({ ...s, anki: { ...s.anki, deckName: event.target.value } }),
}) }))
vi.mock('../../entrypoints/options/sections/AnkiSection', () => ({ AnkiSection: () => null }))
vi.mock('../../entrypoints/options/sections/MtSection', () => ({ MtSection: () => null }))
vi.mock('../../entrypoints/options/sections/DictSection', () => ({ DictSection: () => null }))
vi.mock('../../entrypoints/options/sections/UxSection', () => ({ UxSection: ({s,onChange}: {s: Settings,onChange:(s:Settings)=>void}) => createElement('button', {onClick:()=>onChange({...s,explainLanguage:s.explainLanguage === 'English' ? '简体中文' : 'English'})}, '切换语言') }))
vi.mock('../../entrypoints/options/sections/DataSection', () => ({ DataSection: () => null }))
vi.mock('../../entrypoints/options/sections/AboutSection', () => ({ AboutSection: () => null }))
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
async function click(text: string) {
  await act(async () => { Array.from(host.querySelectorAll('button')).find(b => b.textContent === text)!.click() })
}
it('keeps connection edits as drafts and does not include them in ordinary preference writes', async () => {
  await mount(); await change('Draft deck')
  expect(mock.save).not.toHaveBeenCalled()
  await click('切换语言')
  expect(mock.save.mock.calls[0][0].anki.deckName).toBe(DEFAULT_SETTINGS.anki.deckName)
  expect(mock.save.mock.calls[0][0].explainLanguage).toBe('English')
  expect(host.textContent).toContain('未保存的修改')
  await click('保存配置')
  expect(mock.save.mock.calls[1][0].anki.deckName).toBe('Draft deck')
  expect(host.textContent).toContain('连接配置已保存')
})
it('discards connections while retaining ordinary preferences', async () => {
  await mount(); await change('Discard me'); await click('切换语言'); await click('放弃修改')
  expect(host.querySelector('input')!.value).toBe(DEFAULT_SETTINGS.anki.deckName)
  expect(mock.save.mock.calls.at(-1)![0].explainLanguage).toBe('English')
})
it('serializes rapid ordinary preference changes', async () => {
  let finish!: () => void
  mock.save.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
  await mount(); await click('切换语言'); await click('切换语言')
  expect(mock.save).toHaveBeenCalledOnce()
  await act(async () => finish())
  expect(mock.save).toHaveBeenCalledTimes(2)
  expect(mock.save.mock.calls[1][0].explainLanguage).toBe('简体中文')
})
it('retries failed configuration saves without an artificial edit', async () => {
  mock.save.mockRejectedValueOnce(new Error('storage unavailable'))
  await mount(); await change('Retry me'); await click('保存配置')
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('保存失败')
  await click('重试保存')
  expect(mock.save).toHaveBeenCalledTimes(2)
  expect(mock.save.mock.calls[1][0].anki.deckName).toBe('Retry me')
  expect(host.textContent).toContain('连接配置已保存')
})
it('shows an actionable load error instead of a blank settings page', async () => {
  mock.get.mockRejectedValue(new Error('storage unavailable'))
  await mount()
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('无法读取设置')
  expect(host.querySelector('button')?.textContent).toBe('重新加载')
})
