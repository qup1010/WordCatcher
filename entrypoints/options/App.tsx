import { AlertCircle, BookOpen, Check, Database, Info, Layers, Sparkles, Volume2, Zap } from 'lucide-react'
import { browser } from '#imports'
import { useCallback, useEffect, useRef, useState } from 'react'
import { sendMessage } from '@/lib/messaging'
import type { DictMeta } from '@/lib/open-dict/types'
import { getSettings, isAiConfigured, saveSettings } from '@/lib/settings'
import { DEFAULT_SETTINGS, type Settings } from '@/lib/types'
import { StatusChip } from './components/controls'
import { AboutSection } from './sections/AboutSection'
import { AiSection } from './sections/AiSection'
import { AnkiSection } from './sections/AnkiSection'
import { DataSection } from './sections/DataSection'
import { DictSection } from './sections/DictSection'
import { MtSection } from './sections/MtSection'
import { UxSection } from './sections/UxSection'

const NAV_SECTIONS = [
  { id: 'sec-mt', label: '查词与翻译', icon: BookOpen },
  { id: 'sec-ai', label: 'AI 详解', icon: Sparkles },
  { id: 'sec-data', label: '词库与同步', icon: Database },
  { id: 'sec-anki', label: 'Anki', icon: Layers },
  { id: 'sec-ux', label: '操作与显示', icon: Volume2 },
  { id: 'sec-about', label: '关于', icon: Info },
] as const
const connections = (s: Settings) => ({ ai: s.ai, webdav: s.webdav, anki: s.anki })

/**
 * 设置页的外壳：只管配置的读写、自动保存和导航，
 * 具体表单都在 sections/ 里，各分区自己持有自己的测试状态。
 */
