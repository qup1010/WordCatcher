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

export function LearningEditor({ entry, edits, onChange }: {
  entry: WordEntry
  edits: LearningEdits
  onChange: (edits: LearningEdits) => void
}) {
  return (
    <details className="learning-details learning-editor">
      <summary>编辑与笔记</summary>
      <div className="learning-editor-body">
        <label>
          <span>语境义</span>
          <textarea
            rows={2}
            value={edits.definition ?? entry.definition}
            onChange={e => onChange({ ...edits, definition: e.target.value })}
          />
        </label>
        <label>
          <span>原句翻译</span>
          <textarea
            rows={2}
            value={edits.contextTranslation ?? entry.contextTranslation}
            onChange={e => onChange({ ...edits, contextTranslation: e.target.value })}
          />
        </label>
        <label>
          <span>个人笔记</span>
          <textarea
            rows={2}
            placeholder="记录助记想法、易混点或补充说明"
            value={edits.note ?? ''}
            onChange={e => onChange({ ...edits, note: e.target.value })}
          />
        </label>
      </div>
    </details>
  )
}
