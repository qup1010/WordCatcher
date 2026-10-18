import { ExternalLink, Inbox, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
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

export function AnkiSection({ s, onChange, flush, onAliveChange }: AnkiSectionProps) {
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [queue, setQueue] = useState<CapturedCard[]>([])
  const [queueStatus, setQueueStatus] = useState<Status>({ kind: 'idle' })

  const ankiEnabled = s.anki.enabled !== false

  const patchAnki = (part: Partial<Settings['anki']>) =>
    onChange({ ...s, anki: { ...s.anki, ...part } })

  const refreshIntegrations = () => {
    void sendMessage({ type: 'pending-list' }).then((res) => {
      if (res.ok) setQueue(res.data.cards)
    })
  }

  useEffect(refreshIntegrations, [])

  const onTest = async () => {
    setStatus({ kind: 'busy' })
    await flush()

    const res = await sendMessage({ type: 'check-anki' })
    if (!res || !res.ok) {
      onAliveChange(false)
      setStatus({ kind: 'err', text: res?.error ?? '扩展后台未响应，请重新加载扩展后再试。' })
      return
    }
    onAliveChange(true)

    const sync = await sendMessage({ type: 'sync-anki-templates' })
    if (sync?.ok) {
      setStatus({
        kind: 'ok',
        text: `连接成功（AnkiConnect v${res.data.version}），四模式卡片模板已更新。`,
      })
      return
    }

    setStatus({
      kind: 'err',
      text: sync?.error
        ? `Anki 已连接（v${res.data.version}），但卡片模板更新未完成：${sync.error}`
        : `Anki 已连接（v${res.data.version}），但模板更新未响应。请重新加载扩展后再试。`,
    })
  }

  const onFlush = async () => {
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
    const res = await sendMessage({ type: 'clear-pending' })
    if (res.ok) {
      refreshIntegrations()
      setQueueStatus({ kind: 'ok', text: '待同步队列已清空。' })
    }
  }

  return (
    <Section
      id="sec-anki"
      index={5}
      title="Anki 制卡（可选）"
      intro="生词保存在单词本中，可按需制作 Anki 卡片。插件与桌面端的词库同步统一在「数据与单词本」中配置 WebDAV。"
    >
      {/* ── Anki 制卡拓展 ── */}
      <div className="block">
        <div className="block-head">
          <strong>Anki 制卡同步拓展</strong>
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
          将保存的词条自动生成 4 种模式的 Anki 复习卡片（语境填空、看词识义、看义写词、听音辨词）。不使用 Anki 时可关闭此开关。
        </p>

        <div className="field" style={{ marginTop: 14 }}>
          <span>启用 Anki 同步</span>
          <div className="field-inline">
            <Switch
              checked={ankiEnabled}
              onChange={enabled => patchAnki({ enabled })}
            />
            <span className="field-inline-label">
              {ankiEnabled ? '保存词条时自动同步至 Anki（离线时暂存队列）' : '已关闭（仅保存在插件内置单词本）'}
            </span>
          </div>
        </div>

        {ankiEnabled && (
          <>
            <label className="field" style={{ marginTop: 12 }}>
              <span>AnkiConnect 地址</span>
              <input value={s.anki.url} onChange={e => patchAnki({ url: e.target.value })} />
            </label>

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
                {status.kind === 'busy' ? '检测中…' : '测试连接并更新卡片模板'}
              </button>
            </div>

            {status.kind === 'ok' && <p className="ok">{status.text}</p>}
            {status.kind === 'err' && (
              <div className="err">
                <p>{status.text}</p>
                <details>
                  <summary>连接排查步骤</summary>
                  <ol>
                    <li>确认 Anki 桌面版正在运行。</li>
                    <li>在 Anki「工具 → 附加组件」中确认已安装 AnkiConnect（代码 <code>2055492159</code>）。</li>
                    <li>若仍无法连接，可在 AnkiConnect 配置的 <code>webCorsOriginList</code> 中添加 <code>"*"</code> 后重启 Anki。</li>
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
            <strong>Anki 待同步队列</strong>
            {queue.length > 0 && <span className="chip">{queue.length}</span>}
          </div>
          <p className="block-hint">
            Anki 未运行时保存的卡片会暂存在此处（词条本身已保存在本地单词本）。打开 Anki 后可一键补写。
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
                          title={`移出待同步队列（保留在本地单词本）`}
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
                      disabled={queueStatus.kind === 'busy'}
                      onClick={() => void onFlush()}
                    >
                      {queueStatus.kind === 'busy' ? '同步中…' : '立即同步至 Anki'}
                    </button>
                    <button className="btn" onClick={() => void onClearQueue()}>清空队列</button>
                  </div>
                </>
              )}

          {queueStatus.kind === 'ok' && <p className="ok">{queueStatus.text}</p>}
          {queueStatus.kind === 'err' && <p className="err">{queueStatus.text}</p>}
        </div>
      )}
    </Section>
  )
}
