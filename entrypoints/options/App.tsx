import { BookOpen, Check, Database, Info, Layers, Sparkles, Volume2, Zap } from 'lucide-react'
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
  { id: 'sec-ai', label: 'AI 接口', icon: Sparkles },
  { id: 'sec-mt', label: '快速翻译', icon: Zap },
  { id: 'sec-dict', label: '离线词典', icon: BookOpen },
  { id: 'sec-anki', label: 'Anki 单词本', icon: Layers },
  { id: 'sec-ux', label: '划词与朗读', icon: Volume2 },
  { id: 'sec-data', label: '数据与维护', icon: Database },
  { id: 'sec-about', label: '关于插件', icon: Info },
] as const

/**
 * 设置页的外壳：只管配置的读写、自动保存和导航，
 * 具体表单都在 sections/ 里，各分区自己持有自己的测试状态。
 */
export default function App() {
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS)
  const [loaded, setLoaded] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [ankiAlive, setAnkiAlive] = useState<boolean | null>(null)
  const [dictMeta, setDictMeta] = useState<DictMeta | null>(null)
  const [activeNav, setActiveNav] = useState<string>(NAV_SECTIONS[0].id)
  const firstRender = useRef(true)

  const refreshStatuses = () => {
    // 静默探测 Anki 与离线词库状态
    void sendMessage({ type: 'check-anki' }).then(res => setAnkiAlive(Boolean(res?.ok)))
    void sendMessage({ type: 'dict-status' }).then(res => res?.ok && setDictMeta(res.data))
  }

  useEffect(() => {
    void getSettings().then((v) => {
      setS(v)
      setLoaded(true)
    })
    refreshStatuses()
  }, [])

  // 自动保存：改动后 400ms 落盘，不需要手动点保存
  useEffect(() => {
    if (!loaded) return
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    setSaveState('saving')
    const t = setTimeout(() => {
      void saveSettings(s).then(() => {
        setSaveState('saved')
        setTimeout(() => setSaveState('idle'), 1600)
      })
    }, 400)
    return () => clearTimeout(t)
  }, [s, loaded])

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
    await saveSettings(s)
  }, [s])

  const aiReady = isAiConfigured(s)
  const dictReady = dictMeta?.status === 'ready' && dictMeta.entryCount > 0

  if (!loaded) return null

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
          <p className="brand-def">网页划词，离线词典/快译或 AI 语境释义，一键存入 Anki 单词本。</p>
        </div>

        <nav>
          {NAV_SECTIONS.map(({ id, label, icon: Icon }) => (
            <a
              key={id}
              href={`#${id}`}
              className={`nav-item ${activeNav === id ? 'nav-on' : ''}`}
              onClick={(e) => {
                e.preventDefault()
                document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
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
              <span>AI 接口</span>
              <StatusChip ok={aiReady} okText="已配置" badText="未配置" />
            </div>
            <div className="status-row">
              <span>离线词库</span>
              <StatusChip
                ok={dictReady}
                okText="已就绪"
                badText="未安装"
              />
            </div>
            <div className="status-row">
              <span>Anki 单词本</span>
              {ankiAlive === null
                ? <span className="chip">检测中</span>
                : <StatusChip ok={ankiAlive} okText="已连接" badText="未连接" />}
            </div>
          </div>

          <div className={`save-note ${saveState !== 'idle' ? 'save-note-show' : ''}`}>
            {saveState === 'saving' && <span>保存中…</span>}
            {saveState === 'saved' && (
              <>
                <Check size={12} />
                <span>已自动保存</span>
              </>
            )}
          </div>
        </div>
      </aside>

      {/* ── 主内容 ── */}
      <main>
        <AiSection {...sectionProps} />
        <MtSection {...sectionProps} />
        <DictSection {...sectionProps} />
        <AnkiSection {...sectionProps} onAliveChange={setAnkiAlive} />
        <UxSection {...sectionProps} />
        <DataSection {...sectionProps} />
        <AboutSection {...sectionProps} />

        <p className="foot-note">设置修改后自动保存并立即生效。</p>
      </main>
    </div>
  )
}
