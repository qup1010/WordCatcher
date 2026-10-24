import { webDavStatusLabel } from '@/lib/webdav'
import { BookOpen, Cloud, Download, RefreshCw, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { backupFileName, buildBackup, parseBackup } from '@/lib/backup'
import { sendMessage } from '@/lib/messaging'
import type { Settings, WebDavSyncState } from '@/lib/types'
import { Section } from '../components/Section'
import { Switch } from '../components/controls'
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
  const [cacheStatus, setCacheStatus] = useState<Status>({ kind: 'idle' })
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
        ? 'WebDAV 连接成功，已找到同步文件。'
        : 'WebDAV 连接成功，首次同步时会创建同步文件。',
    })
  }

  const onSyncWebDav = async () => {
    setWebdavStatus({ kind: 'busy' })
    if (connectionsDirty) { setWebdavStatus({ kind: 'err', text: '请先点击页面底部的「保存配置」，再开始同步。' }); return }
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
    setLibraryStatus({ kind: 'ok', text: '生词库备份已导出。' })
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
            : `导入完成，当前共 ${res.data.records.length} 条语境记录。`,
        })
      } else {
        setLibraryStatus({ kind: 'err', text: res.error })
      }
    } catch {
      setLibraryStatus({ kind: 'err', text: '无法读取所选文件，请确认文件是有效的 JSON 备份。' })
    }
  }

  const onClearCache = async () => {
    setCacheStatus({ kind: 'busy' })
    const res = await sendMessage({ type: 'clear-cache' })
    if (!res.ok) { setCacheStatus({ kind: 'err', text: `AI 缓存未清空：${res.error} 请重试。` }); return }
    setCacheSize(0)
    setCacheStatus({ kind: 'ok', text: res.data.cleared > 0
      ? `已清空 ${res.data.cleared} 条 AI 缓存，下次相同的 AI 查询会重新生成。`
      : '当前没有 AI 缓存。' })
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

    setBackupStatus({ kind: historyRes.ok ? 'ok' : 'err', text: historyRes.ok
      ? '已导出当前设置和查词历史。文件含明文 API Key 与 WebDAV 密码，请妥善保管。'
      : '已导出当前设置；查词历史读取失败，本次备份未包含历史。文件含明文 API Key 与 WebDAV 密码，请妥善保管。' })
  }

  const onImportFile = async (file: File) => {
    setBackupStatus({ kind: 'busy' })
    try {
      const result = parseBackup(await file.text())

      if (!result.ok) {
        setBackupStatus({ kind: 'err', text: result.error })
        return
      }

      let historyError = ''
      if (result.history && result.history.length > 0) {
        const historyResult = await sendMessage({ type: 'history-import', payload: { items: result.history } })
        if (!historyResult.ok) historyError = historyResult.error
      }
      onChange(result.settings)
      setBackupStatus({
        kind: historyError ? 'err' : 'ok',
        text: historyError
          ? `设置已载入，但查词历史导入失败：${historyError} 请核对设置，并点击「保存配置」。`
          : '设置已载入，请核对页面内容。AI、WebDAV 和 Anki 配置需点击「保存配置」；翻译、词典和操作选项会自动保存。',
      })
    } catch {
      setBackupStatus({ kind: 'err', text: '无法读取设置文件，请重新选择有效的 JSON 设置备份。' })
    }
  }

  const webdavEnabled = Boolean(s.webdav?.enabled)

  return (
    <Section
      id="sec-data"
      index={3}
      title="词库与同步"
      intro="用 WebDAV 在设备间同步生词库，或导出备份迁移数据。"
    >
      {/* ── WebDAV 多端生词库同步 ── */}
      <div className="block">
        <div className="block-head">
          <Cloud size={14} className="inline-icon" />
          <strong>WebDAV 词库同步</strong>
          <span className="chip" role="status">{webDavStatusLabel(webdavEnabled, webdavState)}</span>
        </div>
        <p className="block-hint">
          在插件和桌面端填写相同的 HTTPS 地址与文件路径，即可同步收藏、原句和个人编辑。删除也会同步。
        </p>

        <div className="field" style={{ marginTop: 12 }}>
          <span>启用 WebDAV 同步</span>
          <div className="field-inline">
            <Switch
              checked={webdavEnabled}
              onChange={enabled => patchWebDav({ enabled })}
            />
            <span className="field-inline-label">
              {webdavEnabled ? '保存配置后，可与其他设备同步生词库。' : '关闭时，收藏保存在当前浏览器中。'}
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
              <span>WebDAV 用户名</span>
              <input
                value={s.webdav.username}
                placeholder="WebDAV 用户名或邮箱"
                onChange={e => patchWebDav({ username: e.target.value })}
              />
            </label>

            <label className="field" style={{ marginTop: 12 }}>
              <span>WebDAV 密码</span>
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
                <span className="field-inline-label">修改词条或打开生词库时自动同步；关闭后仍可手动同步。</span>
              </div>
            </div>

            <p className="hint">先测试连接，再点击「保存配置」。需要拉取其他设备的修改时，点击「立即同步生词库」。</p>

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
            {Boolean(webdavState.lastSyncedAt) && <p className="hint">上次同步：{formatSyncTime(webdavState.lastSyncedAt)}</p>}
          </>
        )}
        <details className="adv-details">
          <summary>同步范围与服务器要求</summary>
          <div className="adv-details-body">
            <p>同步包含收藏的词条、语境、个人编辑和删除。插件设置、查词历史、API Key、WebDAV 密码及 Anki 同步任务各自保存在本地。</p>
            <p>服务器需提供强 ETag 并支持条件写入，用于避免覆盖其他设备的修改。发生冲突时会保留两端内容，请在下方比较并选择要保留的版本。</p>
          </div>
        </details>
      </div>

      {webdavState.conflict && <div className="block" role="region" aria-label="同步冲突对照">
        <h3>同一条收藏在两端都有修改</h3><p>请比较下方内容，再选择要保留的完整版本。选择后会重新同步。</p>
        <div className="conflict-columns">
          {([['本地版本',webdavState.conflict.local],['云端版本',webdavState.conflict.remote]] as const).map(([label,record]) => <div key={label}>
            <h4>{label} · {record.deletedAt ? '已删除' : '未删除'}</h4>
            <strong>{record.wordMeta?.displayWord || record.card.entry.word}</strong>
            <p>{record.card.sentence}</p>
            <dl><dt>释义</dt><dd>{record.edits?.definition ?? record.card.entry.definition}</dd><dt>译文</dt><dd>{record.edits?.contextTranslation ?? record.card.entry.contextTranslation}</dd><dt>备注</dt><dd>{record.edits?.note || '无'}</dd></dl>
            <details><summary>完整记录</summary><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(record,null,2)}</pre></details>
          </div>)}
        </div>
        <div className="row"><button className="btn" disabled={connectionsDirty || webdavStatus.kind === 'busy'} onClick={() => void resolveConflict(true)}>保留本地版本</button><button className="btn" disabled={connectionsDirty || webdavStatus.kind === 'busy'} onClick={() => void resolveConflict(false)}>保留云端版本</button></div>
        {connectionsDirty && <p className="hint">请先保存或放弃页面底部未保存的配置，再处理冲突。</p>}
      </div>}
            {/* ── 本地生词库数据 ── */}
      <div className="block">
        <div className="block-head">
          <BookOpen size={14} className="inline-icon" />
          <strong>本地生词库备份</strong>
          <span className="chip">{libraryCount} 条语境</span>
        </div>
        <p className="block-hint">
          备份收藏的单词、原句、释义和个人笔记，也可与桌面版互相导入。此文件不包含设置和 API Key。
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
          导出当前页面的设置与最近查词历史，用于迁移数据。
          <strong className="warn-inline">文件包含明文 API Key 与 WebDAV 密码，请妥善保管。</strong>
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
            <span>导入设置与历史</span>
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
        <p className="hint">导入后，翻译、词典和操作选项自动保存；AI、WebDAV 和 Anki 配置请核对后保存。也支持导入桌面版设置文件，其中的 API Key 需重新填写。</p>
        {backupStatus.kind === 'ok' && <p className="ok">{backupStatus.text}</p>}
        {backupStatus.kind === 'err' && <p className="err">{backupStatus.text}</p>}
      </div>

      {/* ── AI 缓存 ── */}
      <div className="block">
        <div className="block-head">
          <strong>AI 释义缓存</strong>
          <span className="chip">{cacheSize} 条</span>
        </div>
        <p className="block-hint">
          重复的 AI 查询会优先使用内存缓存。清空后，下次相同查询会重新请求 AI；收藏和查词历史会保留。
        </p>
        <div className="block-actions">
          <button className="btn" disabled={cacheStatus.kind === 'busy'} onClick={() => void onClearCache()}>{cacheStatus.kind === 'busy' ? '正在清空…' : '清空 AI 缓存'}</button>
        </div>
        {cacheStatus.kind === 'ok' && <p className="ok">{cacheStatus.text}</p>}
        {cacheStatus.kind === 'err' && <p className="err" role="alert">{cacheStatus.text}</p>}
      </div>
    </Section>
  )
}
