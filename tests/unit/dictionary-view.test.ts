import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'
import { DictionaryView } from '../../lib/components/DictionaryView'
import { formatQuickDictResult } from '../../lib/open-dict/db'

it('shows structured senses, unique explanations and progressively disclosed examples', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.createElement('div')
  const root = createRoot(host)
  const result = formatQuickDictResult({ headword: 'agent', pos_groups: [
    { pos: 'noun', meanings: [{ sense_id: 'one', priority: 'core', short_gloss: '', learner_explanation: '代理人', usage_note: '用于代表他人办事的人', examples: [{ text: 'First example', translation: '第一条例句' }, { text: 'Second example', translation: '第二条例句' }] }, { sense_id: 'two', priority: 'common', short_gloss: '代表' }] },
    { pos: 'name', meanings: [{ sense_id: 'name', priority: 'rare', short_gloss: '姓氏' }] },
  ] })
  try {
    await act(async () => root.render(createElement(DictionaryView, { result })))
    expect(host.querySelector('.dict-view-summary')!.textContent).toContain('n.代理人；代表')
    expect(host.querySelector('.dict-view-meanings')!.children).toHaveLength(0)
    expect(host.querySelector('.dict-view-summary')!.textContent).toContain('专名')
    expect(host.querySelector('.dict-view-heading')!.textContent).toBe('1. 代理人核心')
    expect(host.querySelector('.dict-view-sense > p')!.textContent).toContain('用法提示')
    expect(host.querySelector('.dict-view-sense > .dict-view-example')!.textContent).toContain('第一条例句')
    const extra = host.querySelector<HTMLDetailsElement>('.dict-view-more')!
    expect(extra.open).toBe(false)
    expect(extra.textContent).toContain('第二条例句')
    const details = host.querySelector<HTMLDetailsElement>('.dict-view-details')!
    expect(details.open).toBe(false)
    details.open = true
    expect(details.textContent).toContain('完整释义（3）')
  } finally { await act(async () => root.unmount()) }
})
