import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'
import { ContextBlock } from '../../lib/components/ContextBlock'

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
