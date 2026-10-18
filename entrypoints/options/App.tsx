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
  { id: 'sec-ux', label: '划词与朗读', icon: Volume2 },
  { id: 'sec-dict', label: '离线词典', icon: BookOpen },
  { id: 'sec-mt', label: '快速翻译', icon: Zap },
  { id: 'sec-ai', label: 'AI 语境详解', icon: Sparkles },
  { id: 'sec-data', label: '数据与单词本', icon: Database },
  { id: 'sec-anki', label: 'Anki 制卡', icon: Layers },
  { id: 'sec-about', label: '关于与致谢', icon: Info },
] as const

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
  const firstRender = useRef(true)
  const writeQueue = useRef<Promise<void>>(Promise.resolve())
  const writeSequence = useRef(0)

  // 顺序写入，避免快速连续修改时较早的配置覆盖较新的配置。
  const persist = useCallback((next: Settings) => {
    const sequence = ++writeSequence.current
    setSaveState('saving')
    const task = writeQueue.current.catch(() => {}).then(() => saveSettings(next))
    writeQueue.current = task
    void task.then(() => {
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
      setS(v)
      setLoaded(true)
    }).catch(() => setLoadError(true))
    refreshStatuses()
  }, [])

  // 修改立即开始保存，取消等待窗口；保存结果只反馈最新一次修改。
  useEffect(() => {
    if (!loaded) return
    if (firstRender.current) { firstRender.current = false; return }
    void persist(s).catch(() => {})
  }, [s, loaded, persist])

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

  // 测试/拉取前先落盘，保证 background 用的是页面上正在填的值
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

  const sectionProps = { s, onChange: setS, flush }

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
          <p className="brand-def">网页划词、语境解析与生词本复习工具。</p>
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
            <span>服务就绪状态</span>
          </div>
          <div className="side-status-list">
            <div className="status-row">
              <span>离线词库</span>
              <StatusChip
                ok={dictReady}
                okText="已就绪"
                badText="未安装"
              />
            </div>
            <div className="status-row">
              <span>AI 语境详解</span>
              <StatusChip ok={aiReady} okText="已配置" badText="未配置" />
            </div>
            <div className="status-row">
              <span>Anki 拓展</span>
              {!ankiEnabled
                ? <span className="chip">已关闭</span>
                : ankiAlive === null
                  ? <span className="chip">检测中</span>
                  : ankiAlive
                    ? <span className="chip chip-ok">已连接</span>
                    : <span className="chip">按需启动</span>}
            </div>
          </div>

          <div role={saveState === 'error' ? 'alert' : 'status'} className={`save-note save-note-show ${saveState === 'error' ? 'save-note-error' : ''}`}>
            {saveState === 'idle' && <span>修改后自动保存</span>}
            {saveState === 'saving' && <span>保存中…</span>}
            {saveState === 'saved' && (
              <>
                <Check size={12} />
                <span>已自动保存</span>
              </>
            )}
            {saveState === 'error' && (
              <>
                <AlertCircle size={12} />
                <span>保存失败</span>
                <button type="button" className="save-retry" onClick={() => void persist(s).catch(() => {})}>重试保存</button>
              </>
            )}
          </div>
        </div>
      </aside>

      {/* ── 主内容 ── */}
      <main>
        <UxSection {...sectionProps} />
        <DictSection {...sectionProps} />
        <MtSection {...sectionProps} />
        <AiSection {...sectionProps} />
        <DataSection {...sectionProps} />
        <AnkiSection {...sectionProps} onAliveChange={setAnkiAlive} />
        <AboutSection {...sectionProps} />

        <p className="foot-note">所有设置修改后立即自动保存并生效。</p>
      </main>
    </div>
  )
}
