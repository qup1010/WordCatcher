import { Download, Inbox, Laptop, Trash2, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { backupFileName, buildBackup, describeSettings, parseBackup } from '@/lib/backup'
import { sendMessage } from '@/lib/messaging'
import { saveSettings } from '@/lib/settings'
import { contextKey } from '@/lib/learning'
import type { CapturedCard } from '@/lib/types'
import { Section } from '../components/Section'
import { StatusChip, Switch } from '../components/controls'
import type { SectionProps, Status } from './types'

function formatTime(ms: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function DataSection({ s, onChange }: SectionProps) {
  const [queue, setQueue] = useState<CapturedCard[]>([])
  const [queueStatus, setQueueStatus] = useState<Status>({ kind: 'idle' })
  const [cacheSize, setCacheSize] = useState(0)
  const [cacheNote, setCacheNote] = useState<string | null>(null)
  const [backupStatus, setBackupStatus] = useState<Status>({ kind: 'idle' })
  const [desktopAlive, setDesktopAlive] = useState<boolean | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const refresh = () => {
    void sendMessage({ type: 'pending-list' }).then((res) => {
      if (res.ok) setQueue(res.data.cards)
    })
    void sendMessage({ type: 'cache-stats' }).then((res) => {
      if (res.ok) setCacheSize(res.data.size)
    })
    void sendMessage({ type: 'check-desktop-bridge' }).then((res) => {
      if (res.ok) setDesktopAlive(res.data.alive)
    })
  }

  useEffect(refresh, [])

  const onFlush = async () => {
    setQueueStatus({ kind: 'busy' })
    const res = await sendMessage({ type: 'flush-pending' })
    if (!res.ok) {
      setQueueStatus({ kind: 'err', text: res.error })
      return
    }

    const { written, dropped, remaining } = res.data
    refresh()
    setQueueStatus(remaining > 0
      ? { kind: 'err', text: `写入 ${written} 张后连接中断，还剩 ${remaining} 张。确认 Anki 在运行后再试。` }
      : { kind: 'ok', text: `写入 ${written} 张${dropped > 0 ? `，跳过 ${dropped} 张重复的` : ''}。` })
  }

  const onRemove = async (card: CapturedCard) => {
    const res = await sendMessage({ type: 'remove-pending', payload: { word: card.entry.word, contextKey: contextKey(card) } })
    if (res.ok) refresh()
  }

  const onClearQueue = async () => {
    const res = await sendMessage({ type: 'clear-pending' })
    if (res.ok) {
      refresh()
      setQueueStatus({ kind: 'ok', text: '队列已清空。' })
    }
  }

  const onClearCache = async () => {
    const res = await sendMessage({ type: 'clear-cache' })
    if (!res.ok) return
    setCacheSize(0)
    setCacheNote(res.data.cleared > 0
      ? `已清掉 ${res.data.cleared} 条，下次划到这些词会重新请求 AI。`
      : '缓存本来就是空的。')
  }

  const onExport = async () => {
    const exportedAt = new Date().toISOString()
    const historyRes = await sendMessage({ type: 'history-list' })
    const history = historyRes.ok ? historyRes.data : undefined
    const blob = new Blob([JSON.stringify(buildBackup(s, exportedAt, history), null, 2)], {
      type: 'application/json',
    })

    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = backupFileName(exportedAt)
    a.click()
    URL.revokeObjectURL(url)

    setBackupStatus({ kind: 'ok', text: `已导出配置与最近查词记录。文件里包含明文 API key，注意保管。` })
  }

  const onImportFile = async (file: File) => {
    setBackupStatus({ kind: 'busy' })
    const result = parseBackup(await file.text())

    if (!result.ok) {
      setBackupStatus({ kind: 'err', text: result.error })
      return
    }

    await saveSettings(result.settings)
    if (result.history && result.history.length > 0) {
      await sendMessage({ type: 'history-import', payload: { items: result.history } })
    }
    onChange(result.settings)
    setBackupStatus({
      kind: 'ok',
      text: `已导入：${describeSettings(result.settings, result.history?.length ?? 0)}`,
    })
  }

  return (
    <Section
      id="sec-data"
      index={5}
      title="数据与维护"
      intro="管理桌面端联动、查看待同步卡片、清理缓存或备份配置。"
    >
      {/* ── Windows 桌面版联动 ── */}
      <div className="block">
        <div className="block-head">
          <Laptop size={14} className="inline-icon" />
          <strong>Windows 桌面版联动</strong>
          {desktopAlive !== null && (
            <StatusChip ok={desktopAlive} okText="桌面端在线" badText="未检测到桌面端" />
          )}
        </div>
        <p className="block-hint">
          开启后，在网页中点击保存生词时，除了写入 Anki，还会自动同步存入 Windows 桌面版的本地 SQLite 生词库。
        </p>
        <div className="field" style={{ marginTop: 12 }}>
          <span>自动同步至桌面端</span>
          <Switch
            checked={s.desktopBridge?.enabled ?? true}
            onChange={enabled => onChange({
              ...s,
              desktopBridge: { ...s.desktopBridge, enabled },
            })}
          />
        </div>
        <label className="field" style={{ marginTop: 10 }}>
          <span>桥接地址</span>
          <input
            value={s.desktopBridge?.url ?? 'http://127.0.0.1:18765'}
            placeholder="http://127.0.0.1:18765"
            onChange={e => onChange({
              ...s,
              desktopBridge: { ...s.desktopBridge, url: e.target.value },
            })}
          />
        </label>
      </div>

      {/* ── 待写队列 ── */}
      <div className="block">
        <div className="block-head">
          <Inbox size={14} className="inline-icon" />
          <strong>待写队列</strong>
          {queue.length > 0 && <span className="chip">{queue.length}</span>}
        </div>
        <p className="block-hint">
          Anki 未连接时，卡片会暂存在这里。打开 Anki 后可继续同步。
        </p>

        {queue.length === 0
          ? <p className="empty">没有待同步的卡片。</p>
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
                        title={`取消同步「${card.entry.word}」的这条语境`}
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
                    {queueStatus.kind === 'busy' ? '写入中…' : '全部补写进 Anki'}
                  </button>
                  <button className="btn" onClick={() => void onClearQueue()}>清空队列</button>
                </div>
              </>
            )}

        {queueStatus.kind === 'ok' && <p className="ok">{queueStatus.text}</p>}
        {queueStatus.kind === 'err' && <p className="err">{queueStatus.text}</p>}
      </div>

      {/* ── AI 缓存 ── */}
      <div className="block">
        <div className="block-head">
          <strong>AI 缓存</strong>
          <span className="chip">{cacheSize}</span>
        </div>
        <p className="block-hint">
          同一个词在同一句话里反复划选不会重复请求 AI。缓存只在内存里，
          浏览器回收后台进程时自动清空。改了模型想立刻看到新结果时可以手动清一次。
        </p>
        <div className="block-actions">
          <button className="btn" onClick={() => void onClearCache()}>清空缓存</button>
        </div>
        {cacheNote && <p className="ok">{cacheNote}</p>}
      </div>

      {/* ── 配置备份 ── */}
      <div className="block">
        <div className="block-head">
          <strong>配置与历史备份</strong>
        </div>
        <p className="block-hint">
          换机器时把配置与查词记录整份搬过去（同时支持直接导入 Windows 桌面版的设置文件）。
          <strong className="warn-inline">导出的文件里包含明文 API key</strong>
          ，和 key 本身一样敏感，别随手发出去。
        </p>
        <div className="block-actions">
          <button className="btn btn-icon" onClick={() => void onExport()}>
            <Download size={14} />
            <span>导出配置与记录</span>
          </button>
          <button
            className="btn btn-icon"
            disabled={backupStatus.kind === 'busy'}
            onClick={() => fileRef.current?.click()}
          >
            <Upload size={14} />
            <span>导入配置</span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) void onImportFile(file)
            }}
          />
        </div>
        {backupStatus.kind === 'ok' && <p className="ok">{backupStatus.text}</p>}
        {backupStatus.kind === 'err' && <p className="err">{backupStatus.text}</p>}
      </div>
    </Section>
  )
}
