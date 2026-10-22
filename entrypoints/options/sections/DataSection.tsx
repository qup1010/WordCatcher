import { webDavStatusLabel } from '@/lib/webdav'
import { BookOpen, Cloud, Download, RefreshCw, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { backupFileName, buildBackup, describeSettings, parseBackup } from '@/lib/backup'
import { sendMessage } from '@/lib/messaging'
import { saveSettings } from '@/lib/settings'
import type { Settings, WebDavSyncState } from '@/lib/types'
import { Section } from '../components/Section'
import { StatusChip, Switch } from '../components/controls'
import type { SectionProps, Status } from './types'

function formatSyncTime(ms?: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export function DataSection({ s, onChange, connectionsDirty }: SectionProps) {
  const [libraryCount, setLibraryCount] = useState(0)
  const [libraryStatus, setLibraryStatus] = useState<Status>({ kind: 'idle' })
  const [webdavStatus, setWebdavStatus] = useState<Status>({ kind: 'idle' })
  const [webdavState, setWebdavState] = useState<WebDavSyncState>({})
  const [cacheSize, setCacheSize] = useState(0)
  const [cacheNote, setCacheNote] = useState<string | null>(null)
  const [backupStatus, setBackupStatus] = useState<Status>({ kind: 'idle' })
  const fileRef = useRef<HTMLInputElement>(null)
  const libraryFileRef = useRef<HTMLInputElement>(null)

  const patchWebDav = (part: Partial<Settings['webdav']>) =>
    onChange({ ...s, webdav: { ...s.webdav, ...part } })

  const refresh = () => {
    void sendMessage({ type: 'library-list' }).then((res) => {
      if (res.ok) setLibraryCount(res.data.length)
    })
    void sendMessage({ type: 'cache-stats' }).then((res) => {
      if (res.ok) setCacheSize(res.data.size)
    })
    void sendMessage({ type: 'webdav-status' }).then((res) => {
      if (res.ok) setWebdavState(res.data)
    })
  }

  useEffect(() => {
    refresh()
    const timer = setInterval(() => { void sendMessage({ type: 'webdav-status' }).then(res => { if (res.ok) setWebdavState(res.data) }) }, 2000)
    return () => clearInterval(timer)
  }, [])
  const resolveConflict = async (keepLocal: boolean) => {
    if (!webdavState.conflict || connectionsDirty) return
    setWebdavStatus({ kind: 'busy' })
    const result = await sendMessage({ type: 'webdav-resolve', payload: { token: webdavState.conflict.token, keepLocal } })
    setWebdavStatus(result.ok ? { kind: 'ok', text: '已应用选择并重新同步。' } : { kind: 'err', text: result.error })
    refresh()
  }

  const onTestWebDav = async () => {
    setWebdavStatus({ kind: 'busy' })
    const res = await sendMessage({ type: 'webdav-test', payload: { settings: s } })
    if (!res.ok) {
      setWebdavStatus({ kind: 'err', text: res.error })
      return
    }
    setWebdavStatus({
      kind: 'ok',
      text: res.data.exists
        ? `WebDAV 连接成功，已检测到远端同步文件（${res.data.fileUrl}）。`
        : `WebDAV 连接成功，远端目录就绪，首次同步时将自动创建 ${res.data.fileUrl}。`,
    })
  }

  const onSyncWebDav = async () => {
    setWebdavStatus({ kind: 'busy' })
    if (connectionsDirty) { setWebdavStatus({ kind: 'err', text: '请先保存连接配置，再立即同步。' }); return }
    const res = await sendMessage({ type: 'webdav-sync', payload: { forcePush: true } })
    if (!res.ok) {
      setWebdavStatus({ kind: 'err', text: res.error })
      refresh()
      return
    }
    const { added, updated, removed, total, syncedAt } = res.data
    setLibraryCount(total)
    setWebdavState({ lastSyncedAt: syncedAt, added, updated, removed, total })
    const details = [
      added > 0 ? `新增 ${added} 条` : '',
      updated > 0 ? `更新 ${updated} 条` : '',
      removed > 0 ? `同步删除 ${removed} 条` : '',
    ].filter(Boolean).join('，')
    setWebdavStatus({
      kind: 'ok',
      text: details
        ? `WebDAV 同步完成：${details}（当前共 ${total} 条语境记录）。`
        : `WebDAV 同步完成，云端与本地数据已一致（共 ${total} 条语境记录）。`,
    })
  }

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
    setLibraryStatus({ kind: 'ok', text: `已导出 ${libraryCount} 条生词库语境记录。` })
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

    // 导入内容先展示为连接草稿，由用户明确保存。
    if (result.history && result.history.length > 0) {
      await sendMessage({ type: 'history-import', payload: { items: result.history } })
    }
    onChange(result.settings)
    setBackupStatus({
      kind: 'ok',
      text: `已载入配置草稿，请保存配置：${describeSettings(result.settings, result.history?.length ?? 0)}`,
    })
  }

  const webdavEnabled = Boolean(s.webdav?.enabled)

  return (
    <Section
      id="sec-data"
      index={3}
      title="词库与同步"
      intro="管理 WebDAV 多端生词库同步、本地生词库备份、插件配置迁移与 AI 释义缓存。"
    >
      {/* ── WebDAV 多端生词库同步 ── */}
      <div className="block">
        <div className="block-head">
          <Cloud size={14} className="inline-icon" />
          <strong>WebDAV 生词库多端同步</strong>
          <span className="chip" role="status">{webDavStatusLabel(webdavEnabled, webdavState)}</span>
        </div>
        <p className="block-hint">
          各端配置相同的 HTTPS WebDAV 地址和文件路径，可同步词条、语境、编辑和删除。自动同步在修改词条或打开生词库时触发，也可点击「立即同步」拉取其他设备的改动。服务器需支持强 ETag 条件写入；发生冲突时会停止上传并保留两端内容。
        </p>

        <div className="field" style={{ marginTop: 12 }}>
          <span>启用 WebDAV 同步</span>
          <div className="field-inline">
            <Switch
              checked={webdavEnabled}
              onChange={enabled => patchWebDav({ enabled })}
            />
            <span className="field-inline-label">
              {webdavEnabled ? '已启用多端生词库同步' : '已关闭（仅使用本地存储）'}
            </span>
          </div>
        </div>

        {webdavEnabled && (
          <>
            <label className="field" style={{ marginTop: 12 }}>
              <span>WebDAV 地址</span>
              <input
                value={s.webdav.url}
                placeholder="https://dav.jianguoyun.com/dav/"
                onChange={e => patchWebDav({ url: e.target.value })}
              />
            </label>

            <label className="field" style={{ marginTop: 12 }}>
              <span>同步文件路径</span>
              <input
                value={s.webdav.remotePath}
                placeholder="WordCatcher/vocabulary-sync.json"
                onChange={e => patchWebDav({ remotePath: e.target.value })}
              />
            </label>

            <label className="field" style={{ marginTop: 12 }}>
              <span>用户名 / 账号</span>
              <input
                value={s.webdav.username}
                placeholder="WebDAV 用户名或邮箱"
                onChange={e => patchWebDav({ username: e.target.value })}
              />
            </label>

            <label className="field" style={{ marginTop: 12 }}>
              <span>密码 / 应用密码</span>
              <input
                type="password"
                value={s.webdav.password}
                placeholder="WebDAV 密码或专用应用密码"
                onChange={e => patchWebDav({ password: e.target.value })}
              />
            </label>

            <div className="field" style={{ marginTop: 12 }}>
              <span>自动同步</span>
              <div className="field-inline">
                <Switch
                  checked={s.webdav.autoSync !== false}
                  onChange={autoSync => patchWebDav({ autoSync })}
                />
                <span className="field-inline-label">保存、编辑、删除词条或打开生词库时自动与云端合并</span>
              </div>
            </div>

            <div className="block-actions" style={{ marginTop: 16 }}>
              <button
                type="button"
                className="btn"
                disabled={webdavStatus.kind === 'busy'}
                onClick={() => void onTestWebDav()}
              >
                {webdavStatus.kind === 'busy' ? '处理中…' : '测试 WebDAV 连接'}
              </button>
              <button
                type="button"
                className="btn btn-icon"
                disabled={webdavStatus.kind === 'busy'}
                onClick={() => void onSyncWebDav()}
              >
                <RefreshCw size={14} />
                <span>立即同步生词库</span>
              </button>
            </div>

            {webdavStatus.kind === 'ok' && <p className="ok">{webdavStatus.text}</p>}
            {webdavStatus.kind === 'err' && <p className="err">{webdavStatus.text}</p>}
            {webdavStatus.kind === 'idle' && webdavState.lastError && (
              <p className="err">上次同步失败：{webdavState.lastError}</p>
            )}
          </>
        )}
      </div>

      {webdavState.conflict && <div className="block" role="region" aria-label="同步冲突对照">
        <h3>有冲突</h3><p>同一记录在两端均有修改。选择要保留的完整版本，随后重新同步。</p>
        <div className="conflict-columns">
          {([['本地版本',webdavState.conflict.local],['云端版本',webdavState.conflict.remote]] as const).map(([label,record]) => <div key={label}>
            <h4>{label} · {record.deletedAt ? '已删除' : '有效记录'}</h4>
            <strong>{record.wordMeta?.displayWord || record.card.entry.word}</strong>
            <p>{record.card.sentence}</p>
            <dl><dt>释义</dt><dd>{record.edits?.definition ?? record.card.entry.definition}</dd><dt>译文</dt><dd>{record.edits?.contextTranslation ?? record.card.entry.contextTranslation}</dd><dt>备注</dt><dd>{record.edits?.note || '无'}</dd></dl>
            <details><summary>完整记录</summary><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(record,null,2)}</pre></details>
          </div>)}
        </div>
        <div className="row"><button className="btn" disabled={connectionsDirty || webdavStatus.kind === 'busy'} onClick={() => void resolveConflict(true)}>保留本地版本</button><button className="btn" disabled={connectionsDirty || webdavStatus.kind === 'busy'} onClick={() => void resolveConflict(false)}>保留云端版本</button></div>
        {connectionsDirty && <p className="hint">请先保存或放弃连接配置修改。</p>}
      </div>}
            {/* ── 本地生词库数据 ── */}
      <div className="block">
        <div className="block-head">
          <BookOpen size={14} className="inline-icon" />
          <strong>本地生词库备份</strong>
          <span className="chip">{libraryCount} 条语境</span>
        </div>
        <p className="block-hint">
          导出或导入保存在本地「生词库」中的所有生词、原句语境、AI 详解与个人笔记，支持与 Windows 桌面端互相导入。
        </p>
        <div className="block-actions">
          <button className="btn btn-icon" onClick={() => void onExportLibrary()}>
            <Download size={14} />
            <span>导出生词库 JSON</span>
          </button>
          <button
            className="btn btn-icon"
            disabled={libraryStatus.kind === 'busy'}
            onClick={() => libraryFileRef.current?.click()}
          >
            <Upload size={14} />
            <span>导入生词库 JSON</span>
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
          <strong className="warn-inline">导出文件中包含明文 API Key 与 WebDAV 密码</strong>
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
