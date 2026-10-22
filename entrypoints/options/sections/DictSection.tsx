import { Download, RefreshCw, Trash2, Upload, X } from 'lucide-react'
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
      statusText: '正在准备下载…',
    })

    const cancel = startDictImport(downloadUrl, {
      onProgress: (p) => {
        setProgress(p)
      },
      onDone: () => {
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
      statusText: '正在解析本地文件…',
    })

    const controller = new AbortController()
    abortRef.current = () => controller.abort()

    void importLocalDictFile(file, {
      onProgress: (p) => {
        setProgress(p)
      },
      onDone: () => {
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
      index={1}
      title="离线词典"
      intro="安装 Open Dictionary 本地词库后，查询英文单词无需联网即可毫秒级响应。"
    >
      <div className="field">
        <span>启用离线词库</span>
        <div className="field-inline">
          <Switch
            checked={Boolean(s.dict?.enabled ?? true)}
            onChange={enabled => onChange({ ...s, dict: { ...s.dict, downloadUrl, enabled } })}
          />
          <span className="field-inline-label">单词优先查询本地词库，未收录词条与长句自动切换在线翻译</span>
        </div>
      </div>

      <div className="field">
        <span>词库状态</span>
        <div className="field-inline">
          <StatusChip
            ok={isReady}
            okText={`已就绪（${meta.entryCount.toLocaleString()} 词）`}
            badText={isDownloading ? '正在安装…' : '未安装'}
          />
        </div>
      </div>

      {isDownloading && progress && (
        <div className="result">
          <div className="dict-progress-card">
            <div className="dict-progress-head">
              <span>{progress.statusText}</span>
              <span>{progress.percent}%</span>
            </div>
            <div className="dict-progress-track">
              <div className="dict-progress-fill" style={{ width: `${progress.percent}%` }} />
            </div>
            <div className="dict-progress-foot">
              <button
                type="button"
                className="btn btn-icon"
                onClick={onCancelDownload}
              >
                <X size={13} />
                <span>取消安装</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {(errorMsg || (meta.status === 'error' && meta.errorMessage)) && (
        <div className="result">
          <p className="err">{errorMsg || meta.errorMessage}</p>
        </div>
      )}

      <div className="row dict-actions-row">
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
              className="btn btn-icon"
              onClick={onStartDownload}
            >
              {isReady ? <RefreshCw size={14} /> : <Download size={14} />}
              <span>{isReady ? '在线更新词库' : '在线下载安装（约 93 MB）'}</span>
            </button>

            <button
              type="button"
              className="btn btn-icon"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={14} />
              <span>从本地文件导入</span>
            </button>
          </>
        )}

        {isReady && !isDownloading && !showConfirmClear && (
          <button
            type="button"
            className="btn btn-icon btn-danger"
            onClick={() => setShowConfirmClear(true)}
          >
            <Trash2 size={14} />
            <span>清空离线词库</span>
          </button>
        )}
      </div>

      {showConfirmClear && (
        <div className="result">
          <div className="dict-confirm-box">
            <span className="dict-confirm-msg">确定清空本地离线词库？清空后查词将自动使用在线翻译，已收藏的生词库不受影响。</span>
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
                确认清空
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => setShowConfirmClear(false)}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      <details className="adv-details">
        <summary>高级选项：自定义词库下载源</summary>
        <div className="adv-details-body">
          <label className="field">
            <span>数据源地址</span>
            <input
              type="text"
              value={downloadUrl}
              disabled={isDownloading}
              onChange={e => onChange({ ...s, dict: { ...s.dict, enabled: s.dict?.enabled ?? true, downloadUrl: e.target.value } })}
            />
            {downloadUrl !== DEFAULT_SETTINGS.dict.downloadUrl && (
              <button
                type="button"
                className="btn"
                onClick={() => onChange({ ...s, dict: { ...s.dict, enabled: s.dict?.enabled ?? true, downloadUrl: DEFAULT_SETTINGS.dict.downloadUrl } })}
              >
                恢复默认
              </button>
            )}
          </label>
          <p className="hint">默认使用 Open Dictionary 官方发布的开源词库数据包（gzip 压缩）。</p>
        </div>
      </details>
    </Section>
  )
}
