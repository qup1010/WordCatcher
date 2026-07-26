import { useEffect, useState } from 'react'
import { browser } from '#imports'
import { sendMessage } from '@/lib/messaging'
import { activeAiProfile, getSettings, isAiConfigured } from '@/lib/settings'
import { DEFAULT_SETTINGS, type Settings } from '@/lib/types'
import './App.css'

type Probe = { kind: 'checking' } | { kind: 'ok', version: number } | { kind: 'err' }

export default function App() {
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS)
  const [anki, setAnki] = useState<Probe>({ kind: 'checking' })

  useEffect(() => {
    void getSettings().then(setS)
    void sendMessage({ type: 'check-anki' }).then(res =>
      setAnki(res.ok ? { kind: 'ok', version: res.data.version } : { kind: 'err' }),
    )
  }, [])

  const aiReady = isAiConfigured(s)

  return (
    <div className="pop">
      <div className="pop-brand">
        <span className="pop-word">word·<em>catcher</em></span>
        <span className="pop-pos">n.</span>
      </div>

      <ul className="checks">
        <li className={aiReady ? 'ok' : 'bad'}>
          <span className="dot" />
          <div>
            <strong>AI 接口</strong>
            <p>{aiReady ? `${activeAiProfile(s).name} · ${activeAiProfile(s).model}` : '还没填 API key'}</p>
          </div>
        </li>

        <li className={anki.kind === 'ok' ? 'ok' : anki.kind === 'checking' ? 'wait' : 'bad'}>
          <span className="dot" />
          <div>
            <strong>Anki</strong>
            <p>
              {anki.kind === 'checking' && '检测中…'}
              {anki.kind === 'ok' && `已连接 · 牌组「${s.anki.deckName}」`}
              {anki.kind === 'err' && '未连接，请打开 Anki 桌面版'}
            </p>
          </div>
        </li>
      </ul>

      <p className="tip">
        {aiReady && anki.kind === 'ok'
          ? '一切就绪。在任意网页上划选一个词即可开始。'
          : '快速翻译随时可用；AI 详解和存卡需要先完成设置。'}
      </p>

      <button className="btn" onClick={() => void browser.runtime.openOptionsPage()}>
        打开设置
      </button>
    </div>
  )
}
