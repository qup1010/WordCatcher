import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ContextBlock } from '../../lib/components/ContextBlock'

const mock = vi.hoisted(() => ({
  sendMessage: vi.fn(),
}))

vi.mock('../../lib/messaging', () => ({
  sendMessage: mock.sendMessage,
}))

describe('ContextBlock', () => {
  beforeEach(() => mock.sendMessage.mockReset())
  it('keeps the selected occurrence visible in long context and restores the complete original', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    const host = document.createElement('div')
    const root = createRoot(host)
    const sentence = 'present ' + 'earlier context '.repeat(24) + 'present after the meeting.'
    try {
      await act(async () => root.render(createElement(ContextBlock, { sentence, selection: 'present', offset: sentence.lastIndexOf('present'), translation: '译文内容' })))
      expect(host.querySelector('mark')?.textContent).toBe('present')
      expect(host.querySelector('.translation-context-original')?.textContent).toContain('present after the meeting.')
      expect(host.querySelector('.translation-context-original')?.textContent).not.toBe(sentence)
      await act(async () => host.querySelector('button')!.click())
      expect(host.querySelector('.translation-context-original')?.textContent).toBe(sentence)
      expect(host.querySelector('button')?.getAttribute('aria-expanded')).toBe('true')
    } finally { await act(async () => root.unmount()) }
  })

  it('shows manual translate button when translation is empty and invokes onTranslated on click', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    mock.sendMessage.mockResolvedValueOnce({ ok: true, data: { translation: '会后我们将出席。', mode: 'mt' } })
    const onTranslated = vi.fn()
    const host = document.createElement('div')
    const root = createRoot(host)
    try {
      await act(async () => root.render(createElement(ContextBlock, {
        sentence: 'We will be present after the meeting.',
        selection: 'present',
        offset: 11,
        onTranslated,
      })))
      const btn = host.querySelector<HTMLButtonElement>('.translation-context-translate-btn')
      expect(btn?.textContent).toBe('翻译原句')
      await act(async () => btn!.click())
      expect(mock.sendMessage).toHaveBeenCalledWith({
        type: 'translate-sentence',
        payload: { sentence: 'We will be present after the meeting.', selection: 'present', mode: 'mt' },
      })
      expect(onTranslated).toHaveBeenCalledWith('会后我们将出席。')
      expect(host.querySelector('.translation-context-translation')?.textContent).toContain('会后我们将出席。')
    } finally {
      await act(async () => root.unmount())
    }
  })
  it('ignores a translation response after the displayed context changes', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    let resolveRequest: ((value: { ok: true, data: { translation: string, mode: 'mt' } }) => void) | undefined
    mock.sendMessage.mockReturnValueOnce(new Promise(resolve => { resolveRequest = resolve }))
    const onTranslated = vi.fn()
    const host = document.createElement('div')
    const root = createRoot(host)
    try {
      await act(async () => root.render(createElement(ContextBlock, {
        sentence: 'The bank is closed.',
        selection: 'bank',
        onTranslated,
      })))
      await act(async () => host.querySelector<HTMLButtonElement>('.translation-context-translate-btn')!.click())
      await act(async () => root.render(createElement(ContextBlock, {
        sentence: 'The bank is open.',
        selection: 'bank',
        onTranslated,
      })))
      await act(async () => {
        resolveRequest?.({ ok: true, data: { translation: '旧语境译文', mode: 'mt' } })
        await Promise.resolve()
      })
      expect(onTranslated).not.toHaveBeenCalled()
      expect(host.querySelector('.translation-context-translation')).toBeNull()
    } finally {
      await act(async () => root.unmount())
    }
  })

  it('shows a save error while keeping the generated translation visible', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    mock.sendMessage.mockResolvedValueOnce({ ok: true, data: { translation: '译文已经生成', mode: 'mt' } })
    const onTranslated = vi.fn().mockRejectedValue(new Error('保存失败'))
    const host = document.createElement('div')
    const root = createRoot(host)
    try {
      await act(async () => root.render(createElement(ContextBlock, {
        sentence: 'We will be present after the meeting.',
        selection: 'present',
        offset: 11,
        onTranslated,
      })))
      await act(async () => host.querySelector<HTMLButtonElement>('.translation-context-translate-btn')!.click())
      expect(host.querySelector('[role="alert"]')?.textContent).toContain('保存失败')
      expect(host.querySelector('.translation-context-translation')?.textContent).toContain('译文已经生成')
    } finally {
      await act(async () => root.unmount())
    }
  })
})
