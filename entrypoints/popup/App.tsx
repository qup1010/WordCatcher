import { Check, Inbox, LoaderCircle, PanelRight, Settings2, Trash2, Volume2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { browser } from '#imports'
import type { MtProvider } from '@/lib/machine-translate'
import { MT_PROVIDER_LABELS } from '@/lib/machine-translate'
import { sendMessage } from '@/lib/messaging'
import type { DictMeta } from '@/lib/open-dict/types'
import {
  activeAiProfile,
  getSettings,
  isAiConfigured,
  saveSettings,
  watchSettings,
} from '@/lib/settings'
import { isTtsSupported, speak } from '@/lib/tts'
import { navigateTabs } from '@/lib/ui-keyboard'
import { DEFAULT_SETTINGS, type HistoryItem, type Settings } from '@/lib/types'
import './App.css'

type Probe = { kind: 'checking' } | { kind: 'ok', version: number } | { kind: 'err' }

type Flush = { kind: 'idle' } | { kind: 'busy' } | { kind: 'done', text: string }
type HistoryFeedback = { kind: 'ok' | 'err', text: string } | null

const MT_PROVIDERS: MtProvider[] = ['microsoft', 'google']

export default function App() {
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [tab, setTab] = useState<'status' | 'history'>('status')
  const [historyList, setHistoryList] = useState<HistoryItem[]>([])
  const [anki, setAnki] = useState<Probe>({ kind: 'checking' })
  const [dictMeta, setDictMeta] = useState<DictMeta>({
    status: 'uninstalled',
    entryCount: 0,
    updatedAt: 0,
  })
  const [saveError, setSaveError] = useState<string | null>(null)
  const [pending, setPending] = useState(0)
  const [flush, setFlush] = useState<Flush>({ kind: 'idle' })
  const [historyBusy, setHistoryBusy] = useState<string | null>(null)
  const [historyFeedback, setHistoryFeedback] = useState<HistoryFeedback>(null)
  const [confirmClear, setConfirmClear] = useState(false)

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true)
    const res = await sendMessage({ type: 'history-list' })
    if (res.ok) {
      setHistoryList(res.data)
      setHistoryError(null)
    } else {
      setHistoryError(res.error)
    }
    setHistoryLoading(false)
  }, [])

  useEffect(() => {
    void getSettings().then((v) => {
      setS(v)
      setLoaded(true)
    }).catch(() => setLoadError(true))
    const stop = watchSettings(setS)
    void sendMessage({ type: 'check-anki' }).then(res =>
      setAnki(res.ok ? { kind: 'ok', version: res.data.version } : { kind: 'err' }),
    )
    void sendMessage({ type: 'dict-status' }).then((res) => {
      if (res.ok) setDictMeta(res.data)
    })
    void sendMessage({ type: 'pending-count' }).then((res) => {
      if (res.ok) setPending(res.data.count)
    })
    void loadHistory()
    return stop
  }, [loadHistory])

  const onFlush = async () => {
    setFlush({ kind: 'busy' })
    const res = await sendMessage({ type: 'flush-pending' })
    if (!res.ok) {
      setFlush({ kind: 'done', text: res.error })
      return
    }

    const { written, dropped, remaining } = res.data
    setPending(remaining)
    setFlush({
      kind: 'done',
      text: remaining > 0
        ? `已同步 ${written} 张卡片，仍有 ${remaining} 张待同步。请确认 Anki 正在运行后重试。`
        : `已同步 ${written} 张卡片${dropped > 0 ? `，已跳过 ${dropped} 张重复卡片` : ''}。`,
    })
  }

  const openSidePanel = async () => {
    const res = await sendMessage({ type: 'open-sidepanel' })
    if (res.ok) {
      window.close()
    } else {
      setSaveError(res.error === 'gesture_required'
        ? '浏览器需要一次用户操作，请再点一次打开侧边栏。'
        : res.error)
    }
  }

  const onSpeakWord = (word: string) => {
    if (!isTtsSupported() || !word) return
    speak(word, {
      lang: s.tts.lang,
      rate: s.tts.rate,
      autoDetect: s.tts.autoDetect,
    })
  }

  const onSaveHistoryItem = async (item: HistoryItem) => {
    setHistoryBusy(item.id)
    setHistoryFeedback(null)
    const res = await sendMessage({
      type: 'save-card',
      payload: {
        entry: {
          word: item.word,
          reading: item.reading || '',
          partOfSpeech: item.partOfSpeech || '',
          definition: item.definition,
          contextTranslation: item.contextTranslation || '',
          memoryHook: item.memoryHook,
        },
        selection: item.selection || item.word,
        sentence: item.sentence || item.word,
        sentenceOffset: item.sentenceOffset ?? -1,
        pageUrl: item.pageUrl || '',
        pageTitle: item.pageTitle || 'Popup History',
        createdAt: Date.now(),
      },
    })
    setHistoryBusy(null)
    if (res.ok) {
      setHistoryList(list => list.map(historyItem => (
        historyItem.id === item.id ? { ...historyItem, savedLocally: true, savedToAnki: !res.data.queued } : historyItem
      )))
      if (res.data.queued && res.data.pending !== undefined) setPending(res.data.pending)
      setHistoryFeedback({
        kind: 'ok',
        text: `「${item.word}」已存入单词本。`,
      })
    } else {
      setHistoryFeedback({ kind: 'err', text: res.error })
    }
  }

  const onRemoveHistory = async (id: string) => {
    setHistoryFeedback(null)
    const res = await sendMessage({ type: 'history-remove', payload: { id } })
    if (res.ok) {
      setHistoryList(res.data)
    } else {
      setHistoryFeedback({ kind: 'err', text: res.error })
    }
  }

  const onClearHistory = async () => {
    const res = await sendMessage({ type: 'history-clear' })
    if (res.ok) {
      setHistoryList([])
      setConfirmClear(false)
      setHistoryFeedback(null)
    } else {
      setHistoryFeedback({ kind: 'err', text: res.error })
    }
  }

  const commit = useCallback((next: Settings) => {
    const prev = s
    setSaveError(null)
    setS(next)
    void saveSettings(next).catch((err: unknown) => {
      setS(prev)
      setSaveError(err instanceof Error ? err.message : '保存失败')
    })
  }, [s])

  const switchProfile = (id: string) => {
    if (id === s.ai.activeId) return
    commit({ ...s, ai: { ...s.ai, activeId: id } })
  }

  const switchMt = (provider: MtProvider) => {
    if (provider === s.mt.provider) return
    commit({ ...s, mt: { ...s.mt, provider } })
  }

  if (!loaded) {
    return (
      <div className="pop pop-blank" role={loadError ? 'alert' : 'status'}>
        <strong>{loadError ? '无法读取设置' : '正在加载…'}</strong>
        {loadError && <button type="button" className="btn" onClick={() => window.location.reload()}>重新加载</button>}
      </div>
    )
  }

  const aiReady = isAiConfigured(s)
  const active = activeAiProfile(s)
  const multiProfile = s.ai.profiles.length > 1
  const dictReady = dictMeta.status === 'ready' && dictMeta.entryCount > 0
  const ankiEnabled = s.anki.enabled !== false

  return (
    <div className="pop">
      <div className="pop-brand">
        <div className="pop-brand-left">
          <span className="pop-word">word·<em>catcher</em></span>
          <span className="pop-reading">/wɜːd ˈkætʃə/</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            type="button"
            className="pop-gear-btn"
            title="在侧边栏中打开单词本与查词"
            aria-label="在侧边栏中打开"
            onClick={() => void openSidePanel()}
          >
            <PanelRight size={15} />
          </button>
          <button
            type="button"
            className="pop-gear-btn"
            title="打开设置"
            aria-label="打开设置"
            onClick={() => void browser.runtime.openOptionsPage()}
          >
            <Settings2 size={15} />
          </button>
        </div>
      </div>

      <div className="pop-tabs" onKeyDown={navigateTabs} role="tablist" aria-label="弹窗内容">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'status'}
          tabIndex={tab === 'status' ? 0 : -1}
          className={`pop-tab ${tab === 'status' ? 'active' : ''}`}
          onClick={() => setTab('status')}
        >
          服务状态
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'history'}
          tabIndex={tab === 'history' ? 0 : -1}
          className={`pop-tab ${tab === 'history' ? 'active' : ''}`}
          onClick={() => {
            setTab('history')
            void loadHistory()
          }}
        >
          查词历史 ({historyList.length})
        </button>
      </div>

      {saveError && <p className="pop-err" role="alert">{saveError}</p>}
      {tab === 'status' ? (
        <>
          <ul className="checks">
            <li className={dictReady ? 'ok' : 'wait'}>
              <span className="dot" />
              <div className="check-body">
                <div className="check-head-row">
                  <strong>离线词典</strong>
                  <span className={`status-badge ${dictReady ? 'status-badge-ok' : 'status-badge-wait'}`}>
                    {dictReady ? '本地' : '未安装'}
                  </span>
                </div>
                <p>
                  {dictReady
                    ? `已就绪 (${dictMeta.entryCount.toLocaleString()} 词)`
                    : dictMeta.status === 'downloading'
                      ? '正在下载安装…'
                      : '可在设置中一键下载'}
                </p>
              </div>
            </li>

            <li className="ok">
              <span className="dot" />
              <div className="check-body">
                <div className="check-head-row">
                  <strong>快速翻译</strong>
                </div>
                <div className="chips" role="radiogroup" aria-label="翻译服务">
                  {MT_PROVIDERS.map(p => (
                    <button
                      key={p}
                      type="button"
                      role="radio"
                      aria-checked={p === s.mt.provider}
                      className={`chip ${p === s.mt.provider ? 'chip-on' : ''}`}
                      onClick={() => switchMt(p)}
                    >
                      {MT_PROVIDER_LABELS[p]}
                    </button>
                  ))}
                </div>
                <p>长句和词典未收录的词自动使用在线翻译。</p>
              </div>
            </li>

            <li className={aiReady ? 'ok' : 'wait'}>
              <span className="dot" />
              <div className="check-body">
                <div className="check-head-row">
                  <strong>AI 语境详解</strong>
                  <span className={`status-badge ${aiReady ? 'status-badge-ok' : 'status-badge-wait'}`}>
                    {aiReady ? '已配置' : '待配置'}
                  </span>
                </div>
                {multiProfile && (
                  <div className="chips" role="radiogroup" aria-label="AI 配置">
                    {s.ai.profiles.map(p => (
                      <button
                        key={p.id}
                        type="button"
                        role="radio"
                        aria-checked={p.id === s.ai.activeId}
                        className={`chip ${p.id === s.ai.activeId ? 'chip-on' : ''}`}
                        title={`${p.name} · ${p.model || '未填模型'}`}
                        onClick={() => switchProfile(p.id)}
                      >
                        {p.name}
                      </button>
                    ))}
                  </div>
                )}
                <p>
                  {aiReady
                    ? (multiProfile ? active.model : `${active.name} · ${active.model}`)
                    : '可在设置中配置 AI 模型'}
                </p>
              </div>
            </li>

            <li className={ankiEnabled && anki.kind === 'ok' ? 'ok' : 'wait'}>
              <span className="dot" />
              <div className="check-body">
                <div className="check-head-row">
                  <strong>Anki 外部拓展</strong>
                  <span className={`status-badge ${ankiEnabled && anki.kind === 'ok' ? 'status-badge-ok' : 'status-badge-wait'}`}>
                    {!ankiEnabled ? '已关闭' : anki.kind === 'ok' ? '已连接' : anki.kind === 'checking' ? '检测中' : '按需开启'}
                  </span>
                </div>
                <p>
                  {!ankiEnabled && '生词默认保存在内置单词本'}
                  {ankiEnabled && anki.kind === 'checking' && '正在检测本地 Anki…'}
                  {ankiEnabled && anki.kind === 'ok' && `同步至牌组「${s.anki.deckName}」`}
                  {ankiEnabled && anki.kind === 'err' && '生词保存在本地单词本；打开 Anki 可同步卡片'}
                </p>
              </div>
            </li>
          </ul>

          {ankiEnabled && pending > 0 && (
            <div className="queue">
              <div className="queue-head">
                <Inbox size={14} />
                <span>{pending} 张卡片待同步至 Anki</span>
              </div>
              <p>词条已保存在本地单词本。启动 Anki 桌面版后可批量同步。</p>
              <button
                className="btn btn-quiet"
                disabled={flush.kind === 'busy'}
                onClick={() => void onFlush()}
              >
                {flush.kind === 'busy' ? '同步中…' : '同步到 Anki'}
              </button>
            </div>
          )}

          {flush.kind === 'done' && <p className="queue-note">{flush.text}</p>}

          <div className="pop-footer">
            <button className="btn" onClick={() => void openSidePanel()}>
              <PanelRight size={13} />
              打开侧边栏（单词本与复习）
            </button>
          </div>
        </>
      ) : (
        <div className="pop-history-wrap">
          {historyError && (
            <div className="pop-history-feedback err" role="alert">
              {historyError}
              <button type="button" className="pop-history-clear-btn" onClick={() => void loadHistory()}>重新加载</button>
            </div>
          )}
          {historyLoading && <p role="status">正在加载记录…</p>}
          {historyList.length > 0 ? (
            <>
              <div className="pop-history-head-bar">
                <span>最近查过的 {historyList.length} 条记录</span>
                {!confirmClear && (
                  <button
                    type="button"
                    className="pop-history-clear-btn"
                    onClick={() => setConfirmClear(true)}
                  >
                    <Trash2 size={11} />
                    清空
                  </button>
                )}
              </div>
              {confirmClear && (
                <div className="pop-clear-confirm" role="alert">
                  <span>确定清空全部 {historyList.length} 条查词历史？</span>
                  <button type="button" onClick={() => setConfirmClear(false)}>取消</button>
                  <button type="button" className="danger" onClick={() => void onClearHistory()}>确认</button>
                </div>
              )}
              {historyFeedback && (
                <div
                  className={`pop-history-feedback ${historyFeedback.kind}`}
                  role={historyFeedback.kind === 'err' ? 'alert' : 'status'}
                >
                  {historyFeedback.text}
                </div>
              )}
              {historyList.map(item => (
                <div key={item.id} className="pop-history-item">
                  <div className="pop-history-item-top">
                    <span className="pop-history-word">{item.word}</span>
                    <div className="pop-history-actions">
                      {item.savedLocally || item.savedToAnki ? (
                        <span className="pop-badge-saved">已收藏</span>
                      ) : (
                        <button
                          type="button"
                          className="pop-btn-icon-sm"
                          title={historyBusy === item.id ? '正在保存' : '存入单词本'}
                          aria-label={`保存 ${item.word}`}
                          disabled={historyBusy !== null}
                          onClick={() => void onSaveHistoryItem(item)}
                        >
                          {historyBusy === item.id
                            ? <LoaderCircle className="pop-spin" size={12} />
                            : <Check size={12} />}
                        </button>
                      )}
                      {isTtsSupported() && (
                        <button
                          type="button"
                          className="pop-btn-icon-sm"
                          title="朗读"
                          aria-label={`朗读 ${item.word}`}
                          onClick={() => onSpeakWord(item.word)}
                        >
                          <Volume2 size={12} />
                        </button>
                      )}
                      <button
                        type="button"
                        className="pop-btn-icon-sm"
                        title="删除"
                        aria-label={`删除 ${item.word}`}
                        onClick={() => void onRemoveHistory(item.id)}
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>
                  <div className="pop-history-def">{item.definition}</div>
                </div>
              ))}
            </>
          ) : !historyLoading && !historyError ? (
            <div className="pop-empty">
              <strong>还没有查词记录</strong>
              <span>在网页中划选单词后，最近结果会出现在这里。</span>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
