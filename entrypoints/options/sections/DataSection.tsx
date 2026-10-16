import { BookOpen, Download, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { backupFileName, buildBackup, describeSettings, parseBackup } from '@/lib/backup'
import { sendMessage } from '@/lib/messaging'
import { saveSettings } from '@/lib/settings'
import { Section } from '../components/Section'
import type { SectionProps, Status } from './types'

export function DataSection({ s, onChange }: SectionProps) {
  const [libraryCount, setLibraryCount] = useState(0)
  const [libraryStatus, setLibraryStatus] = useState<Status>({ kind: 'idle' })
  const [cacheSize, setCacheSize] = useState(0)
  const [cacheNote, setCacheNote] = useState<string | null>(null)
  const [backupStatus, setBackupStatus] = useState<Status>({ kind: 'idle' })
  const fileRef = useRef<HTMLInputElement>(null)
  const libraryFileRef = useRef<HTMLInputElement>(null)

  const refresh = () => {
    void sendMessage({ type: 'library-list' }).then((res) => {
      if (res.ok) setLibraryCount(res.data.length)
    })
    void sendMessage({ type: 'cache-stats' }).then((res) => {
      if (res.ok) setCacheSize(res.data.size)
    })
  }

  useEffect(refresh, [])

  const onExportLibrary = async () => {
    const res = await sendMessage({ type: 'library-export' })
    if (!res.ok) {
      setLibraryStatus({ kind: 'err', text: res.error })
      return
    }
    const url = URL.createObjectURL(new Blob([res.data], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `word-catcher-library-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    setLibraryStatus({ kind: 'ok', text: `已导出 ${libraryCount} 条单词本语境记录。` })
  }

  const onImportLibraryFile = async (file: File) => {
    setLibraryStatus({ kind: 'busy' })
    try {
      const text = await file.text()
      const res = await sendMessage({ type: 'library-import', payload: { json: text } })
      if (res.ok) {
        setLibraryCount(res.data.records.length)
        setLibraryStatus({
          kind: 'ok',
          text: res.data.added > 0
            ? `已导入 ${res.data.added} 条新的语境记录（当前共 ${res.data.records.length} 条）。`
            : '备份文件已解析，未发现新的语境记录。',
        })
      } else {
        setLibraryStatus({ kind: 'err', text: res.error })
      }
    } catch {
      setLibraryStatus({ kind: 'err', text: '无法读取所选文件，请确认文件是有效的 JSON 备份。' })
    }
  }

  const onClearCache = async () => {
    const res = await sendMessage({ type: 'clear-cache' })
    if (!res.ok) return
    setCacheSize(0)
    setCacheNote(res.data.cleared > 0
      ? `已清理 ${res.data.cleared} 条缓存，下次划选将重新生成。`
      : '当前没有缓存记录。')
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

    setBackupStatus({ kind: 'ok', text: '已导出插件配置与查词历史。导出文件中包含 API Key，请妥善保管。' })
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
      index={4}
      title="数据与单词本"
      intro="管理本地单词本备份、插件配置迁移与 AI 释义缓存。"
    >
      {/* ── 本地单词本数据 ── */}
      <div className="block">
        <div className="block-head">
          <BookOpen size={14} className="inline-icon" />
          <strong>本地单词本备份</strong>
          <span className="chip">{libraryCount} 条语境</span>
        </div>
        <p className="block-hint">
          导出或导入保存在本地「单词本」中的所有生词、原句语境、AI 详解与个人笔记，支持与 Windows 桌面端互相导入。
        </p>
        <div className="block-actions">
          <button className="btn btn-icon" onClick={() => void onExportLibrary()}>
            <Download size={14} />
            <span>导出单词本 JSON</span>
          </button>
          <button
            className="btn btn-icon"
            disabled={libraryStatus.kind === 'busy'}
            onClick={() => libraryFileRef.current?.click()}
          >
            <Upload size={14} />
            <span>导入单词本 JSON</span>
          </button>
          <input
            ref={libraryFileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) void onImportLibraryFile(file)
            }}
          />
        </div>
        {libraryStatus.kind === 'ok' && <p className="ok">{libraryStatus.text}</p>}
        {libraryStatus.kind === 'err' && <p className="err">{libraryStatus.text}</p>}
      </div>

      {/* ── 配置与查词历史备份 ── */}
      <div className="block">
        <div className="block-head">
          <strong>设置与查词历史备份</strong>
        </div>
        <p className="block-hint">
          更换设备时可将当前设置与最近查词历史导出迁移（同样兼容导入 Windows 桌面端的设置文件）。
          <strong className="warn-inline">导出文件中包含明文 API Key</strong>
          ，请注意保管，勿随意分享。
        </p>
        <div className="block-actions">
          <button className="btn btn-icon" onClick={() => void onExport()}>
            <Download size={14} />
            <span>导出设置与历史</span>
          </button>
          <button
            className="btn btn-icon"
            disabled={backupStatus.kind === 'busy'}
            onClick={() => fileRef.current?.click()}
          >
            <Upload size={14} />
            <span>导入设置文件</span>
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

      {/* ── AI 缓存 ── */}
      <div className="block">
        <div className="block-head">
          <strong>AI 释义缓存</strong>
          <span className="chip">{cacheSize}</span>
        </div>
        <p className="block-hint">
          同一句话中的同一个词不会重复请求 AI。缓存仅保存在运行内存中，更换模型后如需立即重新生成，可手动清理。
        </p>
        <div className="block-actions">
          <button className="btn" onClick={() => void onClearCache()}>清空缓存</button>
        </div>
        {cacheNote && <p className="ok">{cacheNote}</p>}
      </div>
    </Section>
  )
}
