import { ExternalLink, Inbox, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { contextKey } from '@/lib/learning'
import { sendMessage } from '@/lib/messaging'
import type { CapturedCard, Settings } from '@/lib/types'
import { HelpTip } from '../components/HelpTip'
import { Section } from '../components/Section'
import { StatusChip, Switch } from '../components/controls'
import type { SectionProps, Status } from './types'

interface AnkiSectionProps extends SectionProps {
  /** 探测结果要回传给侧边栏的状态徽章 */
  onAliveChange: (alive: boolean) => void
}

function formatTime(ms: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function AnkiSection({ s, onChange, connectionsDirty, onAliveChange }: AnkiSectionProps) {
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [queue, setQueue] = useState<CapturedCard[]>([])
  const [queueStatus, setQueueStatus] = useState<Status>({ kind: 'idle' })
  const [showConfirmClearQueue, setShowConfirmClearQueue] = useState(false)

  const ankiEnabled = s.anki.enabled !== false
  const currentConfig = useRef('')
  currentConfig.current = JSON.stringify(s.anki)

  const patchAnki = (part: Partial<Settings['anki']>) => {
    setStatus({ kind: 'idle' })
    onChange({ ...s, anki: { ...s.anki, ...part } })
  }

  const refreshIntegrations = () => {
    void sendMessage({ type: 'pending-list' }).then((res) => {
      if (res.ok) setQueue(res.data.cards)
    })
  }

  useEffect(refreshIntegrations, [])

  const onTest = async () => {
    const requestedConfig = currentConfig.current
    setStatus({ kind: 'busy' })
    const res = await sendMessage({ type: 'check-anki', payload: { settings: s } })
    if (requestedConfig !== currentConfig.current) return
    if (!res || !res.ok) {
      onAliveChange(false)
      setStatus({ kind: 'err', text: res?.error ?? '扩展后台未响应，请重新加载扩展后再试。' })
      return
    }
    onAliveChange(true)

    setStatus({ kind: 'ok', text: `已连接 Anki（AnkiConnect v${res.data.version}）。` })
  }

  const onFlush = async () => {
    if (connectionsDirty) { setQueueStatus({ kind: 'err', text: '请先保存连接配置。' }); return }
    setQueueStatus({ kind: 'busy' })
    const res = await sendMessage({ type: 'flush-pending' })
    if (!res.ok) {
      setQueueStatus({ kind: 'err', text: res.error })
      return
    }

    const { written, dropped, remaining } = res.data
    refreshIntegrations()
    setQueueStatus(remaining > 0
      ? { kind: 'err', text: `已同步 ${written} 张卡片，仍有 ${remaining} 张待同步。请确认 Anki 正在运行后重试。` }
      : { kind: 'ok', text: `已同步 ${written} 张卡片${dropped > 0 ? `，已跳过 ${dropped} 张重复卡片` : ''}。` })
  }

  const onRemove = async (card: CapturedCard) => {
    const res = await sendMessage({ type: 'remove-pending', payload: {
      word: card.entry.word,
      contextKey: contextKey(card),
      recordId: card.recordId,
    } })
    if (res.ok) refreshIntegrations()
  }

  const onClearQueue = async () => {
    setShowConfirmClearQueue(false)
    setQueueStatus({ kind: 'busy' })
    const res = await sendMessage({ type: 'clear-pending' })
    if (res.ok) {
      refreshIntegrations()
      setQueueStatus({ kind: 'ok', text: '待同步队列已清空，生词库中的收藏已保留。' })
    } else {
      setQueueStatus({ kind: 'err', text: res.error })
    }
  }

  return (
    <Section
      id="sec-anki"
      index={4}
      title="Anki 制卡（可选）"
      intro="将收藏制作成 Anki 复习卡片。先安装 AnkiConnect，并保持 Anki 桌面版运行，再测试连接。"
    >
      {/* ── Anki 制卡拓展 ── */}
      <div className="block">
        <div className="block-head">
          <strong>将收藏同步到 Anki</strong>
          <HelpTip title="如何配置 AnkiConnect 插件？">
            <ol>
              <li>打开 <a href="https://apps.ankiweb.net/" target="_blank" rel="noreferrer">Anki 桌面版</a>；</li>
              <li>点击菜单栏「工具」→「附加组件」→「获取附加组件」；</li>
              <li>填入插件代码 <strong>2055492159</strong> 安装并重启 Anki。</li>
            </ol>
            <div className="help-tip-links">
              <a href="https://foosoft.net/projects/anki-connect/" target="_blank" rel="noreferrer">
                <span>AnkiConnect 项目说明</span>
                <ExternalLink size={11} />
              </a>
            </div>
          </HelpTip>
        </div>
        <p className="block-hint">
          开启后，收藏会生成语境填空、看词识义、看义写词和听音辨词卡片。不使用 Anki 也可以正常查词和收藏。
        </p>

        <div className="field" style={{ marginTop: 14 }}>
          <span>启用 Anki 同步</span>
          <div className="field-inline">
            <Switch
              checked={ankiEnabled}
              onChange={enabled => patchAnki({ enabled })}
            />
            <span className="field-inline-label">
              {ankiEnabled ? '收藏时发送到 Anki，连接失败的卡片会暂存到下方。' : '关闭后，收藏仍保存在生词库。'}
            </span>
          </div>
        </div>

        {ankiEnabled && (
          <>
            <label className="field" style={{ marginTop: 12 }}>
              <span>AnkiConnect 地址</span>
              <input value={s.anki.url} onChange={e => patchAnki({ url: e.target.value })} />
            </label>
            <p className="hint">本机默认地址为 <code>http://127.0.0.1:8765</code>。需先在 Anki 中安装 AnkiConnect。</p>

            <label className="field" style={{ marginTop: 12 }}>
              <span>目标牌组</span>
              <input value={s.anki.deckName} onChange={e => patchAnki({ deckName: e.target.value })} />
            </label>
            <p className="hint">不存在时会自动创建主牌组及四个子牌组。</p>

            <label className="field" style={{ marginTop: 12 }}>
              <span>笔记类型</span>
              <input
                value={s.anki.noteTypeName}
                onChange={e => patchAnki({ noteTypeName: e.target.value })}
              />
            </label>

            <div className="field" style={{ marginTop: 12 }}>
              <span>原句挖空</span>
              <div className="field-inline">
                <Switch
                  checked={s.anki.clozeContext}
                  onChange={clozeContext => patchAnki({ clozeContext })}
                />
                <span className="field-inline-label">在卡片正面将原句中的目标词替换为填空</span>
              </div>
            </div>

            <div className="row" style={{ marginTop: 16 }}>
              <button className="btn" onClick={() => void onTest()} disabled={status.kind === 'busy'}>
                {status.kind === 'busy' ? '正在测试…' : '测试 Anki 连接'}
              </button>
            </div>
            {connectionsDirty && <p className="hint">可先测试连接；点击「保存配置」后，这些设置才会用于制卡。</p>}

            {status.kind === 'ok' && <p className="ok">{status.text}</p>}
            {status.kind === 'err' && (
              <div className="err">
                <p>{status.text}</p>
                <details>
                  <summary>连接排查步骤</summary>
                  <ol>
                    <li>确认 Anki 桌面版正在运行。</li>
                    <li>在 Anki「工具 → 附加组件」中确认已安装 AnkiConnect（代码 <code>2055492159</code>）。</li>
                    <li>检查上方地址。若错误提示来源未获允许，请按 AnkiConnect 项目说明授权当前扩展来源。</li>
                  </ol>
                </details>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Anki 待同步队列 ── */}
      {(ankiEnabled || queue.length > 0) && (
        <div className="block">
          <div className="block-head">
            <Inbox size={14} className="inline-icon" />
            <strong>待同步到 Anki 的卡片</strong>
            {queue.length > 0 && <span className="chip">{queue.length}</span>}
          </div>
          <p className="block-hint">
            这些收藏已保存在生词库。打开 Anki 后，点击「立即同步到 Anki」重试；移出或清空队列只会取消发送任务。
          </p>

          {queue.length === 0
            ? <p className="empty">当前没有待同步至 Anki 的卡片。</p>
            : (
                <>
                  <ul className="queue-list">
                    {queue.map(card => (
                      <li key={contextKey(card)}>
                        <div className="queue-item">
                          <span className="queue-word">{card.entry.word}</span>
                          <span className="queue-def">{card.entry.definition}</span>
                        </div>
                        <span className="queue-time">{formatTime(card.createdAt)}</span>
                        <button
                          type="button"
                          className="btn btn-icon btn-danger"
                          title={`移出待同步队列（保留在本地生词库）`}
                          onClick={() => void onRemove(card)}
                        >
                          <Trash2 size={13} />
                        </button>
                      </li>
                    ))}
                  </ul>

                  <div className="block-actions">
                    <button
                      className="btn"
                      disabled={!ankiEnabled || queueStatus.kind === 'busy'}
                      onClick={() => void onFlush()}
                    >
                      {queueStatus.kind === 'busy' ? '正在同步…' : '立即同步到 Anki'}
                    </button>
                    <button className="btn" disabled={queueStatus.kind === 'busy'} onClick={() => setShowConfirmClearQueue(true)}>清空待同步队列</button>
                  </div>
                  {!ankiEnabled && <p className="hint">开启并保存 Anki 配置后，可继续同步这些卡片。</p>}
                  {showConfirmClearQueue && <div className="result">
                    <p>清空后，这些卡片将不再发送到 Anki。生词库中的收藏会保留。</p>
                    <div className="block-actions">
                      <button className="btn btn-danger" disabled={queueStatus.kind === 'busy'} onClick={() => void onClearQueue()}>确认清空队列</button>
                      <button className="btn" onClick={() => setShowConfirmClearQueue(false)}>取消</button>
                    </div>
                  </div>}
                </>
              )}

          {queueStatus.kind === 'ok' && <p className="ok">{queueStatus.text}</p>}
          {queueStatus.kind === 'err' && <p className="err">{queueStatus.text}</p>}
        </div>
      )}
    </Section>
  )
}
