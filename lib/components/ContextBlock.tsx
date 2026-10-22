import { useEffect, useRef, useState } from 'react'
import { resolveOffset } from '../anki'
import { sendMessage } from '../messaging'

export function isSentenceSelection(text: string): boolean {
  return text.trim().length > 60 || text.trim().split(/\s+/).length > 7 || /[。！？\n]/.test(text)
}

/** 原句与词典例句分开，始终保留精确选区；长原句可以展开阅读全文，并支持按需手动翻译原句。 */
export function ContextBlock({
  sentence,
  selection,
  offset = -1,
  translation,
  label = '原句',
  onTranslated,
}: {
  sentence: string
  selection: string
  offset?: number
  translation?: string
  label?: string
  onTranslated?: (translation: string) => void | Promise<void>
}) {
  const [expanded, setExpanded] = useState(false)
  const [manualTranslation, setManualTranslation] = useState('')
  const [translating, setTranslating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const contextIdentity = JSON.stringify([sentence, selection])
  const contextIdentityRef = useRef(contextIdentity)
  contextIdentityRef.current = contextIdentity
  const requestVersionRef = useRef(0)

  useEffect(() => {
    requestVersionRef.current += 1
    setManualTranslation('')
    setTranslating(false)
    setError(null)
    return () => {
      requestVersionRef.current += 1
    }
  }, [contextIdentity])

  if (!sentence.trim()) return null
  const at = resolveOffset(sentence, selection.trim(), offset)
  const hasTarget = at >= 0 && selection.trim() !== sentence.trim()
  const long = sentence.length > 220
  const start = long && !expanded ? Math.max(0, at - 70) : 0
  const end = long && !expanded ? Math.min(sentence.length, Math.max(start + 180, hasTarget ? at + selection.trim().length + 70 : 0)) : sentence.length

  const effectiveTranslation = translation?.trim() || manualTranslation.trim()
  const canTranslate = Boolean(onTranslated) && !effectiveTranslation && !isSentenceSelection(selection) && sentence.trim().length > 0

  const handleTranslate = async (mode: 'mt' | 'ai' = 'mt') => {
    if (translating) return
    const targetSentence = sentence
    const requestIdentity = contextIdentity
    const requestVersion = ++requestVersionRef.current
    const isCurrentRequest = () =>
      requestVersionRef.current === requestVersion && contextIdentityRef.current === requestIdentity
    setTranslating(true)
    setError(null)
    try {
      const res = await sendMessage({
        type: 'translate-sentence',
        payload: { sentence: targetSentence, selection: selection.trim(), mode },
      })
      if (!isCurrentRequest()) return
      if (res.ok) {
        setManualTranslation(res.data.translation)
        try {
          await onTranslated?.(res.data.translation)
        } catch {
          if (isCurrentRequest()) setError('译文已生成，但保存失败，请重试。')
        }
      } else {
        setError(res.error)
      }
    } catch {
      if (isCurrentRequest()) setError('原句翻译失败，请稍后重试。')
    } finally {
      if (isCurrentRequest()) setTranslating(false)
    }
  }

  return (
    <section className="translation-context" aria-label={label}>
      <div className="translation-context-head">
        <span>{label}</span>
        <div className="translation-context-head-actions">
          {long && (
            <button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
              {expanded ? '收起原句' : '展开原句'}
            </button>
          )}
          {canTranslate && (
            <button
              type="button"
              className="translation-context-translate-btn"
              disabled={translating}
              onClick={() => void handleTranslate()}
            >
              {translating ? '翻译中…' : '翻译原句'}
            </button>
          )}
        </div>
      </div>
      <div className="translation-context-original">
        {start > 0 && '…'}
        {hasTarget
          ? <>{sentence.slice(start, at)}<mark>{sentence.slice(at, at + selection.trim().length)}</mark>{sentence.slice(at + selection.trim().length, end)}</>
          : sentence.slice(start, end)}
        {end < sentence.length && '…'}
      </div>
      {effectiveTranslation && (
        <div className="translation-context-translation">
          <span className="translation-context-label">译文</span>
          {effectiveTranslation}
        </div>
      )}
      {error && (
        <div className="translation-context-error" role="alert">
          {error}
          <button disabled={translating} onClick={() => void handleTranslate()}>重试在线快译</button>
          <button disabled={translating} onClick={() => void handleTranslate('ai')}>改用 AI</button>
        </div>
      )}
    </section>
  )
}
