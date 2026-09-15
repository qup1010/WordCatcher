import {
  AlertCircle,
  Check,
  LoaderCircle,
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
import { DEFAULT_SETTINGS, type HistoryItem, type Settings, type WordEntry } from '@/lib/types'

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
  const [tab, setTab] = useState<'current' | 'history'>('current')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [entry, setEntry] = useState<WordEntry | null>(null)
  const [historyList, setHistoryList] = useState<HistoryItem[]>([])
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'queued'>('idle')
  const [currentSentence, setCurrentSentence] = useState<string>('')
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

  useEffect(() => {
    void getSettings().then(setS)
    const stopWatch = watchSettings(setS)
    void refreshHistory()

    // 监听来自扩展内部的消息（例如内容脚本划词广播）
    const onMessage = (msg: unknown) => {
      const m = msg as { type?: string, payload?: { word: string, sentence?: string } }
      if (m?.type === 'sidepanel-sync-word' && m.payload?.word) {
        setQuery(m.payload.word)
        setCurrentSentence(m.payload.sentence || '')
        void doLookup(m.payload.word, m.payload.sentence)
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
  }, [refreshHistory])

  const doLookup = async (text: string, sentence?: string) => {
    const w = text.trim()
    if (!w) return
    const sequence = ++lookupSequence.current
    cancelStream.current?.()
    cancelStream.current = null
    setLoading(true)
    setLookupError(null)
    setSaveError(null)
    setSaveState('idle')
    setTab('current')
    setEntry(null)
    // 手动查询必须清掉上一次从网页同步来的语境，避免存卡时串句。
    setCurrentSentence(sentence ?? '')

    // 先走快速翻译与本地词典
    const res = await sendMessage({
      type: 'quick-translate',
      payload: {
        text: w,
        context: sentence ? { sentence } : undefined,
      },
    })

    if (sequence !== lookupSequence.current) return
    setLoading(false)

    if (res.ok) {
      if (res.data.mode === 'dict') {
        const d = res.data.dict
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
  }

  const doAiLookup = () => {
    const w = (entry?.word || query).trim()
    if (!w) return
    const sequence = ++lookupSequence.current
    cancelStream.current?.()
    setLoading(true)
    setLookupError(null)
    setSaveError(null)
    setSaveState('idle')

    cancelStream.current = openEntryStream(
      { selection: w, sentence: currentSentence || w },
      {
        onPartial: (p) => {
          if (sequence !== lookupSequence.current) return
          setEntry(prev => ({
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
          setLookupError(message)
        },
      },
    )
  }

  const onSave = async () => {
    if (!entry) return
    setSaveError(null)
    setSaveState('saving')
    const res = await sendMessage({
      type: 'save-card',
      payload: {
        entry,
        selection: entry.word,
        sentence: currentSentence || entry.word,
        sentenceOffset: 0,
        pageUrl: 'sidepanel',
        pageTitle: 'SidePanel Lookup',
        createdAt: Date.now(),
      },
    })

    if (res.ok) {
      setSaveState(res.data.queued ? 'queued' : 'saved')
      void refreshHistory()
    } else {
      setSaveState('idle')
      setSaveError(res.error)
    }
  }

  const onSpeak = (text: string) => {
    if (!isTtsSupported() || !text) return
    speak(text, {
      lang: s.tts.lang,
      rate: s.tts.rate,
      autoDetect: s.tts.autoDetect,
    })
  }

  const onSelectHistory = (item: HistoryItem) => {
    setEntry({
      word: item.word,
      reading: item.reading || '',
      partOfSpeech: '',
      definition: item.definition,
      contextTranslation: '',
    })
    setCurrentSentence(item.sentence || '')
    setQuery(item.word)
    setSaveState(item.savedToAnki ? 'saved' : 'idle')
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
            void doLookup(query)
          }}
        >
          <div className="sp-search-input-wrap">
            <Search size={14} className="sp-search-icon" />
            <label className="sp-sr-only" htmlFor="sidepanel-search">查询单词或短语</label>
            <input
              id="sidepanel-search"
              ref={searchInputRef}
              type="text"
              className="sp-search-input"
              placeholder="输入单词或短语查词..."
              value={query}
              onChange={e => setQuery(e.target.value)}
              aria-keyshortcuts="/"
            />
            {!query && <kbd className="sp-search-shortcut" aria-hidden>/</kbd>}
          </div>
          <button type="submit" className="sp-search-btn" disabled={loading || !query.trim()}>
            {loading && <LoaderCircle className="sp-spin" size={13} />}
            {loading ? '查询中' : '查询'}
          </button>
        </form>

        <div className="sp-nav-tabs" role="tablist" aria-label="侧边栏内容">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'current'}
            className={`sp-tab ${tab === 'current' ? 'active' : ''}`}
            onClick={() => setTab('current')}
          >
            当前词条
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'history'}
            className={`sp-tab ${tab === 'history' ? 'active' : ''}`}
            onClick={() => {
              setTab('history')
              void refreshHistory()
            }}
          >
            查词历史 ({historyList.length})
          </button>
        </div>
      </header>

      <main className="sp-content">
        {tab === 'current' ? (
          entry ? (
            <div className="sp-card" aria-busy={loading}>
              <div className="sp-card-head">
                <div className="sp-card-word-wrap">
                  <span className="sp-card-word">{entry.word}</span>
                  {entry.reading && <span className="sp-card-reading">/{entry.reading}/</span>}
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
                  {entry.partOfSpeech && <span className="sp-card-pos">{entry.partOfSpeech}</span>}
                </div>
              </div>

              <div className="sp-card-def">{entry.definition}</div>

              {entry.memoryHook && (
                <div className="sp-hook">
                  💡 记忆线索：{entry.memoryHook}
                </div>
              )}

              {currentSentence && (
                <div className="sp-sentence-box">
                  <div>{currentSentence}</div>
                  {entry.contextTranslation && (
                    <div className="sp-sentence-trans">{entry.contextTranslation}</div>
                  )}
                </div>
              )}

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
                  disabled={saveState !== 'idle'}
                  onClick={() => void onSave()}
                >
                  {saveState === 'saving' && '保存中...'}
                  {saveState === 'saved' && (
                    <>
                      <Check size={13} />
                      已存入 Anki
                    </>
                  )}
                  {saveState === 'queued' && (
                    <>
                      <Check size={13} />
                      已排队暂存
                    </>
                  )}
                  {saveState === 'idle' && '存入 Anki'}
                </button>

                <button
                  type="button"
                  className="sp-btn-subtle"
                  title="使用 AI 模型结合语境详解"
                  disabled={loading}
                  onClick={doAiLookup}
                >
                  <Sparkles size={13} />
                  AI 释义
                </button>
              </div>
              {saveError && <div className="sp-inline-error" role="alert"><AlertCircle size={14} /><span>{saveError}</span></div>}
            </div>
          ) : loading ? (
            <div className="sp-state" role="status">
              <LoaderCircle className="sp-spin" size={20} />
              <strong>正在查询「{query.trim()}」</strong>
              <span>会优先使用本地词典，再自动补充翻译结果。</span>
            </div>
          ) : lookupError ? (
            <div className="sp-state sp-state-error" role="alert">
              <AlertCircle size={20} />
              <strong>这次没有查到结果</strong>
              <span>{lookupError}</span>
              <div className="sp-state-actions">
                <button type="button" className="sp-btn-save" onClick={() => void doLookup(query, currentSentence || undefined)}>重试</button>
                <button type="button" className="sp-btn-subtle" onClick={() => void browser.runtime.openOptionsPage()}>检查设置</button>
              </div>
            </div>
          ) : (
            <div className="sp-state">
              <Search size={20} />
              <strong>查一个正在阅读的词</strong>
              <span>在上方输入单词，或在网页中划词后打开侧边栏。按 <kbd>/</kbd> 可快速聚焦搜索框。</span>
            </div>
          )
        ) : (
          <div className="sp-history-wrap">
            {historyList.length > 0 ? (
              <>
                <div className="sp-history-toolbar">
                  {confirmClear ? (
                    <div className="sp-clear-confirm" role="alert">
                      <span>清空全部 {historyList.length} 条记录？</span>
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
                {historyError && <div className="sp-inline-error sp-history-error" role="alert"><AlertCircle size={14} /><span>{historyError}</span></div>}
                <div className="sp-history-list">
                  {historyList.map(item => (
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
                          {item.savedToAnki && (
                            <span className="sp-history-badge-ok">已入 Anki</span>
                          )}
                          <span className="sp-history-time">{formatRelativeTime(item.timestamp)}</span>
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
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="sp-state">
                <Search size={20} />
                <strong>还没有查词记录</strong>
                <span>查询过的词会保存在这里，方便再次查看和存入 Anki。</span>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
