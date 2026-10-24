import { ContextBlock, isSentenceSelection } from '@/lib/components/ContextBlock'
import { LearningDetails, LearningEditor } from '@/lib/components/LearningDetails'
import { LearningLibrary } from '@/lib/components/LearningLibrary'
import { DictionaryView } from '@/lib/components/DictionaryView'
import { resolveOffset } from '@/lib/anki'
import type { QuickDictResult } from '@/lib/open-dict/types'
import {
  AlertCircle,
  BookOpen,
  Check,
  Copy,
  ExternalLink,
  LoaderCircle,
  Pencil,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  Volume2,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { browser } from '#imports'
import { openEntryStream, sendMessage } from '@/lib/messaging'
import { getSettings, watchSettings } from '@/lib/settings'
import { isTtsSupported, speak } from '@/lib/tts'
import { navigateTabs } from '@/lib/ui-keyboard'
import { DEFAULT_SETTINGS, type HistoryItem, type Settings, type WordEntry, type LearningEdits, type LearningRecord } from '@/lib/types'

interface SourceContextMeta {
  selection: string
  sentenceOffset: number
  pageUrl: string
  pageTitle: string
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  return `${days} 天前`
}

export default function App() {
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS)
  const [tab, setTab] = useState<'current' | 'history' | 'library'>('current')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [dictionary, setDictionary] = useState<QuickDictResult | null>(null)
  const [entry, setEntry] = useState<WordEntry | null>(null)
  const [historyList, setHistoryList] = useState<HistoryItem[]>([])
  const [historyFilter, setHistoryFilter] = useState('')
  const [libraryCount, setLibraryCount] = useState(0)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'queued'>('idle')
  const [edits, setEdits] = useState<LearningEdits>({})
  const [undoReceipt, setUndoReceipt] = useState<{ id: string, sequence: number } | null>(null)
  const [undoBusy, setUndoBusy] = useState(false)
  const [undoMessage, setUndoMessage] = useState('')
  const [savedContext, setSavedContext] = useState<string | undefined>()
  const [currentSentence, setCurrentSentence] = useState<string>('')
  const [editingSentence, setEditingSentence] = useState(false)
  const [copied, setCopied] = useState(false)
  const [sourceMeta, setSourceMeta] = useState<SourceContextMeta | null>(null)
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const lookupSequence = useRef(0)
  const cancelStream = useRef<(() => void) | null>(null)

  const refreshHistory = useCallback(async () => {
    const res = await sendMessage({ type: 'history-list' })
    if (res.ok) {
      setHistoryList(res.data)
      setHistoryError(null)
    } else {
      setHistoryError(res.error)
    }
  }, [])

  const refreshLibraryCount = useCallback(async () => {
    const res = await sendMessage({ type: 'library-list' })
    if (res?.ok && Array.isArray(res.data)) {
      setLibraryCount(res.data.length)
    }
  }, [])

  const doLookup = useCallback(async (
    text: string,
    sentence?: string,
    meta?: Partial<SourceContextMeta>,
  ) => {
    const w = text.trim()
    if (!w) return
    const sequence = ++lookupSequence.current
    cancelStream.current?.()
    cancelStream.current = null
    setLoading(true)
    setLookupError(null)
    setSaveError(null)
    setUndoMessage('')
    setUndoReceipt(null)
    setSaveState('idle')
    setDictionary(null)
    setTab('current')
    setEntry(null)
    setCurrentSentence(sentence ?? '')
    setEditingSentence(false)
    setEdits({})
    setSavedContext(undefined)
    setSourceMeta({
      selection: meta?.selection || w,
      sentenceOffset: meta?.sentenceOffset ?? -1,
      pageUrl: meta?.pageUrl || '',
      pageTitle: meta?.pageTitle || '',
    })

    const res = await sendMessage({
      type: 'quick-translate',
      payload: {
        text: w,
        context: sentence
          ? {
              sentence,
              sentenceOffset: meta?.sentenceOffset,
              pageUrl: meta?.pageUrl,
              pageTitle: meta?.pageTitle,
            }
          : undefined,
      },
    })

    if (sequence !== lookupSequence.current) return
    setLoading(false)

    if (res.ok) {
      if (res.data.mode === 'dict') {
        const d = res.data.dict
        setDictionary(d)
        setEntry({
          word: d.headword,
          reading: d.reading || '',
          partOfSpeech: d.primaryPos || '',
          definition: d.coreMeanings.join('； '),
          contextTranslation: '',
          memoryHook: d.memoryHook,
        })
      } else {
        const mt = res.data
        const def = mt.dictionary && mt.dictionary.length > 0
          ? mt.dictionary.map(item => `${item.pos} ${item.meanings.join('； ')}`).join(' / ')
          : mt.translation
        setEntry({
          word: w,
          reading: '',
          partOfSpeech: mt.dictionary?.[0]?.pos || '',
          definition: def,
          contextTranslation: '',
        })
      }
      void refreshHistory()
    } else {
      setLookupError(res.error)
    }
  }, [refreshHistory])

  useEffect(() => {
    void getSettings().then(setS)
    const stopWatch = watchSettings(setS)
    void refreshHistory()
    void refreshLibraryCount()

    // 若用户刚从网页查词卡片点击「在侧边栏中打开」，自动承接刚才正在查看的词条与语境
    void sendMessage({ type: 'sidepanel-get-active' }).then((res) => {
      if (!res?.ok || !res.data || lookupSequence.current > 0) return
      const snap = res.data
      if (snap.entry) {
        setEntry(snap.entry)
        setDictionary(snap.dict ?? null)
        setQuery(snap.entry.word || snap.selection || snap.word)
        setCurrentSentence(snap.sentence || '')
        setSourceMeta({
          selection: snap.selection || snap.word,
          sentenceOffset: snap.sentenceOffset ?? -1,
          pageUrl: snap.pageUrl || '',
          pageTitle: snap.pageTitle || '',
        })
      } else if (snap.word) {
        setQuery(snap.word)
        setCurrentSentence(snap.sentence || '')
        void doLookup(snap.word, snap.sentence || undefined, {
          selection: snap.selection || snap.word,
          sentenceOffset: snap.sentenceOffset ?? -1,
          pageUrl: snap.pageUrl || '',
          pageTitle: snap.pageTitle || '',
        })
      }
    })

    const onMessage = (msg: unknown) => {
      const m = msg as {
        type?: string
        payload?: {
          word?: string
          selection?: string
          sentence?: string
          sentenceOffset?: number
          pageUrl?: string
          pageTitle?: string
          entry?: WordEntry
          queued?: boolean
        }
      }
      if (m?.type === 'sidepanel-sync-word' && m.payload?.word) {
        setQuery(m.payload.word)
        setCurrentSentence(m.payload.sentence || '')
        void doLookup(m.payload.word, m.payload.sentence, {
          selection: m.payload.selection || m.payload.word,
          sentenceOffset: m.payload.sentenceOffset ?? -1,
          pageUrl: m.payload.pageUrl || '',
          pageTitle: m.payload.pageTitle || '',
        })
      } else if (m?.type === 'sidepanel-sync-entry' && m.payload?.entry) {
        ++lookupSequence.current
        cancelStream.current?.()
        cancelStream.current = null
        setLoading(false)
        setLookupError(null)
        setDictionary(null)
        setEntry(m.payload.entry)
        setEdits({})
        setSavedContext(undefined)
        setUndoMessage('')
        setUndoReceipt(null)
        setSaveState('idle')
        setSaveError(null)
        setQuery(m.payload.entry.word || m.payload.selection || '')
        setCurrentSentence(m.payload.sentence || '')
        setEditingSentence(false)
        setSourceMeta({
          selection: m.payload.selection || m.payload.entry.word,
          sentenceOffset: m.payload.sentenceOffset ?? -1,
          pageUrl: m.payload.pageUrl || '',
          pageTitle: m.payload.pageTitle || '',
        })
        setTab('current')
        void refreshHistory()
      } else if (m?.type === 'sidepanel-sync-saved' && m.payload?.word) {
        setSaveState(m.payload.queued ? 'queued' : 'saved')
        void refreshHistory()
        void refreshLibraryCount()
      }
    }
    browser.runtime.onMessage.addListener(onMessage)

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const isEditing = target?.matches('input, textarea, select, [contenteditable="true"]')
      if (event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey && !isEditing) {
        event.preventDefault()
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
      }
    }
    document.addEventListener('keydown', onKeyDown)

    return () => {
      cancelStream.current?.()
      stopWatch()
      browser.runtime.onMessage.removeListener(onMessage)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [refreshHistory, refreshLibraryCount, doLookup])

  const doAiLookup = () => {
    const w = (sourceMeta?.selection || entry?.word || query).trim()
    if (!w) return
    const sequence = ++lookupSequence.current
    cancelStream.current?.()
    setLoading(true)
    setLookupError(null)
    setSaveError(null)
    setUndoMessage('')
    setUndoReceipt(null)
    setSaveState('idle')
    setDictionary(null)

    const sentenceForAi = currentSentence.trim() || w
    const offsetForAi = resolveOffset(sentenceForAi, w, sourceMeta?.sentenceOffset ?? -1)

    cancelStream.current = openEntryStream(
      {
        selection: w,
        bypassCache: true,
        sentence: sentenceForAi,
        sentenceOffset: offsetForAi,
        pageUrl: sourceMeta?.pageUrl,
        pageTitle: sourceMeta?.pageTitle,
      },
      {
        onPartial: (p) => {
          if (sequence !== lookupSequence.current) return
          setEntry(prev => ({
            ...prev,
            ...p,
            word: p.word || w,
            reading: p.reading || prev?.reading || '',
            partOfSpeech: p.partOfSpeech || prev?.partOfSpeech || '',
            definition: p.definition || prev?.definition || '',
            contextTranslation: p.contextTranslation || prev?.contextTranslation || '',
            memoryHook: p.memoryHook || prev?.memoryHook,
          }))
        },
        onDone: (doneEntry) => {
          if (sequence !== lookupSequence.current) return
          cancelStream.current = null
          setEntry(doneEntry)
          setLoading(false)
          void refreshHistory()
        },
        onError: (message) => {
          if (sequence !== lookupSequence.current) return
          cancelStream.current = null
          setLoading(false)
          setEntry(null)
          setLookupError(message)
        },
      },
    )
  }

  const onSave = async () => {
    if (!entry || loading || lookupError || saveState !== 'idle') return
    const sequence = lookupSequence.current
    setSaveError(null)
    setUndoReceipt(null)
    setUndoMessage('')
    setSaveState('saving')
    const selectionText = sourceMeta?.selection || entry.word
    const sentenceText = currentSentence.trim() || selectionText
    const offset = resolveOffset(sentenceText, selectionText, sourceMeta?.sentenceOffset ?? -1)

    const res = await sendMessage({
      type: 'save-card',
      payload: {
        entry,
        selection: selectionText,
        sentence: sentenceText,
        sentenceOffset: offset,
        pageUrl: sourceMeta?.pageUrl || '',
        pageTitle: sourceMeta?.pageTitle || 'SidePanel Lookup',
        edits,
        updateExisting: Boolean(savedContext),
        createdAt: Date.now(),
      },
    })

    if (sequence !== lookupSequence.current) return
    if (res.ok) {
      setUndoReceipt(res.data.undoId ? { id: res.data.undoId, sequence } : null)
      setSavedContext(res.data.recordId)
      setSaveState(res.data.queued ? 'queued' : 'saved')
      void refreshHistory()
      void refreshLibraryCount()
    } else {
      setUndoMessage('')
      setUndoReceipt(null)
      setSaveState('idle')
      setSaveError(res.error)
    }
  }

  const onUndoSave = async () => {
    if (!undoReceipt || undoReceipt.sequence !== lookupSequence.current || undoBusy) return
    const receipt = undoReceipt
    setUndoBusy(true)
    try {
      const res = await sendMessage({ type: 'undo-save', payload: { id: receipt.id } })
      if (receipt.sequence !== lookupSequence.current) return
      if (!res.ok) { setSaveError(res.error); return }
      setUndoReceipt(null)
      setSavedContext(undefined)
      setSaveState('idle')
      setUndoMessage('已撤销本次本地收藏')
      void refreshLibraryCount()
      void refreshHistory()
    } catch (error) { if (receipt.sequence === lookupSequence.current) setSaveError(String(error)) }
    finally { setUndoBusy(false) }
  }

  const onSpeak = (text: string) => {
    if (!isTtsSupported() || !text) return
    speak(text, {
      lang: s.tts.lang,
      rate: s.tts.rate,
      autoDetect: s.tts.autoDetect,
    })
  }

  const onCopyEntry = () => {
    if (!entry) return
    const clean = entry.reading?.replace(/^\/+|\/+$/g, '')
    const def = edits.definition ?? entry.definition
    const text = `${entry.word}${clean ? ` /${clean}/` : ''}\n${def}`
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    })
  }

  const onSelectHistory = (item: HistoryItem) => {
    ++lookupSequence.current
    cancelStream.current?.()
    cancelStream.current = null
    setLoading(false)
    setDictionary(null)
    setEntry(item.entry ?? {
      word: item.word,
      reading: item.reading || '',
      partOfSpeech: item.partOfSpeech || '',
      definition: item.definition,
      contextTranslation: item.contextTranslation || '',
      memoryHook: item.memoryHook,
    })
    setCurrentSentence(item.sentence || '')
    setEditingSentence(false)
    setSourceMeta({
      selection: item.selection || item.word,
      sentenceOffset: item.sentenceOffset ?? -1,
      pageUrl: item.pageUrl || '',
      pageTitle: item.pageTitle || '',
    })
    setQuery(item.word)
    setEdits({})
    setSavedContext(undefined)
    setUndoMessage('')
    setUndoReceipt(null)
    setSaveState('idle')
    setLookupError(null)
    setSaveError(null)
    setTab('current')
  }

  const onOpenLearning = (record: LearningRecord) => {
    ++lookupSequence.current
    cancelStream.current?.()
    setLoading(false)
    setDictionary(null)
    setEntry(record.card.entry)
    setSourceMeta({ selection: record.card.selection, sentenceOffset: record.card.sentenceOffset, pageUrl: record.card.pageUrl, pageTitle: record.card.pageTitle })
    setQuery(record.card.selection)
    setCurrentSentence(record.card.sentence)
    setEditingSentence(false)
    setEdits(record.edits ?? {})
    setSavedContext(record.id)
    setUndoMessage('')
    setUndoReceipt(null)
    setSaveState('idle')
    setLookupError(null)
    setSaveError(null)
    setTab('current')
  }

  const onRemoveHistoryItem = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    const res = await sendMessage({ type: 'history-remove', payload: { id } })
    if (res.ok) {
      setHistoryList(res.data)
      setHistoryError(null)
    } else {
      setHistoryError(res.error)
    }
  }

  const onClearHistory = async () => {
    const res = await sendMessage({ type: 'history-clear' })
    if (res.ok) {
      setHistoryList([])
      setHistoryError(null)
      setConfirmClear(false)
    } else {
      setHistoryError(res.error)
    }
  }

  const sentenceMode = entry?.inputKind === 'sentence' || isSentenceSelection(sourceMeta?.selection || entry?.word || '')
  const contextBlock = entry && (currentSentence || sentenceMode) ? (
    <ContextBlock
      key={currentSentence}
      sentence={currentSentence || sourceMeta?.selection || entry.word}
      selection={sourceMeta?.selection || entry.word}
      offset={resolveOffset(currentSentence || sourceMeta?.selection || entry.word, sourceMeta?.selection || entry.word, sourceMeta?.sentenceOffset ?? -1)}
      translation={(edits.contextTranslation ?? entry.contextTranslation)?.trim() !== (edits.definition ?? entry.definition)?.trim() ? edits.contextTranslation ?? entry.contextTranslation : undefined}
      onTranslated={(t) => {
        setEntry(prev => prev ? { ...prev, contextTranslation: t } : prev)
        setEdits(prev => ({ ...prev, contextTranslation: t }))
        setUndoMessage('')
        setUndoReceipt(null)
        setSaveState('idle')
      }}
    />
  ) : null
  const cleanReading = entry?.reading?.replace(/^\/+|\/+$/g, '')

  const filteredHistory = historyFilter.trim()
    ? historyList.filter(item =>
        item.word.toLowerCase().includes(historyFilter.toLowerCase())
        || item.definition.toLowerCase().includes(historyFilter.toLowerCase())
        || (item.sentence ?? '').toLowerCase().includes(historyFilter.toLowerCase()))
    : historyList

  return (
    <div className="sp-shell">
      <header className="sp-header">
        <div className="sp-brand-row">
          <span className="sp-brand">word·<em>catcher</em></span>
          <div className="sp-header-actions">
            <button
              type="button"
              className="sp-btn-icon"
              title="设置"
              aria-label="打开设置"
              onClick={() => void browser.runtime.openOptionsPage()}
            >
              <Settings2 size={15} />
            </button>
          </div>
        </div>

        <form
          className="sp-search-bar"
          onSubmit={(e) => {
            e.preventDefault()
            if (!loading && query.trim()) void doLookup(query)
          }}
        >
          <div className="sp-search-input-wrap">
            <Search size={14} className="sp-search-icon" />
            <label className="sp-sr-only" htmlFor="sidepanel-search">查询单词、短语或句子</label>
            <input
              id="sidepanel-search"
              ref={searchInputRef}
              type="text"
              className="sp-search-input"
              placeholder="输入单词、短语或句子"
              autoComplete="off"
              spellCheck={false}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing && event.key === 'Enter') event.preventDefault()
                if (event.key === 'Escape') {
                  event.preventDefault()
                  setQuery('')
                }
              }}
              value={query}
              onChange={e => setQuery(e.target.value)}
              aria-keyshortcuts="/"
            />
            {query && (
              <button
                type="button"
                className="sp-search-clear sp-btn-icon"
                aria-label="清空查询"
                title="清空查询（Esc）"
                onClick={() => {
                  setQuery('')
                  searchInputRef.current?.focus()
                }}
              >
                ×
              </button>
            )}
            {!query && <kbd className="sp-search-shortcut" aria-hidden>/</kbd>}
          </div>
          <button type="submit" className="sp-search-btn" disabled={loading || !query.trim()}>
            {loading && <LoaderCircle className="sp-spin" size={13} />}
            {loading ? '查询中' : '查询'}
          </button>
        </form>

        <div className="sp-nav-tabs" onKeyDown={navigateTabs} role="tablist" aria-label="侧边栏内容">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'current'}
            tabIndex={tab === 'current' ? 0 : -1}
            className={`sp-tab ${tab === 'current' ? 'active' : ''}`}
            onClick={() => setTab('current')}
          >
            当前词条
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'history'}
            tabIndex={tab === 'history' ? 0 : -1}
            className={`sp-tab ${tab === 'history' ? 'active' : ''}`}
            onClick={() => {
              setTab('history')
              void refreshHistory()
            }}
          >
            查词历史 ({historyList.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'library'}
            tabIndex={tab === 'library' ? 0 : -1}
            className={`sp-tab ${tab === 'library' ? 'active' : ''}`}
            onClick={() => {
              setTab('library')
              void refreshLibraryCount()
            }}
          >
            生词库
          </button>
        </div>
      </header>

      <main className="sp-content">
        {tab === 'library' ? <LearningLibrary onOpen={onOpenLearning} /> : tab === 'current' ? (
          entry ? (
            <div className="sp-card" aria-busy={loading}>
              <div className="sp-card-head">
                <div className="sp-card-word-wrap">
                  <span className={`sp-card-word ${sentenceMode ? 'sp-card-word-sentence' : ''}`}>{sentenceMode ? '句子翻译' : entry.word}</span>
                  {!sentenceMode && cleanReading && <span className="sp-card-reading">/{cleanReading}/</span>}
                  {isTtsSupported() && (
                    <button
                      type="button"
                      className="sp-btn-icon"
                      title="朗读"
                      aria-label={`朗读 ${entry.word}`}
                      onClick={() => onSpeak(entry.word)}
                    >
                      <Volume2 size={15} />
                    </button>
                  )}
                  <button
                    type="button"
                    className="sp-btn-icon"
                    title={copied ? '已复制到剪贴板' : '复制词条'}
                    aria-label="复制词条"
                    onClick={onCopyEntry}
                  >
                    {copied ? <Check size={14} style={{ color: 'var(--teal)' }} /> : <Copy size={14} />}
                  </button>
                  {!dictionary && !sentenceMode && entry.partOfSpeech && <span className="sp-card-pos">{entry.partOfSpeech}</span>}
                </div>
              </div>

              {dictionary ? <DictionaryView key={dictionary.headword} result={dictionary} context={contextBlock} /> : <><div className="sp-card-def">{edits.definition ?? entry.definition}</div>{contextBlock}</>}

              {/* 支持在侧边栏直接补充或微调所处原句，方便手动查词时也能结合语境生成 AI 详解和语境卡片 */}
              {!sentenceMode && (
                <div className="sp-context-editor">
                  {editingSentence ? (
                    <div className="sp-context-editor-box">
                      <label className="sp-context-editor-label">
                        <span>所处原句（用于语境解析与复习卡片）</span>
                        <textarea
                          rows={2}
                          value={currentSentence}
                          placeholder={`输入或粘贴包含「${sourceMeta?.selection || entry.word}」的原句…`}
                          onChange={(e) => {
                            setCurrentSentence(e.target.value)
                            setUndoMessage('')
                            setUndoReceipt(null)
                            setSaveState('idle')
                          }}
                        />
                      </label>
                      <div className="sp-context-editor-actions">
                        <button type="button" className="sp-btn-text" onClick={() => setEditingSentence(false)}>完成</button>
                      </div>
                    </div>
                  ) : (
                    <div className="sp-context-meta-bar">
                      <button
                        type="button"
                        className="sp-context-edit-trigger"
                        onClick={() => setEditingSentence(true)}
                      >
                        <Pencil size={11} />
                        <span>{currentSentence ? '修改语境原句' : '补充所在原句（可选）'}</span>
                      </button>
                      {sourceMeta?.pageUrl && (
                        <a
                          href={sourceMeta.pageUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="sp-source-link"
                          title={sourceMeta.pageTitle || sourceMeta.pageUrl}
                        >
                          <span>{sourceMeta.pageTitle || '来源网页'}</span>
                          <ExternalLink size={11} />
                        </a>
                      )}
                    </div>
                  )}
                </div>
              )}

              <LearningDetails entry={entry} />

              {entry.memoryHook && (
                <div className="sp-hook">
                  <strong>记忆线索</strong>
                  <div>{entry.memoryHook}</div>
                </div>
              )}

              {!loading && <LearningEditor entry={entry} sentence={currentSentence} selection={sourceMeta?.selection || entry.word} edits={edits} onChange={value => { setEdits(value); setSaveState('idle') }} />}

              {loading && (
                <div className="sp-progress" role="status">
                  <LoaderCircle className="sp-spin" size={14} />
                  正在结合语境生成更完整的释义…
                </div>
              )}

              {lookupError && (
                <div className="sp-inline-error" role="alert">
                  <AlertCircle size={14} />
                  <span>{lookupError}</span>
                </div>
              )}

              <div className="sp-card-actions">

                <button
                  type="button"
                  className="sp-btn-save"
                  disabled={loading || saveState !== 'idle'}
                  onClick={() => void onSave()}
                >
                  {saveState === 'saving' && '保存中…'}
                  {saveState === 'saved' && (
                    <>
                      <Check size={13} />
                      已存入生词库
                    </>
                  )}
                  {saveState === 'queued' && (
                    <>
                      <Check size={13} />
                      已存入生词库
                    </>
                  )}
                  {saveState === 'idle' && (saveError ? '重试保存' : savedContext ? '更新这条语境' : '存入生词库')}
                </button>

                <button
                  type="button"
                  className="sp-btn-subtle"
                  title="使用 AI 模型结合语境详解"
                  disabled={loading}
                  onClick={doAiLookup}
                >
                  <Sparkles size={13} />
                  {entry.generation ? '重新生成' : 'AI 详解'}
                </button>
              </div>
              {(undoReceipt?.sequence === lookupSequence.current || undoMessage) && <div className="sp-collection-feedback" role="status">
                <span>{undoMessage || '已存入生词库'}</span>
                {undoReceipt?.sequence === lookupSequence.current && <button type="button" className="sp-btn-subtle" disabled={undoBusy} title="撤销本次本地收藏" aria-label="撤销本地收藏" onClick={() => void onUndoSave()}>撤销</button>}
              </div>}
              {saveError && <div className="sp-inline-error" role="alert"><AlertCircle size={14} /><span>{saveError}</span></div>}
            </div>
          ) : loading ? (
            <div className="sp-state" role="status">
              <LoaderCircle className="sp-spin" size={20} />
              <strong>正在查询「{query.trim()}」</strong>
              <span>优先查询本地离线词典，未收录时自动使用在线翻译。</span>
            </div>
          ) : lookupError ? (
            <div className="sp-state sp-state-error" role="alert">
              <AlertCircle size={20} />
              <strong>查询未完成</strong>
              <span>{lookupError}</span>
              <div className="sp-state-actions">
                <button type="button" className="sp-btn-save" onClick={() => void doLookup(query, currentSentence || undefined, sourceMeta || undefined)}>重试</button>
                <button type="button" className="sp-btn-subtle" onClick={() => void browser.runtime.openOptionsPage()}>检查设置</button>
              </div>
            </div>
          ) : (
            <div className="sp-workbench">
              <div className="sp-state sp-state-compact">
                <Search size={20} />
                <strong>输入或划选词句开始查询</strong>
                <span>在网页中划选生词会自动同步到这里；也可以按 <kbd>/</kbd> 直接输入查询。</span>
              </div>

              {libraryCount > 0 && (
                <div className="sp-quick-card">
                  <div className="sp-quick-card-head">
                    <BookOpen size={14} className="sp-quick-icon" />
                    <strong>生词库已收录 {libraryCount} 条语境</strong>
                  </div>
                  <p>随时查看收藏的原句与解析，或开启卡片自测复习。</p>
                  <button
                    type="button"
                    className="sp-btn-subtle sp-btn-compact"
                    onClick={() => setTab('library')}
                  >
                    打开生词库与复习
                  </button>
                </div>
              )}

              {historyList.length > 0 && (
                <div className="sp-quick-card">
                  <div className="sp-quick-card-head">
                    <strong>最近查过</strong>
                    <button
                      type="button"
                      className="sp-btn-text"
                      onClick={() => setTab('history')}
                    >
                      查看全部
                    </button>
                  </div>
                  <div className="sp-recent-chips">
                    {historyList.slice(0, 6).map(item => (
                      <button
                        key={item.id}
                        type="button"
                        className="sp-recent-chip"
                        title={item.definition}
                        onClick={() => onSelectHistory(item)}
                      >
                        <span className="sp-recent-chip-word">{item.word}</span>
                        <span className="sp-recent-chip-def">{item.definition}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        ) : (
          <div className="sp-history-wrap">
            {historyError && (
              <div className="sp-inline-error sp-history-error" role="alert">
                <AlertCircle size={14} />
                <span>{historyError}</span>
                <button type="button" className="sp-btn-text" onClick={() => void refreshHistory()}>重试</button>
              </div>
            )}
            {historyList.length > 0 ? (
              <>
                <div className="sp-history-toolbar">
                  {historyList.length > 3 && !confirmClear && (
                    <input
                      type="text"
                      className="sp-history-filter"
                      placeholder="筛选查词历史…"
                      value={historyFilter}
                      onChange={e => setHistoryFilter(e.target.value)}
                    />
                  )}
                  {confirmClear ? (
                    <div className="sp-clear-confirm" role="alert">
                      <span>确定清空全部 {historyList.length} 条查词历史？清空后无法恢复。</span>
                      <button type="button" className="sp-btn-text" onClick={() => setConfirmClear(false)}>取消</button>
                      <button type="button" className="sp-btn-text sp-btn-text-danger" onClick={() => void onClearHistory()}>确认清空</button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="sp-btn-subtle sp-btn-compact"
                      onClick={() => setConfirmClear(true)}
                    >
                      <Trash2 size={12} />
                      清空历史
                    </button>
                  )}
                </div>
                <div className="sp-history-list">
                  {filteredHistory.map(item => (
                    <div
                      key={item.id}
                      className="sp-history-item"
                      role="button"
                      tabIndex={0}
                      onClick={() => onSelectHistory(item)}
                      onKeyDown={(event) => {
                        if (event.target !== event.currentTarget) return
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          onSelectHistory(item)
                        }
                      }}
                    >
                      <div className="sp-history-head">
                        <span className="sp-history-word">{item.word}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {(item.savedLocally || item.savedToAnki) && (
                            <span className="sp-history-badge-ok">已收藏</span>
                          )}
                          <span className="sp-history-time">{formatRelativeTime(item.timestamp)}</span>
                          {isTtsSupported() && (
                            <button
                              type="button"
                              className="sp-btn-icon"
                              style={{ width: 20, height: 20 }}
                              title="朗读"
                              aria-label={`朗读 ${item.word}`}
                              onClick={(e) => {
                                e.stopPropagation()
                                onSpeak(item.word)
                              }}
                            >
                              <Volume2 size={12} />
                            </button>
                          )}
                          <button
                            type="button"
                            className="sp-btn-icon"
                            style={{ width: 20, height: 20 }}
                            title="删除"
                            aria-label={`从历史记录删除 ${item.word}`}
                            onClick={e => void onRemoveHistoryItem(e, item.id)}
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                      <div className="sp-history-def">{item.definition}</div>
                      {item.sentence && item.sentence !== item.word && (
                        <div className="sp-history-sentence">{item.sentence}</div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            ) : !historyError ? (
              <div className="sp-state">
                <Search size={20} />
                <strong>还没有查词记录</strong>
                <span>查询过的词会保存在这里，方便再次查看和存入生词库。</span>
              </div>
            ) : null}
          </div>
        )}
      </main>
    </div>
  )
}
