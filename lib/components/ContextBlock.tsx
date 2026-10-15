import { useState } from 'react'
import { resolveOffset } from '../anki'

export function isSentenceSelection(text: string): boolean {
  return text.trim().length > 60 || text.trim().split(/\s+/).length > 7 || /[。！？\n]/.test(text)
}

/** 原句与词典例句分开，始终保留精确选区；长原句可以展开阅读全文。 */
export function ContextBlock({ sentence, selection, offset = -1, translation, label = '原句' }: {
  sentence: string, selection: string, offset?: number, translation?: string, label?: string,
}) {
  const [expanded, setExpanded] = useState(false)
  if (!sentence.trim()) return null
  const at = resolveOffset(sentence, selection.trim(), offset)
  const hasTarget = at >= 0 && selection.trim() !== sentence.trim()
  const long = sentence.length > 220
  const start = long && !expanded ? Math.max(0, at - 70) : 0
  const end = long && !expanded ? Math.min(sentence.length, Math.max(start + 180, hasTarget ? at + selection.trim().length + 70 : 0)) : sentence.length
  return <section className="translation-context" aria-label={label}>
    <div className="translation-context-head"><span>{label}</span>
      {long && <button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? '收起原句' : '展开原句'}</button>}
    </div>
    <div className="translation-context-original">
      {start > 0 && '…'}
      {hasTarget
        ? <>{sentence.slice(start, at)}<mark>{sentence.slice(at, at + selection.trim().length)}</mark>{sentence.slice(at + selection.trim().length, end)}</>
        : sentence.slice(start, end)}
      {end < sentence.length && '…'}
    </div>
    {translation?.trim() && <div className="translation-context-translation"><span className="translation-context-label">译文</span>{translation}</div>}
  </section>
}
