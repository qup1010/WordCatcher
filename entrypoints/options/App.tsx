import { Check } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { sendMessage } from '@/lib/messaging'
import { getSettings, isAiConfigured, saveSettings } from '@/lib/settings'
import { DEFAULT_SETTINGS, type Settings } from '@/lib/types'
import { StatusChip } from './components/controls'
import { AiSection } from './sections/AiSection'
import { AnkiSection } from './sections/AnkiSection'
import { DataSection } from './sections/DataSection'
import { DictSection } from './sections/DictSection'
import { MtSection } from './sections/MtSection'
import { UxSection } from './sections/UxSection'

const NAV_SECTIONS = [
  { id: 'sec-ai', label: 'AI 接口' },
  { id: 'sec-mt', label: '快速翻译' },
  { id: 'sec-dict', label: '离线词典' },
  { id: 'sec-anki', label: 'Anki 单词本' },
  { id: 'sec-ux', label: '划词与朗读' },
  { id: 'sec-data', label: '数据与维护' },
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
  const [activeNav, setActiveNav] = useState<string>(NAV_SECTIONS[0].id)
  const firstRender = useRef(true)

  useEffect(() => {
    void getSettings().then((v) => {
      setS(v)
      setLoaded(true)
    })
    // 打开页面时静默探测一次 Anki，让状态徽章一开始就是真的
    void sendMessage({ type: 'check-anki' }).then(res => setAnkiAlive(Boolean(res?.ok)))
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

  if (!loaded) return null

  const sectionProps = { s, onChange: setS, flush }

  return (
    <div className="shell">
      {/* ── 侧边栏 ── */}
      <aside className="side">
        <div className="brand">
          <div className="brand-word">word·<em>catcher</em></div>
          <div className="brand-meta">
            <span className="brand-reading">/wɜːd ˈkætʃə(r)/</span>
            <span className="brand-pos">n.</span>
          </div>
          <p className="brand-def">网页划词，离线词典/快译或 AI 语境释义，一键存入 Anki。</p>
        </div>

        <nav>
          {NAV_SECTIONS.map(({ id, label }) => (
            <a
              key={id}
              href={`#${id}`}
              className={activeNav === id ? 'nav-on' : ''}
              onClick={(e) => {
                e.preventDefault()
                document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }}
            >
              {label}
            </a>
          ))}
        </nav>

        <div className="side-status">
          <div className="status-row">
            <span>AI 接口</span>
            <StatusChip ok={aiReady} okText="已配置" badText="未配置" />
          </div>
          <div className="status-row">
            <span>Anki</span>
            {ankiAlive === null
              ? <span className="chip">检测中</span>
              : <StatusChip ok={ankiAlive} okText="已连接" badText="未连接" />}
          </div>
        </div>

        <div className={`save-note ${saveState !== 'idle' ? 'save-note-show' : ''}`}>
          {saveState === 'saving' && '保存中…'}
          {saveState === 'saved' && (
            <>
              <Check size={12} />
              <span>已自动保存</span>
            </>
          )}
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

        <p className="foot-note">设置修改后自动保存并立即生效。</p>
      </main>
    </div>
  )
}