export default function App() {
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [ankiAlive, setAnkiAlive] = useState<boolean | null>(null)
  const [dictMeta, setDictMeta] = useState<DictMeta | null>(null)
  const [activeNav, setActiveNav] = useState<string>(NAV_SECTIONS[0].id)
  const applied = useRef(DEFAULT_SETTINGS)
  const desired = useRef(DEFAULT_SETTINGS)
  const [savedConnections, setSavedConnections] = useState(connections(DEFAULT_SETTINGS))
  const writeQueue = useRef<Promise<void>>(Promise.resolve())
  const writeSequence = useRef(0)

  // 顺序写入，避免快速连续修改时较早的配置覆盖较新的配置。
  const persist = useCallback((next: Settings) => {
    desired.current = next
    const sequence = ++writeSequence.current
    setSaveState('saving')
    const task = writeQueue.current.catch(() => {}).then(() => saveSettings(next))
    writeQueue.current = task
    void task.then(() => {
      applied.current = next
      setSavedConnections(connections(next))
      if (sequence === writeSequence.current) setSaveState('saved')
    }, () => {
      if (sequence === writeSequence.current) setSaveState('error')
    })
    return task
  }, [])

  const refreshStatuses = () => {
    // 静默探测 Anki 与离线词库状态
    void sendMessage({ type: 'check-anki' }).then(res => setAnkiAlive(Boolean(res?.ok)))
    void sendMessage({ type: 'dict-status' }).then(res => res?.ok && setDictMeta(res.data))
  }

  useEffect(() => {
    void getSettings().then((v) => {
      applied.current = v
      desired.current = v
      setSavedConnections(connections(v))
      setS(v)
      setLoaded(true)
    }).catch(() => setLoadError(true))
    refreshStatuses()
  }, [])

  const dirty = JSON.stringify(connections(s)) !== JSON.stringify(savedConnections)
  const change = (next: Settings) => {
    setS(next)
    const preferences = { ...next, ...connections(desired.current) }
    if (JSON.stringify(preferences) !== JSON.stringify(desired.current)) void persist(preferences).catch(() => {})
  }
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  // 滚动时高亮侧边栏当前分区
  useEffect(() => {
    if (!loaded) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActiveNav(e.target.id)
        }
      },
      { rootMargin: '-15% 0px -75% 0px' },
    )
    for (const { id } of NAV_SECTIONS) {
      const el = document.getElementById(id)
      if (el) observer.observe(el)
    }
    return () => observer.disconnect()
  }, [loaded])

  // 仅在用户明确保存连接配置时提交当前草稿。
  const flush = useCallback(async () => {
    await persist(s)
  }, [s, persist])

  const aiReady = isAiConfigured(s)
  const dictReady = dictMeta?.status === 'ready' && dictMeta.entryCount > 0
  const ankiEnabled = s.anki.enabled !== false

  if (!loaded) return <div className="settings-loading" role={loadError ? 'alert' : 'status'}>
    <strong>{loadError ? '无法读取设置' : '正在加载设置…'}</strong>
    {loadError && <button type="button" className="save-retry" onClick={() => window.location.reload()}>重新加载</button>}
  </div>

  const sectionProps = { s, onChange: change, flush, connectionsDirty: dirty }

  const appVersion = browser.runtime.getManifest?.()?.version || '0.1.1'

  return (
    <div className="shell">
      {/* ── 侧边栏 ── */}
      <aside className="side">
        <div className="brand">
          <div className="brand-header">
            <div className="brand-word">word·<em>catcher</em></div>
            <span className="brand-badge">v{appVersion}</span>
          </div>
          <div className="brand-meta">
            <span className="brand-reading">/wɜːd ˈkætʃə(r)/</span>
            <span className="brand-pos">n.</span>
          </div>
          <p className="brand-def">查词、收藏原句，回顾阅读中的生词。</p>
        </div>

        <nav aria-label="设置分区">
          {NAV_SECTIONS.map(({ id, label, icon: Icon }) => (
            <a
              key={id}
              href={`#${id}`}
              aria-current={activeNav === id ? 'location' : undefined}
              className={`nav-item ${activeNav === id ? 'nav-on' : ''}`}
              onClick={(e) => {
                e.preventDefault()
                document.getElementById(id)?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' })
              }}
            >
              <Icon size={15} className="nav-icon" />
              <span>{label}</span>
            </a>
          ))}
        </nav>

        <div className="side-status-card">
          <div className="side-status-title">
            <span className="side-status-dot" />
            <span>配置概览</span>
          </div>
          <div className="side-status-list">
            <div className="status-row">
              <span>离线词典</span>
              <StatusChip
                ok={dictReady}
                okText="已安装"
                badText="未安装"
              />
            </div>
            <div className="status-row">
              <span>AI 详解</span>
              <StatusChip ok={aiReady} okText="已填写" badText="未填写" />
            </div>
            <div className="status-row">
              <span>Anki 连接</span>
              {!ankiEnabled
                ? <span className="chip">未启用</span>
                : ankiAlive === null
                  ? <span className="chip">检测中</span>
                  : ankiAlive
                    ? <span className="chip chip-ok">已连接</span>
                    : <span className="chip">未连接</span>}
            </div>
          </div>

          <div role={saveState === 'error' ? 'alert' : 'status'} className={`save-note save-note-show ${saveState === 'error' ? 'save-note-error' : ''}`}>
            {saveState === 'idle' && <span>{dirty ? '有配置尚未保存' : '翻译、词典与操作选项自动保存'}</span>}
            {saveState === 'saving' && <span>保存中…</span>}
            {saveState === 'saved' && (
              <>
                <Check size={12} />
                <span>{dirty ? '有配置尚未保存' : '设置已保存'}</span>
              </>
            )}
            {saveState === 'error' && (
              <>
                <AlertCircle size={12} />
                <span>保存失败，填写内容已保留</span>
                <button type="button" className="save-retry" onClick={() => void persist(desired.current).catch(() => {})}>重试保存</button>
              </>
            )}
          </div>
        </div>
      </aside>

      {/* ── 主内容 ── */}
      <main>
        <p className="settings-save-help">翻译、词典和操作选项修改后自动保存。AI、WebDAV 和 Anki 配置需点击「保存配置」后生效；可先用当前填写内容测试连接。</p>
        <MtSection {...sectionProps} />
        <DictSection {...sectionProps} onMetaChange={setDictMeta} />
        <AiSection {...sectionProps} />
        <DataSection {...sectionProps} />
        <AnkiSection {...sectionProps} onAliveChange={setAnkiAlive} />
        <UxSection {...sectionProps} />
        <AboutSection {...sectionProps} />

        {dirty && <div className="settings-save-bar" role="status">
          <span>配置有未保存的修改</span>
          <button className="btn" disabled={!dirty || saveState === 'saving'} onClick={() => void flush().catch(() => {})}>保存配置</button>
          <button className="btn" disabled={!dirty || saveState === 'saving'} onClick={() => { desired.current = { ...s, ...connections(applied.current) }; setS(desired.current) }}>放弃修改</button>
        </div>}
      </main>
    </div>
  )
}
