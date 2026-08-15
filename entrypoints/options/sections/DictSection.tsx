import { BookOpen, Check, Download, RefreshCw, Trash2, Upload, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { sendMessage } from '@/lib/messaging'
import { type ImportProgress, importLocalDictFile, startDictImport } from '@/lib/open-dict/importer'
import type { DictMeta } from '@/lib/open-dict/types'
import { DEFAULT_SETTINGS } from '@/lib/types'
import { Section } from '../components/Section'
import { StatusChip, Switch } from '../components/controls'
import type { SectionProps } from './types'

export function DictSection({ s, onChange }: SectionProps) {
  const [meta, setMeta] = useState<DictMeta>({
    status: 'uninstalled',
    entryCount: 0,
    updatedAt: 0,
  })
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const abortRef = useRef<(() => void) | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const downloadUrl = s.dict?.downloadUrl || DEFAULT_SETTINGS.dict.downloadUrl

  const refreshMeta = () => {
    void sendMessage({ type: 'dict-status' }).then((res) => {
      if (res.ok) setMeta(res.data)
    })
  }

  useEffect(() => {
    refreshMeta()
    return () => {
      abortRef.current?.()
    }
  }, [])

  const onStartDownload = () => {
    setErrorMsg(null)
    setProgress({
      percent: 0,
      processedCount: 0,
      statusText: '准备开始下载...',
    })

    const cancel = startDictImport(downloadUrl, {
      onProgress: (p) => {
        setProgress(p)
      },
      onDone: (count) => {
        setProgress(null)
        abortRef.current = null
        refreshMeta()
      },
      onError: (msg) => {
        setErrorMsg(msg)
        setProgress(null)
        abortRef.current = null
        refreshMeta()
      },
      onAborted: () => {
        setProgress(null)
        abortRef.current = null
        refreshMeta()
      },
    })

    abortRef.current = cancel
  }

  const onSelectLocalFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    setErrorMsg(null)
    setProgress({
      percent: 0,
      processedCount: 0,
      statusText: '准备解析本地文件...',
    })

    const controller = new AbortController()
    abortRef.current = () => controller.abort()

    void importLocalDictFile(file, {
      onProgress: (p) => {
        setProgress(p)
      },
      onDone: (count) => {
        setProgress(null)
        abortRef.current = null
        refreshMeta()
      },
      onError: (msg) => {
        setErrorMsg(msg)
        setProgress(null)
        abortRef.current = null
        refreshMeta()
      },
      onAborted: () => {
        setProgress(null)
        abortRef.current = null
        refreshMeta()
      },
    }, controller.signal)
  }

  const onCancelDownload = () => {
    abortRef.current?.()
    abortRef.current = null
    setProgress(null)
  }

  const [showConfirmClear, setShowConfirmClear] = useState(false)

  const isReady = meta.status === 'ready' && meta.entryCount > 0
  const isDownloading = progress !== null || meta.status === 'downloading'

  return (
    <Section
      id="sec-dict"
      index={2}
      title="离线词典"
      intro={<>基于开源 Open Dictionary（8.4 万词条），在本地 IndexedDB 提供毫秒级离线快速查词与记忆线索。</>}
    >
      <div className="field">
        <span>启用离线词库</span>
        <Switch
          checked={Boolean(s.dict?.enabled ?? true)}
          onChange={enabled => onChange({ ...s, dict: { ...s.dict, downloadUrl, enabled } })}
        />
      </div>
      <p className="hint">开启后，划选单个英文单词将优先检索本地离线词典；未收录词或长句自动平滑回退至机翻。</p>

      <div className="field" style={{ marginTop: 16 }}>
        <span>词库状态</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <StatusChip
            ok={isReady}
            okText={`已就绪 (${meta.entryCount.toLocaleString()} 词)`}
            badText={isDownloading ? '正在安装...' : '未安装'}
          />
        </div>
      </div>

      {/* ── 下载/导入进度条 ── */}
      {isDownloading && progress && (
        <div style={{ marginTop: 12, padding: 14, background: 'var(--teal-wash)', borderRadius: 'var(--r-md)', border: '1px solid var(--hairline)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 550, color: 'var(--ink)' }}>
            <span>{progress.statusText}</span>
            <span>{progress.percent}%</span>
          </div>
          <div style={{ marginTop: 8, height: 6, width: '100%', background: 'var(--hairline)', borderRadius: 3, overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                width: `${progress.percent}%`,
                background: 'var(--teal)',
                transition: 'width 0.2s ease',
              }}
            />
          </div>
          <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={onCancelDownload}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
            >
              <X size={13} />
              <span>取消操作</span>
            </button>
          </div>
        </div>
      )}

      {/* ── 错误提示 ── */}
      {(errorMsg || (meta.status === 'error' && meta.errorMessage)) && (
        <div className="err" style={{ marginTop: 12 }}>
          {errorMsg || meta.errorMessage}
        </div>
      )}

      {/* ── 词库操作按钮 ── */}
      <div style={{ marginTop: 16, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <input
          ref={fileInputRef}
          type="file"
          accept=".jsonl.gz,.gz,.jsonl,.json"
          hidden
          onChange={onSelectLocalFile}
        />

        {!isDownloading && (
          <>
            <button
              type="button"
              className={`btn ${isReady ? 'btn-ghost' : 'btn-primary'}`}
              onClick={onStartDownload}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              {isReady ? <RefreshCw size={14} /> : <Download size={14} />}
              <span>{isReady ? '从网络更新词库' : '一键从网络下载安装 (约 93MB)'}</span>
            </button>

            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => fileInputRef.current?.click()}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <Upload size={14} />
              <span>从本地文件导入 (.gz / .jsonl)</span>
            </button>
          </>
        )}

        {isReady && !isDownloading && !showConfirmClear && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setShowConfirmClear(true)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--ink-faint)' }}
          >
            <Trash2 size={14} />
            <span>清空离线词库</span>
          </button>
        )}

        {showConfirmClear && (
          <div className="dict-confirm-box" style={{ width: '100%' }}>
            <span className="dict-confirm-msg">确定要清空本地离线词库吗？清空后划词将自动回退到在线机翻。</span>
            <div className="dict-confirm-actions">
              <button
                type="button"
                className="btn-danger-soft"
                onClick={async () => {
                  setShowConfirmClear(false)
                  setMeta({ status: 'uninstalled', entryCount: 0, updatedAt: Date.now() })
                  setProgress(null)
                  setErrorMsg(null)
                  await sendMessage({ type: 'dict-clear' })
                  refreshMeta()
                }}
              >
                确定清空
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setShowConfirmClear(false)}
              >
                取消
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="field" style={{ marginTop: 20 }}>
        <span>数据源地址</span>
        <div style={{ display: 'flex', gap: 8, width: '100%' }}>
          <input
            type="text"
            className="input"
            value={downloadUrl}
            disabled={isDownloading}
            onChange={e => onChange({ ...s, dict: { ...s.dict, enabled: s.dict?.enabled ?? true, downloadUrl: e.target.value } })}
            style={{ flex: 1, fontSize: 12, fontFamily: 'monospace' }}
          />
          {downloadUrl !== DEFAULT_SETTINGS.dict.downloadUrl && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => onChange({ ...s, dict: { ...s.dict, enabled: s.dict?.enabled ?? true, downloadUrl: DEFAULT_SETTINGS.dict.downloadUrl } })}
            >
              恢复默认
            </button>
          )}
        </div>
      </div>
      <p className="hint">基于 Open Dictionary 官方发布的开源词库数据包（gzip 压缩）。</p>
    </Section>
  )
}
