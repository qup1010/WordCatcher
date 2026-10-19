import { useEffect, useRef, useState } from 'react'
import { Eye, EyeOff, RefreshCw, RotateCcw, Shuffle, Trash2, Upload, Download, Volume2, ChevronLeft, ChevronRight, X } from 'lucide-react'
import type { LearningRecord, LearningEdits } from '../types'
import { sendMessage } from '../messaging'
import { getSettings } from '../settings'
import { isTtsSupported, speak } from '../tts'
import { ContextBlock } from './ContextBlock'
import { LearningDetails, LearningEditor } from './LearningDetails'

export function LearningLibrary({ onOpen }: { onOpen: (record: LearningRecord) => void }) {
  const [records, setRecords] = useState<LearningRecord[]>([])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<LearningRecord | null>(null)
  const [edits, setEdits] = useState<LearningEdits>({})
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const editsRef = useRef(edits)
  editsRef.current = edits
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [syncingWebDav, setSyncingWebDav] = useState(false)
  const [webdavEnabled, setWebdavEnabled] = useState(false)
  const [maskMeanings, setMaskMeanings] = useState(false)
  const [reviewMode, setReviewMode] = useState(false)
  const [reviewIndex, setReviewIndex] = useState(0)
  const [revealAnswer, setRevealAnswer] = useState(false)
  const [reviewOrder, setReviewOrder] = useState<LearningRecord[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const detailRef = useRef<HTMLElement>(null)

  const refresh = async () => {
    const res = await sendMessage({ type: 'library-list' })
    if (res.ok) setRecords(res.data)
    else setStatus(res.error)
  }

  useEffect(() => {
    void refresh()
    void getSettings().then((s) => {
      const enabled = Boolean(s.webdav?.enabled && s.webdav.url.trim())
      setWebdavEnabled(enabled)
      if (enabled && s.webdav.autoSync !== false) {
        void sendMessage({ type: 'webdav-sync' }).then((res) => {
          if (res.ok) setRecords(res.data.records)
          else setStatus(`WebDAV 同步未完成：${res.error}`)
        })
      }
    }).catch(() => {})
  }, [])

  const onSyncWebDav = async () => {
    if (syncingWebDav || busy) return
    setSyncingWebDav(true)
    setStatus('正在与 WebDAV 云端同步…')
    try {
      const res = await sendMessage({ type: 'webdav-sync', payload: { forcePush: true } })
      if (res.ok) {
        setRecords(res.data.records)
        const { added, updated, removed, total } = res.data
        const parts = [
          added > 0 ? `新增 ${added} 条` : '',
          updated > 0 ? `更新 ${updated} 条` : '',
          removed > 0 ? `删除 ${removed} 条` : '',
        ].filter(Boolean).join('，')
        setStatus(parts ? `云端同步完成：${parts}（共 ${total} 条）。` : `云端同步完成，数据已是最新（共 ${total} 条）。`)
      } else {
        setStatus(res.error)
      }
    } finally {
      setSyncingWebDav(false)
    }
  }

  const onSpeak = (text: string) => {
    if (!isTtsSupported() || !text) return
    speak(text, { lang: 'en-US', rate: 1, autoDetect: true })
  }

  const save = async () => {
    if (!selected || busy) return
    setBusy(true)
    try {
      const res = await sendMessage({
        type: 'library-update',
        payload: {
          id: selected.id,
          edits: { ...edits, definition: edits.definition ?? selected.card.entry.definition },
        },
      })
      if (res.ok) {
        setSelected(res.data)
        setStatus('语境修改已保存。')
        await refresh()
      } else {
        setStatus(res.error)
      }
    } finally {
      setBusy(false)
    }
  }

  const onContextTranslated = async (translation: string) => {
    const current = selectedRef.current
    if (!current) return
    const recordId = current.id
    const currentEdits = editsRef.current
    const nextEdits: LearningEdits = {
      ...currentEdits,
      definition: currentEdits.definition ?? current.card.entry.definition,
      contextTranslation: translation,
    }
    editsRef.current = nextEdits
    setEdits(nextEdits)
    try {
      const res = await sendMessage({
        type: 'library-update',
        payload: { id: recordId, edits: nextEdits },
      })
      if (!res.ok) throw new Error(res.error)
      if (selectedRef.current?.id !== recordId) return
      setSelected(res.data)
      setStatus('原句翻译已生成并保存。')
      await refresh()
    } catch (error) {
      const reason = error instanceof Error ? error.message : '未知错误'
      setStatus('译文已生成，但保存失败：' + reason)
      throw error
    }
  }

  const sync = async () => {
    if (!selected || busy) return
    setBusy(true)
    try {
      const res = await sendMessage({ type: 'library-sync', payload: { id: selected.id } })
      setStatus(
        res.ok
          ? res.data.queued
            ? `Anki 未连接，已加入待同步队列（${res.data.syncError ?? '请打开 Anki 后重试'}）`
            : '已推送至 Anki。'
          : res.error,
      )
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const removeRecord = async (id: string) => {
    if (busy) return
    setBusy(true)
    try {
      const res = await sendMessage({ type: 'library-remove', payload: { id } })
      if (res.ok) {
        setRecords(res.data)
        if (selected?.id === id) setSelected(null)
        setStatus('已删除该条语境记录。')
      } else {
        setStatus(res.error)
      }
    } finally {
      setBusy(false)
    }
  }

  const exportRecords = async () => {
    const res = await sendMessage({ type: 'library-export' })
    if (!res.ok) {
      setStatus(res.error)
      return
    }
    const url = URL.createObjectURL(new Blob([res.data], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'word-catcher-learning.json'
    a.click()
    URL.revokeObjectURL(url)
    setStatus('单词本备份已导出。')
  }

  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const text = await file.text()
      const res = await sendMessage({ type: 'library-import', payload: { json: text } })
      if (res.ok) {
        setRecords(res.data.records)
        setStatus(res.data.added > 0 ? `已导入 ${res.data.added} 条语境记录。` : '备份文件已读取，未发现新的语境记录。')
      } else {
        setStatus(res.error)
      }
    } catch {
      setStatus('读取备份文件失败，请确认文件格式有效。')
    }
  }

  const filtered = records.filter(r =>
    [
      r.card.entry.word,
      r.card.entry.expression,
      r.card.entry.definition,
      r.card.sentence,
      r.edits?.definition,
      r.edits?.note,
    ].some(v => v?.toLowerCase().includes(query.toLowerCase())),
  )

  const startReview = () => {
    const pool = filtered.length > 0 ? [...filtered] : [...records]
    if (pool.length === 0) return
    setReviewOrder(pool)
    setReviewIndex(0)
    setRevealAnswer(false)
    setReviewMode(true)
  }

  const shuffleReview = () => {
    const copy = [...reviewOrder]
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[copy[i], copy[j]] = [copy[j], copy[i]]
    }
    setReviewOrder(copy)
    setReviewIndex(0)
    setRevealAnswer(false)
  }

  useEffect(() => {
    if (!reviewMode || reviewOrder.length === 0) return
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target?.matches('input, textarea, select')) return
      if (e.key === ' ') {
        e.preventDefault()
        setRevealAnswer(v => !v)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        setReviewIndex(i => (i + 1) % reviewOrder.length)
        setRevealAnswer(false)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        setReviewIndex(i => (i - 1 + reviewOrder.length) % reviewOrder.length)
        setRevealAnswer(false)
      } else if (e.key === 'p' || e.key === 'P') {
        e.preventDefault()
        const cur = reviewOrder[reviewIndex]
        if (cur) onSpeak(cur.card.entry.expression || cur.card.entry.word)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [reviewMode, reviewOrder, reviewIndex])

  if (reviewMode && reviewOrder.length > 0) {
    const current = reviewOrder[reviewIndex] ?? reviewOrder[0]
    const headword = current.card.entry.expression || current.card.entry.word
    const reading = current.card.entry.reading?.replace(/^\/+|\/+$/g, '')
    const def = current.edits?.definition ?? current.card.entry.definition
    const trans = current.edits?.contextTranslation ?? current.card.entry.contextTranslation

    return (
      <section aria-label="卡片复习" className="learning-library">
        <div className="learning-review-bar">
          <span className="learning-review-progress">
            复习进度 {reviewIndex + 1} / {reviewOrder.length}
          </span>
          <div className="learning-review-tools">
            <button type="button" className="sp-btn-subtle sp-btn-compact" onClick={shuffleReview} title="随机打乱顺序">
              <Shuffle size={12} />
              乱序
            </button>
            <button type="button" className="sp-btn-subtle sp-btn-compact" onClick={() => setReviewMode(false)}>
              退出复习
            </button>
          </div>
        </div>

        <article className="sp-card learning-review-card">
          <div className="learning-review-prompt">
            <span className="learning-badge">根据原句语境回忆词义</span>
            {current.card.entry.partOfSpeech && (
              <span className="sp-card-pos">{current.card.entry.partOfSpeech}</span>
            )}
          </div>

          <ContextBlock
            key={current.id + (revealAnswer ? '-back' : '-front')}
            sentence={current.card.sentence}
            selection={current.card.selection}
            offset={current.card.sentenceOffset}
            translation={revealAnswer ? trans : undefined}
          />

          {!revealAnswer ? (
            <button
              type="button"
              className="learning-reveal-btn"
              onClick={() => {
                setRevealAnswer(true)
                onSpeak(headword)
              }}
            >
              显示答案（空格键）
            </button>
          ) : (
            <div className="learning-review-answer">
              <div className="sp-card-word-wrap" style={{ marginBottom: 8 }}>
                <span className="sp-card-word">{headword}</span>
                {reading && <span className="sp-card-reading">/{reading}/</span>}
                {isTtsSupported() && (
                  <button
                    type="button"
                    className="sp-btn-icon"
                    title="朗读（P）"
                    aria-label={`朗读 ${headword}`}
                    onClick={() => onSpeak(headword)}
                  >
                    <Volume2 size={15} />
                  </button>
                )}
              </div>
              <div className="sp-card-def">{def}</div>
              <LearningDetails entry={current.card.entry} note={current.edits?.note} />
              {current.card.entry.memoryHook && (
                <div className="sp-hook">
                  <strong>记忆线索</strong>
                  <div>{current.card.entry.memoryHook}</div>
                </div>
              )}
            </div>
          )}

          <div className="learning-review-nav">
            <button
              type="button"
              className="sp-btn-subtle"
              onClick={() => {
                setReviewIndex(i => (i - 1 + reviewOrder.length) % reviewOrder.length)
                setRevealAnswer(false)
              }}
            >
              <ChevronLeft size={14} />
              上一条
            </button>
            <button
              type="button"
              className="sp-btn-subtle"
              onClick={() => setRevealAnswer(v => !v)}
            >
              <RotateCcw size={13} />
              {revealAnswer ? '遮挡答案' : '显示答案'}
            </button>
            <button
              type="button"
              className="sp-btn-save"
              onClick={() => {
                setReviewIndex(i => (i + 1) % reviewOrder.length)
                setRevealAnswer(false)
              }}
            >
              下一条
              <ChevronRight size={14} />
            </button>
          </div>
        </article>
      </section>
    )
  }

  const groups = new Map<string, LearningRecord[]>()
  for (const record of filtered) {
    const key = record.card.entry.word.toLowerCase()
    groups.set(key, [...(groups.get(key) ?? []), record])
  }

  return (
    <section aria-label="单词本" className="learning-library">
      <div className="learning-library-toolbar">
        <input
          aria-label="搜索单词本"
          placeholder="搜索单词、表达、原句或笔记"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          style={{ display: 'none' }}
          onChange={e => void onImportFile(e)}
        />
      </div>

      {records.length > 0 && (
        <div className="learning-library-actions-bar">
          <button type="button" className="sp-btn-save sp-btn-compact" onClick={startReview}>
            开始复习 ({filtered.length})
          </button>
          <button
            type="button"
            className="sp-btn-subtle sp-btn-compact"
            onClick={() => setMaskMeanings(v => !v)}
            title="遮挡列表中的释义以供自测，鼠标悬停时显示"
          >
            {maskMeanings ? <Eye size={12} /> : <EyeOff size={12} />}
            {maskMeanings ? '显示释义' : '遮挡释义'}
          </button>
          {webdavEnabled && (
            <button
              type="button"
              className="sp-btn-subtle sp-btn-compact"
              disabled={syncingWebDav || busy}
              onClick={() => void onSyncWebDav()}
              title="立即与 WebDAV 云端同步单词本"
            >
              <RefreshCw size={12} />
              {syncingWebDav ? '同步中' : '同步'}
            </button>
          )}
          <button
            type="button"
            className="sp-btn-subtle sp-btn-compact"
            onClick={() => fileInputRef.current?.click()}
            title="导入 JSON 备份"
          >
            <Upload size={12} />
            导入
          </button>
          <button
            type="button"
            className="sp-btn-subtle sp-btn-compact"
            onClick={() => void exportRecords()}
            title="导出单词本 JSON 备份"
          >
            <Download size={12} />
            导出
          </button>
        </div>
      )}

      {status && <p className="learning-status-banner" role="status">{status}</p>}

      {selected && (
        <article ref={detailRef} className="sp-card learning-selected-card">
          <div className="learning-selected-header">
            <div className="sp-card-word-wrap">
              <span className="sp-card-word">
                {selected.card.entry.expression || selected.card.entry.word}
              </span>
              {selected.card.entry.reading && (
                <span className="sp-card-reading">
                  /{selected.card.entry.reading.replace(/^\/+|\/+$/g, '')}/
                </span>
              )}
              {isTtsSupported() && (
                <button
                  type="button"
                  className="sp-btn-icon"
                  title="朗读"
                  aria-label={`朗读 ${selected.card.entry.word}`}
                  onClick={() => onSpeak(selected.card.entry.expression || selected.card.entry.word)}
                >
                  <Volume2 size={15} />
                </button>
              )}
              {selected.card.entry.partOfSpeech && (
                <span className="sp-card-pos">{selected.card.entry.partOfSpeech}</span>
              )}
            </div>
            <button
              type="button"
              className="sp-btn-icon"
              title="收起详情"
              aria-label="收起详情"
              onClick={() => setSelected(null)}
            >
              <X size={14} />
            </button>
          </div>

          <div className="sp-card-def">{selected.edits?.definition ?? selected.card.entry.definition}</div>

          <ContextBlock
            key={selected.id}
            sentence={selected.card.sentence}
            selection={selected.card.selection}
            offset={selected.card.sentenceOffset}
            translation={edits.contextTranslation ?? selected.edits?.contextTranslation ?? selected.card.entry.contextTranslation}
            onTranslated={onContextTranslated}
          />

          <LearningDetails entry={selected.card.entry} note={selected.edits?.note} />

          {selected.card.entry.memoryHook && (
            <div className="sp-hook">
              <strong>记忆线索</strong>
              <div>{selected.card.entry.memoryHook}</div>
            </div>
          )}

          <div className="learning-meta-row">
            {selected.card.pageUrl && (
              <a
                className="learning-source-link"
                href={selected.card.pageUrl}
                target="_blank"
                rel="noreferrer"
              >
                {selected.card.pageTitle || '查看原文'}
              </a>
            )}
            <span className="learning-sync-status">
              {selected.syncedAt ? '已同步至 Anki' : '已保存在本地单词本'}
            </span>
          </div>

          <LearningEditor
            entry={selected.card.entry}
            edits={edits}
            sentence={selected.card.sentence}
            selection={selected.card.selection}
            recordId={selected.id}
            onChange={next => {
              editsRef.current = next
              setEdits(next)
            }}
          />

          <div className="sp-card-actions">
            <button type="button" className="sp-btn-save" disabled={busy} onClick={() => void save()}>
              保存修改
            </button>
            <button type="button" className="sp-btn-subtle" disabled={busy} onClick={() => onOpen(selected)}>
              重新生成
            </button>
            <button type="button" className="sp-btn-subtle" disabled={busy} onClick={() => void sync()} title="可选：将此语境卡片推送至 Anki 桌面版">
              推送至 Anki
            </button>
            <button
              type="button"
              className="sp-btn-subtle learning-btn-danger"
              disabled={busy}
              onClick={() => void removeRecord(selected.id)}
              title="删除该条语境记录"
            >
              <Trash2 size={13} />
              删除
            </button>
          </div>
        </article>
      )}

      {records.length === 0 && (
        <div className="sp-state">
          <strong>还没有收藏的词条</strong>
          <span>查词后点击“存入单词本”，即可保存词条与当时出现的原句语境。</span>
          <div className="sp-state-actions">
            {webdavEnabled && (
              <button
                type="button"
                className="sp-btn-save"
                disabled={syncingWebDav || busy}
                onClick={() => void onSyncWebDav()}
              >
                <RefreshCw size={12} />
                {syncingWebDav ? '正在从云端同步…' : '从 WebDAV 同步'}
              </button>
            )}
            <button type="button" className="sp-btn-subtle" onClick={() => fileInputRef.current?.click()}>
              导入备份文件
            </button>
          </div>
        </div>
      )}

      {Array.from(groups.entries()).map(([word, contexts]) => (
        <section key={word} className="sp-card learning-group-card">
          <div className="learning-group-head">
            <div className="learning-group-title">
              <strong>{contexts[0].card.entry.word}</strong>
              {contexts[0].card.entry.reading && (
                <span className="sp-card-reading">
                  /{contexts[0].card.entry.reading.replace(/^\/+|\/+$/g, '')}/
                </span>
              )}
              {isTtsSupported() && (
                <button
                  type="button"
                  className="sp-btn-icon"
                  style={{ width: 22, height: 22 }}
                  title="朗读"
                  aria-label={`朗读 ${contexts[0].card.entry.word}`}
                  onClick={() => onSpeak(contexts[0].card.entry.word)}
                >
                  <Volume2 size={13} />
                </button>
              )}
            </div>
            <small className="learning-group-count">{contexts.length} 条语境</small>
          </div>

          <div className="learning-group-list">
            {contexts.map(r => (
              <button
                key={r.id}
                type="button"
                className={`sp-history-item learning-context-item ${selected?.id === r.id ? 'is-selected' : ''}`}
                onClick={() => {
                  setSelected(r)
                  setEdits(r.edits ?? {})
                  setStatus('')
                  setTimeout(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 30)
                }}
              >
                <div className={`learning-item-def ${maskMeanings ? 'is-masked' : ''}`}>
                  {r.edits?.definition ?? r.card.entry.definition}
                </div>
                <div className="learning-item-sentence">{r.card.sentence}</div>
                {r.edits?.note && <div className="learning-item-note">笔记：{r.edits.note}</div>}
              </button>
            ))}
          </div>
        </section>
      ))}
    </section>
  )
}
