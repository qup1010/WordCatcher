import {
  BookOpen,
  Check,
  Clock,
  ExternalLink,
  History,
  RotateCcw,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  Volume2,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
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

  const refreshHistory = useCallback(async () => {
    const res = await sendMessage({ type: 'history-list' })
    if (res.ok) setHistoryList(res.data)
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

    return () => {
      stopWatch()
      browser.runtime.onMessage.removeListener(onMessage)
    }
  }, [refreshHistory])

  const doLookup = async (text: string, sentence?: string) => {
    const w = text.trim()
    if (!w) return
    setLoading(true)
    setSaveState('idle')
    setTab('current')

    // 先走快速翻译与本地词典
    const res = await sendMessage({
      type: 'quick-translate',
      payload: {
        text: w,
        context: sentence ? { sentence } : undefined,
      },
    })

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
    }
  }

  const doAiLookup = () => {
    const w = (entry?.word || query).trim()
    if (!w) return
    setLoading(true)
    setSaveState('idle')

    openEntryStream(
      { selection: w, sentence: currentSentence || w },
      {
        onPartial: (p) => {
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
          setEntry(doneEntry)
          setLoading(false)
          void refreshHistory()
        },
        onError: () => {
          setLoading(false)
        },
      },
    )
  }

  const onSave = async () => {
    if (!entry) return
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
    setTab('current')
  }

  const onRemoveHistoryItem = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    const res = await sendMessage({ type: 'history-remove', payload: { id } })
    if (res.ok) setHistoryList(res.data)
  }

  const onClearHistory = async () => {
    await sendMessage({ type: 'history-clear' })
    setHistoryList([])
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
            <input
              type="text"
              className="sp-search-input"
              placeholder="输入单词或短语查词..."
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
          </div>
          <button type="submit" className="sp-search-btn" disabled={loading}>
            {loading ? '查询中' : '查询'}
          </button>
        </form>

        <div className="sp-nav-tabs">
          <button
            type="button"
            className={`sp-tab ${tab === 'current' ? 'active' : ''}`}
            onClick={() => setTab('current')}
          >
            当前词条
          </button>
          <button
            type="button"
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
            <div className="sp-card">
              <div className="sp-card-head">
                <div className="sp-card-word-wrap">
                  <span className="sp-card-word">{entry.word}</span>
                  {entry.reading && <span className="sp-card-reading">/{entry.reading}/</span>}
                  {isTtsSupported() && (
                    <button
                      type="button"
                      className="sp-btn-icon"
                      title="朗读"
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

              <div className="sp-card-actions">
                <button
                  type="button"
                  className="sp-btn-save"
                  disabled={saveState === 'saving' || saveState === 'saved'}
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
            </div>
          ) : (
            <div className="sp-empty">
              在上方输入单词查询，或在任意网页划选单词即可在此联动展示。
            </div>
          )
        ) : (
          <div className="sp-history-wrap">
            {historyList.length > 0 ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
                  <button
                    type="button"
                    className="sp-btn-subtle"
                    style={{ fontSize: 11, padding: '3px 8px' }}
                    onClick={() => void onClearHistory()}
                  >
                    <Trash2 size={12} />
                    清空历史
                  </button>
                </div>
                <div className="sp-history-list">
                  {historyList.map(item => (
                    <div
                      key={item.id}
                      className="sp-history-item"
                      onClick={() => onSelectHistory(item)}
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
              <div className="sp-empty">暂无查词历史记录</div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
