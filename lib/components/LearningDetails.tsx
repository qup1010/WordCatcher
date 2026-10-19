import { useEffect, useRef, useState } from 'react'
import { sendMessage } from '../messaging'
import type { WordEntry, LearningEdits } from '../types'
import './learning.css'

export function LearningDetails({ entry, note }: { entry: Partial<WordEntry>, note?: string }) {
  const hasDetails = Boolean(entry.keyExplanation || entry.usageNote || entry.example)
  return (
    <>
      {entry.expression && entry.expression !== entry.word && (
        <div className="learning-expression">
          <span className="learning-badge">核心表达</span>
          <strong>{entry.expression}</strong>
        </div>
      )}
      {note?.trim() && (
        <div className="learning-note-callout">
          <span className="learning-note-label">个人笔记</span>
          <p>{note}</p>
        </div>
      )}
      {hasDetails && (
        <details className="learning-details">
          <summary>理解与用法</summary>
          <div className="learning-details-body">
            {entry.keyExplanation && (
              <div className="learning-detail-item">
                <span className="learning-detail-label">语境解析</span>
                <p>{entry.keyExplanation}</p>
              </div>
            )}
            {entry.usageNote && (
              <div className="learning-detail-item">
                <span className="learning-detail-label">用法提示</span>
                <p>{entry.usageNote}</p>
              </div>
            )}
            {entry.example && (
              <div className="learning-detail-item">
                <span className="learning-detail-label">拓展例句</span>
                <blockquote>
                  {entry.example}
                  {entry.exampleTranslation && (
                    <>
                      <br />
                      <span className="learning-example-trans">{entry.exampleTranslation}</span>
                    </>
                  )}
                </blockquote>
              </div>
            )}
          </div>
        </details>
      )}
    </>
  )
}

export function LearningEditor({
  entry,
  edits,
  sentence,
  selection,
  recordId,
  onChange,
}: {
  entry: WordEntry
  edits: LearningEdits
  sentence?: string
  selection?: string
  recordId?: string
  onChange: (edits: LearningEdits) => void
}) {
  const [translating, setTranslating] = useState(false)
  const [translationError, setTranslationError] = useState<string | null>(null)
  const editsRef = useRef(edits)
  editsRef.current = edits
  const contextIdentity = JSON.stringify([recordId ?? '', entry.word, sentence ?? '', selection ?? ''])
  const contextIdentityRef = useRef(contextIdentity)
  contextIdentityRef.current = contextIdentity
  const requestVersionRef = useRef(0)

  useEffect(() => {
    requestVersionRef.current += 1
    setTranslating(false)
    setTranslationError(null)
    return () => {
      requestVersionRef.current += 1
    }
  }, [contextIdentity])

  const updateEdits = (next: LearningEdits) => {
    editsRef.current = next
    onChange(next)
  }

  const onTranslateSentence = async () => {
    const targetSentence = sentence?.trim()
    if (!targetSentence || translating) return
    const requestIdentity = contextIdentity
    const requestVersion = ++requestVersionRef.current
    const translationAtStart = editsRef.current.contextTranslation ?? entry.contextTranslation
    const isCurrentRequest = () =>
      requestVersionRef.current === requestVersion && contextIdentityRef.current === requestIdentity
    setTranslating(true)
    setTranslationError(null)
    try {
      const res = await sendMessage({
        type: 'translate-sentence',
        payload: { sentence: targetSentence, selection: selection?.trim() || entry.word },
      })
      if (!isCurrentRequest()) return
      if (!res.ok) {
        setTranslationError(res.error)
        return
      }

      const currentTranslation = editsRef.current.contextTranslation ?? entry.contextTranslation
      if (currentTranslation !== translationAtStart) {
        setTranslationError('原句译文已在请求期间修改，已保留你的输入。')
        return
      }

      updateEdits({ ...editsRef.current, contextTranslation: res.data.translation })
    } catch {
      if (isCurrentRequest()) setTranslationError('原句翻译失败，请稍后重试。')
    } finally {
      if (isCurrentRequest()) setTranslating(false)
    }
  }

  return (
    <details className="learning-details learning-editor">
      <summary>编辑与笔记</summary>
      <div className="learning-editor-body">
        <label>
          <span>语境义</span>
          <textarea
            rows={2}
            value={edits.definition ?? entry.definition}
            onChange={e => updateEdits({ ...editsRef.current, definition: e.target.value })}
          />
        </label>
        <label>
          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>原句翻译</span>
            {sentence?.trim() && (
              <button
                type="button"
                className="sp-btn-text"
                style={{ fontSize: 11, padding: 0 }}
                disabled={translating}
                onClick={() => void onTranslateSentence()}
              >
                {translating ? '翻译中…' : '翻译原句'}
              </button>
            )}
          </span>
          <textarea
            rows={2}
            value={edits.contextTranslation ?? entry.contextTranslation}
            onChange={e => {
              setTranslationError(null)
              updateEdits({ ...editsRef.current, contextTranslation: e.target.value })
            }}
          />
          {translationError && <div className="learning-translate-error" role="alert">{translationError}</div>}
        </label>
        <label>
          <span>个人笔记</span>
          <textarea
            rows={2}
            placeholder="记录助记想法、易混点或补充说明"
            value={edits.note ?? ''}
            onChange={e => updateEdits({ ...editsRef.current, note: e.target.value })}
          />
        </label>
      </div>
    </details>
  )
}
