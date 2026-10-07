import { useEffect, useState } from 'react'
import type { LearningRecord, LearningEdits } from '../types'
import { sendMessage } from '../messaging'
import { LearningDetails, LearningEditor } from './LearningDetails'

export function LearningLibrary({ onOpen }: { onOpen: (record: LearningRecord) => void }) {
  const [records, setRecords] = useState<LearningRecord[]>([])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<LearningRecord | null>(null)
  const [edits, setEdits] = useState<LearningEdits>({})
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const refresh = async () => {
    const res = await sendMessage({ type: 'library-list' })
    if (res.ok) setRecords(res.data)
    else setStatus(res.error)
  }
  useEffect(() => { void refresh() }, [])
  const save = async () => {
    if (!selected || busy) return
    setBusy(true)
    try {
      const res = await sendMessage({ type: 'library-update', payload: { id: selected.id,
        edits: { ...edits, definition: edits.definition ?? selected.card.entry.definition } } })
      if (res.ok) { setSelected(res.data); setStatus('已保存这条语境，Anki 等待同步。'); await refresh() }
      else setStatus(res.error)
    } finally { setBusy(false) }
  }
  const sync = async () => {
    if (!selected || busy) return
    setBusy(true)
    try {
      const res = await sendMessage({ type: 'library-sync', payload: { id: selected.id } })
      setStatus(res.ok ? res.data.queued ? '本地记录已保留；' + (res.data.syncError ?? 'Anki 待同步') : 'Anki 已同步' : res.error)
      await refresh()
    } finally { setBusy(false) }
  }
  const exportRecords = async () => {
    const res = await sendMessage({ type: 'library-export' })
    if (!res.ok) { setStatus(res.error); return }
    const url = URL.createObjectURL(new Blob([res.data], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url; a.download = 'word-catcher-learning.json'; a.click()
    URL.revokeObjectURL(url)
  }
  const filtered = records.filter(r => [r.card.entry.word, r.card.entry.expression, r.card.entry.definition, r.card.sentence, r.edits?.definition, r.edits?.note]
    .some(v => v?.toLowerCase().includes(query.toLowerCase())))
  const groups = new Map<string, LearningRecord[]>()
  for (const record of filtered) {
    const key = record.card.entry.word.toLowerCase()
    groups.set(key, [...(groups.get(key) ?? []), record])
  }
  return <section aria-label="单词本" className="learning-library">
    <div className="learning-library-toolbar"><input aria-label="搜索单词本" placeholder="搜索表达、原句或笔记" value={query} onChange={e => setQuery(e.target.value)} />
      <button type="button" className="sp-btn-subtle" onClick={() => void exportRecords()}>导出</button></div>
    {status && <p role="status">{status}</p>}
    {records.length === 0 && <p>还没有收藏。查询后点击“存入单词本”，即可保留这次语境。</p>}
    {Array.from(groups.entries()).map(([word, contexts]) => <section key={word} className="sp-card">
      <strong>{contexts[0].card.entry.word}</strong><small> · {contexts.length} 条语境</small>
      {contexts.map(r => <button key={r.id} type="button" className="sp-history-item" onClick={() => {
        setSelected(r); setEdits(r.edits ?? {}); setStatus('')
      }}>{r.edits?.definition ?? r.card.entry.definition}<br /><small>{r.card.sentence}</small></button>)}
    </section>)}
    {selected && <article className="sp-card">
      <h3>{selected.card.entry.expression || selected.card.entry.word}</h3>
      <p>{selected.edits?.definition ?? selected.card.entry.definition}</p>
      <p>{selected.card.sentence}</p><p>{selected.edits?.contextTranslation ?? selected.card.entry.contextTranslation}</p>
      {selected.card.pageUrl && <a href={selected.card.pageUrl} target="_blank" rel="noreferrer">{selected.card.pageTitle || '查看原文'}</a>}
      <p className="learning-sync-status">{selected.syncError ? 'Anki：' + selected.syncError : selected.syncedAt ? '已同步到 Anki' : '保存在本地，Anki 待同步'}</p>
      <LearningDetails entry={selected.card.entry} />
      <LearningEditor entry={selected.card.entry} edits={edits} onChange={setEdits} />
      <div className="sp-card-actions">
        <button type="button" className="sp-btn-save" disabled={busy} onClick={() => void save()}>保存编辑</button>
        <button type="button" className="sp-btn-subtle" disabled={busy} onClick={() => void sync()}>同步 Anki</button>
        <button type="button" className="sp-btn-subtle" disabled={busy} onClick={() => onOpen(selected)}>重新分析</button>
      </div>
    </article>}
  </section>
}
