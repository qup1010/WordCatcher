import { Download, Inbox, Trash2, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { backupFileName, buildBackup, describeSettings, parseBackup } from '@/lib/backup'
import { sendMessage } from '@/lib/messaging'
import { saveSettings } from '@/lib/settings'
import type { CapturedCard } from '@/lib/types'
import { Section } from '../components/Section'
import type { SectionProps, Status } from './types'

/** 队列条目的时间戳，只显示到分钟——秒对"这词什么时候划的"没有意义 */
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
  const fileRef = useRef<HTMLInputElement>(null)

  const refresh = () => {
    void sendMessage({ type: 'pending-list' }).then((res) => {
      if (res.ok) setQueue(res.data.cards)
    })
    void sendMessage({ type: 'cache-stats' }).then((res) => {
      if (res.ok) setCacheSize(res.data.size)
    })
  }

  useEffect(refresh, [])

  // ── 待写队列 ──

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
      // 还有剩就是写到一半 Anki 又断了，别报成成功
      ? { kind: 'err', text: `写入 ${written} 张后连接中断，还剩 ${remaining} 张。确认 Anki 在运行后再试。` }
      : { kind: 'ok', text: `写入 ${written} 张${dropped > 0 ? `，跳过 ${dropped} 张重复的` : ''}。` })
  }

  const onRemove = async (word: string) => {
    const res = await sendMessage({ type: 'remove-pending', payload: { word } })
    if (res.ok) refresh()
  }

  const onClearQueue = async () => {
    const res = await sendMessage({ type: 'clear-pending' })
    if (res.ok) {
      refresh()
      setQueueStatus({ kind: 'ok', text: '队列已清空。' })
    }
  }

  // ── AI 缓存 ──

  const onClearCache = async () => {
    const res = await sendMessage({ type: 'clear-cache' })
    if (!res.ok) return
    setCacheSize(0)
    setCacheNote(res.data.cleared > 0
      ? `已清掉 ${res.data.cleared} 条，下次划到这些词会重新请求 AI。`
      : '缓存本来就是空的。')
  }

  // ── 配置备份 ──

  const onExport = () => {
    const exportedAt = new Date().toISOString()
    const blob = new Blob([JSON.stringify(buildBackup(s, exportedAt), null, 2)], {
      type: 'application/json',
    })

    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = backupFileName(exportedAt)
    a.click()
    URL.revokeObjectURL(url)

    setBackupStatus({ kind: 'ok', text: `已导出。文件里包含明文 API key，注意保管。` })
  }

  const onImportFile = async (file: File) => {
    setBackupStatus({ kind: 'busy' })
    const result = parseBackup(await file.text())

    if (!result.ok) {
      setBackupStatus({ kind: 'err', text: result.error })
      return
    }

    // 先落盘再更新界面：导入的是整份配置，中途出错的话界面和存储会对不上
    await saveSettings(result.settings)
    onChange(result.settings)
    setBackupStatus({ kind: 'ok', text: `已导入：${describeSettings(result.settings)}` })
  }

  return (
    <Section
      id="sec-data"
      index={5}
      title="数据与维护"
      intro="待写队列、AI 缓存和配置备份。平时不用管，出问题或者换机器时才需要。"
    >
      {/* ── 待写队列 ── */}
      <div className="block">
        <div className="block-head">
          <Inbox size={14} className="inline-icon" />
          <strong>待写队列</strong>
          {queue.length > 0 && <span className="chip">{queue.length}</span>}
        </div>
        <p className="block-hint">
          Anki 没开的时候存的词会先排在这里，等 Anki 起来了一次性补写，不会丢。
        </p>

        {queue.length === 0
          ? <p className="empty">队列是空的。</p>
          : (
              <>
                <ul className="queue-list">
                  {queue.map(card => (
                    <li key={card.entry.word}>
                      <div className="queue-item">
                        <span className="queue-word">{card.entry.word}</span>
                        <span className="queue-def">{card.entry.definition}</span>
                      </div>
                      <span className="queue-time">{formatTime(card.createdAt)}</span>
                      <button
                        type="button"
                        className="btn btn-icon btn-danger"
                        title={`不要「${card.entry.word}」了`}
                        onClick={() => void onRemove(card.entry.word)}
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
          <strong>配置备份</strong>
        </div>
        <p className="block-hint">
          换机器时把配置整份搬过去。
          <strong className="warn-inline">导出的文件里包含明文 API key</strong>
          ，和 key 本身一样敏感，别随手发出去。
        </p>
        <div className="block-actions">
          <button className="btn btn-icon" onClick={onExport}>
            <Download size={14} />
            <span>导出配置</span>
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
              // 清空 value，否则连续导入同一个文件不会触发 change
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
