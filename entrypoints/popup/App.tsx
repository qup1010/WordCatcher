import { Inbox } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { browser } from '#imports'
import type { MtProvider } from '@/lib/machine-translate'
import { MT_PROVIDER_LABELS } from '@/lib/machine-translate'
import { sendMessage } from '@/lib/messaging'
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
        // 还有剩说明写到一半 Anki 又断了，别报成"成功"
        ? `写入 ${written} 张，还剩 ${remaining} 张没写进去，确认 Anki 在运行后再试。`
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

  return (
    <div className="pop">
      <div className="pop-brand">
        <span className="pop-word">word·<em>catcher</em></span>
        <span className="pop-pos">n.</span>
      </div>

      <ul className="checks">
        <li className={aiReady ? 'ok' : 'bad'}>
          <span className="dot" />
          <div className="check-body">
            <strong>AI 接口</strong>
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
                : '还没填 API key'}
            </p>
          </div>
        </li>

        <li className="ok">
          <span className="dot" />
          <div className="check-body">
            <strong>快速翻译</strong>
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
            <p>连不上时自动切到另一家。</p>
          </div>
        </li>

        <li className={anki.kind === 'ok' ? 'ok' : anki.kind === 'checking' ? 'wait' : 'bad'}>
          <span className="dot" />
          <div className="check-body">
            <strong>Anki</strong>
            <p>
              {anki.kind === 'checking' && '检测中…'}
              {anki.kind === 'ok' && `已连接 · 牌组「${s.anki.deckName}」`}
              {anki.kind === 'err' && '未连接，请打开 Anki 桌面版'}
            </p>
          </div>
        </li>
      </ul>

      {pending > 0 && (
        <div className="queue">
          <div className="queue-head">
            <Inbox size={14} />
            <span>{pending} 张卡等着写入</span>
          </div>
          <p>Anki 没开的时候存的词都在这儿，开着 Anki 点一下就补写进去。</p>
          <button
            className="btn btn-quiet"
            disabled={flush.kind === 'busy'}
            onClick={() => void onFlush()}
          >
            {flush.kind === 'busy' ? '写入中…' : '现在补写'}
          </button>
        </div>
      )}

      {flush.kind === 'done' && <p className="queue-note">{flush.text}</p>}

      {saveError && <p className="pop-err">{saveError}</p>}

      {!(aiReady && anki.kind === 'ok') && (
        <p className="tip">快速翻译无需配置；AI 详解与存卡需要完成上述设置。</p>
      )}

      <button className="btn" onClick={() => void browser.runtime.openOptionsPage()}>
        打开设置
      </button>
    </div>
  )
}
