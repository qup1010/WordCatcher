import { Inbox, Settings2 } from 'lucide-react'
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
import { DEFAULT_SETTINGS, type Settings } from '@/lib/types'
import './App.css'

type Probe = { kind: 'checking' } | { kind: 'ok', version: number } | { kind: 'err' }

type Flush = { kind: 'idle' } | { kind: 'busy' } | { kind: 'done', text: string }

const MT_PROVIDERS: MtProvider[] = ['microsoft', 'google']

export default function App() {
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS)
  const [loaded, setLoaded] = useState(false)
  const [anki, setAnki] = useState<Probe>({ kind: 'checking' })
  const [dictMeta, setDictMeta] = useState<DictMeta>({
    status: 'uninstalled',
    entryCount: 0,
    updatedAt: 0,
  })
  const [saveError, setSaveError] = useState<string | null>(null)
  const [pending, setPending] = useState(0)
  const [flush, setFlush] = useState<Flush>({ kind: 'idle' })

  useEffect(() => {
    void getSettings().then((v) => {
      setS(v)
      setLoaded(true)
    })
    // 设置页可能同时开着，跟着它一起变
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
    return stop
  }, [])

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
        ? `写入 ${written} 张，还剩 ${remaining} 张，确认 Anki 在运行后再试。`
        : `写入 ${written} 张${dropped > 0 ? `，跳过 ${dropped} 张重复的` : ''}。`,
    })
  }

  /**
   * 立刻落盘，不做防抖：popup 随时可能被关掉，晚一步改动就丢了。
   * 先乐观更新界面，写失败再回滚。
   */
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

  // 读到真实配置前先不渲染，否则会闪一下默认值再跳成实际值
  if (!loaded) return <div className="pop pop-blank" />

  const aiReady = isAiConfigured(s)
  const active = activeAiProfile(s)
  const multiProfile = s.ai.profiles.length > 1
  const dictReady = dictMeta.status === 'ready' && dictMeta.entryCount > 0

  return (
    <div className="pop">
      <div className="pop-brand">
        <div className="pop-brand-left">
          <span className="pop-word">word·<em>catcher</em></span>
          <span className="pop-reading">/wɜːd ˈkætʃə/</span>
        </div>
        <button
          type="button"
          className="pop-gear-btn"
          title="打开设置"
          onClick={() => void browser.runtime.openOptionsPage()}
        >
          <Settings2 size={16} />
        </button>
      </div>

      <ul className="checks">
        {/* ── 1. AI 语境释义 ── */}
        <li className={aiReady ? 'ok' : 'bad'}>
          <span className="dot" />
          <div className="check-body">
            <div className="check-head-row">
              <strong>AI 语境释义</strong>
              <span className={`status-badge ${aiReady ? 'status-badge-ok' : 'status-badge-bad'}`}>
                {aiReady ? '已配置' : '未就绪'}
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
                : '尚未配置 API Key'}
            </p>
          </div>
        </li>

        {/* ── 2. 离线词典 ── */}
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
                  ? '正在下载安装...'
                  : '未安装（可在设置中下载）'}
            </p>
          </div>
        </li>

        {/* ── 3. 快速翻译 ── */}
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
            <p>长句或未收录词自动平滑调用。</p>
          </div>
        </li>

        {/* ── 4. Anki 单词本 ── */}
        <li className={anki.kind === 'ok' ? 'ok' : anki.kind === 'checking' ? 'wait' : 'bad'}>
          <span className="dot" />
          <div className="check-body">
            <div className="check-head-row">
              <strong>Anki 单词本</strong>
              <span className={`status-badge ${anki.kind === 'ok' ? 'status-badge-ok' : 'status-badge-bad'}`}>
                {anki.kind === 'ok' ? '已连接' : '未连接'}
              </span>
            </div>
            <p>
              {anki.kind === 'checking' && '检测中…'}
              {anki.kind === 'ok' && `牌组「${s.anki.deckName}」`}
              {anki.kind === 'err' && '未连接，请打开 Anki 桌面版'}
            </p>
          </div>
        </li>
      </ul>

      {/* ── 待写队列 ── */}
      {pending > 0 && (
        <div className="queue">
          <div className="queue-head">
            <Inbox size={14} />
            <span>{pending} 张卡片待写入 Anki</span>
          </div>
          <p>Anki 离线时保存的生词已暂存，启动 Anki 后点击补写：</p>
          <button
            className="btn btn-quiet"
            disabled={flush.kind === 'busy'}
            onClick={() => void onFlush()}
          >
            {flush.kind === 'busy' ? '写入中…' : '现在补写进 Anki'}
          </button>
        </div>
      )}

      {flush.kind === 'done' && <p className="queue-note">{flush.text}</p>}
      {saveError && <p className="pop-err">{saveError}</p>}

      <div className="pop-footer">
        <button className="btn" onClick={() => void browser.runtime.openOptionsPage()}>
          打开设置页面
        </button>
      </div>
    </div>
  )
}
