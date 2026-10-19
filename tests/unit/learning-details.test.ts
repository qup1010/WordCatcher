import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LearningEditor } from '../../lib/components/LearningDetails'
import type { LearningEdits, WordEntry } from '../../lib/types'

const mock = vi.hoisted(() => ({
  sendMessage: vi.fn(),
}))

vi.mock('../../lib/messaging', () => ({
  sendMessage: mock.sendMessage,
}))

const entry = {
  word: 'bank',
  definition: '河岸',
  contextTranslation: '原来的译文',
} as WordEntry

describe('LearningEditor sentence translation', () => {
  beforeEach(() => mock.sendMessage.mockReset())

  it('merges the result into the latest edits without dropping note or definition changes', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    let resolveRequest: ((value: { ok: true, data: { translation: string, mode: 'mt' } }) => void) | undefined
    mock.sendMessage.mockReturnValueOnce(new Promise(resolve => { resolveRequest = resolve }))
    const onChange = vi.fn<(edits: LearningEdits) => void>()
    const host = document.createElement('div')
    const root = createRoot(host)
    const baseProps = {
      entry,
      edits: {} as LearningEdits,
      sentence: 'The bank is closed.',
      selection: 'bank',
      recordId: 'record-1',
      onChange,
    }
    try {
      await act(async () => root.render(createElement(LearningEditor, baseProps)))
      await act(async () => host.querySelector<HTMLButtonElement>('.sp-btn-text')!.click())
      await act(async () => root.render(createElement(LearningEditor, {
        ...baseProps,
        edits: { definition: '更新后的释义', note: '新增笔记' },
      })))
      await act(async () => {
        resolveRequest?.({ ok: true, data: { translation: '河岸关闭了。', mode: 'mt' } })
        await Promise.resolve()
      })
      expect(onChange).toHaveBeenCalledWith({
        definition: '更新后的释义',
        note: '新增笔记',
        contextTranslation: '河岸关闭了。',
      })
    } finally {
      await act(async () => root.unmount())
    }
  })

  it('keeps a manually edited translation when the request finishes', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    let resolveRequest: ((value: { ok: true, data: { translation: string, mode: 'mt' } }) => void) | undefined
    mock.sendMessage.mockReturnValueOnce(new Promise(resolve => { resolveRequest = resolve }))
    const onChange = vi.fn<(edits: LearningEdits) => void>()
    const host = document.createElement('div')
    const root = createRoot(host)
    const props = {
      entry,
      edits: {} as LearningEdits,
      sentence: 'The bank is closed.',
      selection: 'bank',
      recordId: 'record-1',
      onChange,
    }
    try {
      await act(async () => root.render(createElement(LearningEditor, props)))
      await act(async () => host.querySelector<HTMLButtonElement>('.sp-btn-text')!.click())
      await act(async () => root.render(createElement(LearningEditor, {
        ...props,
        edits: { contextTranslation: '我自己输入的译文' },
      })))
      await act(async () => {
        resolveRequest?.({ ok: true, data: { translation: '自动译文', mode: 'mt' } })
        await Promise.resolve()
      })
      expect(onChange).not.toHaveBeenCalled()
      expect(host.querySelector('[role="alert"]')?.textContent).toContain('已保留你的输入')
    } finally {
      await act(async () => root.unmount())
    }
  })

  it('shows a failed translation response to the user', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    mock.sendMessage.mockResolvedValueOnce({ ok: false, error: '翻译服务不可用' })
    const host = document.createElement('div')
    const root = createRoot(host)
    try {
      await act(async () => root.render(createElement(LearningEditor, {
        entry,
        edits: {},
        sentence: 'The bank is closed.',
        selection: 'bank',
        recordId: 'record-1',
        onChange: vi.fn(),
      })))
      await act(async () => host.querySelector<HTMLButtonElement>('.sp-btn-text')!.click())
      expect(host.querySelector('[role="alert"]')?.textContent).toContain('翻译服务不可用')
    } finally {
      await act(async () => root.unmount())
    }
  })
  it('ignores a translation response after the editor switches records', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    let resolveRequest: ((value: { ok: true, data: { translation: string, mode: 'mt' } }) => void) | undefined
    mock.sendMessage.mockReturnValueOnce(new Promise(resolve => { resolveRequest = resolve }))
    const onChange = vi.fn<(edits: LearningEdits) => void>()
    const host = document.createElement('div')
    const root = createRoot(host)
    const props = {
      entry,
      edits: {} as LearningEdits,
      sentence: 'The bank is closed.',
      selection: 'bank',
      recordId: 'record-1',
      onChange,
    }
    try {
      await act(async () => root.render(createElement(LearningEditor, props)))
      await act(async () => host.querySelector<HTMLButtonElement>('.sp-btn-text')!.click())
      await act(async () => root.render(createElement(LearningEditor, {
        ...props,
        sentence: 'The bank was sold.',
        recordId: 'record-2',
      })))
      await act(async () => {
        resolveRequest?.({ ok: true, data: { translation: '旧记录译文', mode: 'mt' } })
        await Promise.resolve()
      })
      expect(onChange).not.toHaveBeenCalled()
    } finally {
      await act(async () => root.unmount())
    }
  })

})
