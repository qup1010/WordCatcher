import type { WordEntry, LearningEdits } from '../types'
import './learning.css'

export function LearningDetails({ entry }: { entry: Partial<WordEntry> }) {
  const hasDetails = entry.keyExplanation || entry.usageNote || entry.example
  return <>
    {entry.expression && entry.expression !== entry.word && <div className="learning-expression"><small>学习表达</small><strong>{entry.expression}</strong></div>}
    {hasDetails && <details className="learning-details"><summary>理解与用法</summary>
      {entry.keyExplanation && <p>{entry.keyExplanation}</p>}
      {entry.usageNote && <p>{entry.usageNote}</p>}
      {entry.example && <blockquote>{entry.example}<br />{entry.exampleTranslation}</blockquote>}
    </details>}
  </>
}

export function LearningEditor({ entry, edits, onChange }: {
  entry: WordEntry, edits: LearningEdits, onChange: (edits: LearningEdits) => void,
}) {
  return <details className="learning-details"><summary>编辑与笔记</summary>
    <label>语境义<textarea rows={2} value={edits.definition ?? entry.definition}
      onChange={e => onChange({ ...edits, definition: e.target.value })} /></label>
    <label>原句翻译<textarea rows={2} value={edits.contextTranslation ?? entry.contextTranslation}
      onChange={e => onChange({ ...edits, contextTranslation: e.target.value })} /></label>
    <label>我的笔记<textarea rows={2} value={edits.note ?? ''}
      onChange={e => onChange({ ...edits, note: e.target.value })} /></label>
  </details>
}
