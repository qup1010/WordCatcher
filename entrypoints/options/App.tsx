import { Check, ChevronDown, Plus, RefreshCw, Sparkles, Trash2, Volume2, Zap } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { sendMessage } from '@/lib/messaging'
import { activeAiProfile, getSettings, isAiConfigured, saveSettings } from '@/lib/settings'
import { type AiProfile, DEFAULT_SETTINGS, type Settings } from '@/lib/types'
import { EXPLAIN_LANGUAGES, LANGUAGE_PRESETS, PROVIDER_PRESETS } from './presets'

type Status = { kind: 'idle' } | { kind: 'busy' } | { kind: 'ok', text: string } | { kind: 'err', text: string }

const NAV_SECTIONS = [
  { id: 'sec-ai', label: 'AI 接口' },
  { id: 'sec-mt', label: '快速翻译' },
  { id: 'sec-anki', label: 'Anki 单词本' },
  { id: 'sec-ux', label: '划词与朗读' },
] as const

function Chip({ ok, okText, badText }: { ok: boolean, okText: string, badText: string }) {
  return <span className={`chip ${ok ? 'chip-ok' : 'chip-bad'}`}>{ok ? okText : badText}</span>
}

/** 分段选择控件（替代原生 radio） */
function Segmented<T extends string>({ value, options, onChange }: {
  value: T
  options: Array<{ value: T, label: string }>
  onChange: (v: T) => void
}) {
  return (
    <div className="seg" role="radiogroup">
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? 'seg-on' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/**
 * 可输入的下拉选择器。
 *
 * 原生 `<input list>` + `<datalist>` 在 Chrome 里没有可点的下拉箭头，
 * 只在输入内容恰好匹配时才偶尔弹出，实际上等于不可用，所以自己实现。
 */
function Combobox({ value, options, placeholder, open, onOpenChange, onChange }: {
  value: string
  options: string[]
  placeholder?: string
  open: boolean
  onOpenChange: (v: boolean) => void
  onChange: (v: string) => void
}) {
  const [highlight, setHighlight] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const q = value.trim().toLowerCase()
  // 输入内容正好是某个选项时展示全部，方便直接换一个
  const shown = options.includes(value.trim())
    ? options
    : options.filter(o => o.toLowerCase().includes(q))

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onOpenChange(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open, onOpenChange])

  useEffect(() => {
    if (!open) return
    ;(listRef.current?.children[highlight] as HTMLElement | undefined)
      ?.scrollIntoView({ block: 'nearest' })
  }, [highlight, open])

  const commit = (v: string) => {
    onChange(v)
    onOpenChange(false)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) return onOpenChange(true)
      setHighlight(h => Math.min(h + 1, shown.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight(h => Math.max(h - 1, 0))
    } else if (e.key === 'Enter' && open && shown[highlight]) {
      e.preventDefault()
      commit(shown[highlight])
    } else if (e.key === 'Escape') {
      onOpenChange(false)
    }
  }

  return (
    <div className="combo" ref={rootRef}>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value)
          setHighlight(0)
          if (options.length) onOpenChange(true)
        }}
        onKeyDown={onKeyDown}
      />
      {options.length > 0 && (
        <button
          type="button"
          className="combo-toggle"
          tabIndex={-1}
          title={open ? '收起' : `展开 ${options.length} 个模型`}
          onClick={() => {
            onOpenChange(!open)
            setHighlight(0)
          }}
        >
          <ChevronDown size={14} className={open ? 'flip' : ''} />
        </button>
      )}
      {open && shown.length > 0 && (
        <ul className="combo-list" ref={listRef}>
          {shown.map((o, i) => (
            <li
              key={o}
              className={`combo-item ${i === highlight ? 'on' : ''}`}
              onMouseEnter={() => setHighlight(i)}
              // mousedown 而非 click：避免输入框先失焦导致列表被关掉
              onMouseDown={(e) => {
                e.preventDefault()
                commit(o)
              }}
            >
              <span>{o}</span>
              {o === value.trim() && <Check size={13} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** 开关控件（替代原生 checkbox） */
function Switch({ checked, onChange }: { checked: boolean, onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={`switch ${checked ? 'switch-on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-knob" />
    </button>
  )
}

export default function App() {
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS)
  const [loaded, setLoaded] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [aiStatus, setAiStatus] = useState<Status>({ kind: 'idle' })
  const [aiReply, setAiReply] = useState<string | null>(null)
  const [ankiStatus, setAnkiStatus] = useState<Status>({ kind: 'idle' })
  const [ankiAlive, setAnkiAlive] = useState<boolean | null>(null)
  const [models, setModels] = useState<string[]>([])
  const [modelsStatus, setModelsStatus] = useState<Status>({ kind: 'idle' })
  const [modelOpen, setModelOpen] = useState(false)
  const [activeNav, setActiveNav] = useState<string>(NAV_SECTIONS[0].id)
  const firstRender = useRef(true)

  useEffect(() => {
    void getSettings().then((v) => {
      setS(v)
      setLoaded(true)
    })
    // 打开页面时静默探测一次 Anki，让状态徽章一开始就是真的
    void sendMessage({ type: 'check-anki' }).then(res => setAnkiAlive(res.ok))
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

  const patch = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setS(prev => ({ ...prev, [key]: value }))

  const patchSection = <K extends 'anki' | 'tts' | 'mt'>(key: K, part: Partial<Settings[K]>) =>
    setS(prev => ({ ...prev, [key]: { ...prev[key], ...part } }))

  // ── AI 多配置 ──
  const active = activeAiProfile(s)

  const resetAiFeedback = () => {
    setModels([])
    setModelsStatus({ kind: 'idle' })
    setModelOpen(false)
    setAiStatus({ kind: 'idle' })
    setAiReply(null)
  }

  const patchProfile = (part: Partial<AiProfile>) =>
    setS(prev => ({
      ...prev,
      ai: {
        ...prev.ai,
        profiles: prev.ai.profiles.map(p => (p.id === prev.ai.activeId ? { ...p, ...part } : p)),
      },
    }))

  const switchProfile = (id: string) => {
    resetAiFeedback()
    setS(prev => ({ ...prev, ai: { ...prev.ai, activeId: id } }))
  }

  const addProfile = () => {
    resetAiFeedback()
    const id = crypto.randomUUID()
    setS(prev => ({
      ...prev,
      ai: {
        profiles: [
          ...prev.ai.profiles,
          // 以当前配置为模板起步，改名和 key 就能用
          { ...activeAiProfile(prev), id, name: `配置 ${prev.ai.profiles.length + 1}` },
        ],
        activeId: id,
      },
    }))
  }

  const removeProfile = () => {
    resetAiFeedback()
    setS((prev) => {
      if (prev.ai.profiles.length <= 1) return prev
      const rest = prev.ai.profiles.filter(p => p.id !== prev.ai.activeId)
      return { ...prev, ai: { profiles: rest, activeId: rest[0].id } }
    })
  }

  // 测试/拉取前先落盘，保证用的是页面上正在填的值
  const flush = useCallback(async () => {
    await saveSettings(s)
  }, [s])

  const onFetchModels = async () => {
    setModelsStatus({ kind: 'busy' })
    await flush()
    const res = await sendMessage({ type: 'list-models' })
    if (res.ok) {
      setModels(res.data.models)
      setModelsStatus({ kind: 'ok', text: `已拉取 ${res.data.models.length} 个模型` })
      setModelOpen(true) // 拉完直接展开，省一次点击
    } else {
      setModelsStatus({ kind: 'err', text: res.error })
    }
  }

  const onTestAi = async () => {
    setAiStatus({ kind: 'busy' })
    setAiReply(null)
    await flush()
    const res = await sendMessage({ type: 'test-ai' })
    if (res.ok) {
      setAiReply(res.data.reply)
      setAiStatus({ kind: 'ok', text: '连接正常，模型回复：' })
    } else {
      setAiStatus({ kind: 'err', text: res.error })
    }
  }

  const onTestAnki = async () => {
    setAnkiStatus({ kind: 'busy' })
    await flush()
    const res = await sendMessage({ type: 'check-anki' })
    setAnkiAlive(res.ok)
    if (!res.ok) {
      setAnkiStatus({ kind: 'err', text: res.error })
      return
    }
    const sync = await sendMessage({ type: 'sync-anki-templates' })
    setAnkiStatus(sync.ok
      ? { kind: 'ok', text: `连接正常（AnkiConnect v${res.data.version}），卡片模板已同步。` }
      : { kind: 'ok', text: `连接正常（v${res.data.version}）。首张卡保存时会自动创建模板。` })
  }

  const currentLang = LANGUAGE_PRESETS.find(l => l.ttsLang === s.tts.lang)
  const aiReady = isAiConfigured(s)

  if (!loaded) return null

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
          <p className="brand-def">网页划词，快速翻译或 AI 语境详解，存入 Anki。</p>
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
            <Chip ok={aiReady} okText="已配置" badText="未配置" />
          </div>
          <div className="status-row">
            <span>Anki</span>
            {ankiAlive === null
              ? <span className="chip">检测中</span>
              : <Chip ok={ankiAlive} okText="已连接" badText="未连接" />}
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
        <section id="sec-ai" style={{ '--i': 0 } as React.CSSProperties}>
          <h2>AI 接口</h2>
          <p className="muted">用于 AI 详解。兼容 OpenAI 接口的服务均可，点击标签切换配置。</p>

          <div className="profiles">
            {s.ai.profiles.map(p => (
              <button
                key={p.id}
                type="button"
                className={`profile-chip ${p.id === s.ai.activeId ? 'profile-on' : ''}`}
                onClick={() => switchProfile(p.id)}
              >
                {p.name}
              </button>
            ))}
            <button type="button" className="profile-chip profile-add" title="新建配置" onClick={addProfile}>
              <Plus size={13} />
            </button>
          </div>

          <label className="field">
            <span>配置名称</span>
            <input
              value={active.name}
              onChange={e => patchProfile({ name: e.target.value })}
            />
            {s.ai.profiles.length > 1 && (
              <button
                type="button"
                className="btn btn-icon btn-danger"
                title="删除这套配置"
                onClick={removeProfile}
              >
                <Trash2 size={14} />
              </button>
            )}
          </label>

          <label className="field">
            <span>服务商预设</span>
            <select
              value=""
              onChange={(e) => {
                const p = PROVIDER_PRESETS.find(x => x.label === e.target.value)
                if (p) {
                  patchProfile({ baseURL: p.baseURL, model: p.model })
                  setModels([])
                  setModelsStatus({ kind: 'idle' })
                }
              }}
            >
              <option value="">选择后自动填入地址和模型…</option>
              {PROVIDER_PRESETS.map(p => <option key={p.label} value={p.label}>{p.label}</option>)}
            </select>
          </label>

          <label className="field">
            <span>Base URL</span>
            <input
              value={active.baseURL}
              placeholder="https://api.openai.com/v1"
              onChange={e => patchProfile({ baseURL: e.target.value })}
            />
          </label>
          <p className="hint">以 /v1 这类版本路径结尾。</p>

          <label className="field">
            <span>API Key</span>
            <input
              type="password"
              value={active.apiKey}
              placeholder="sk-…"
              onChange={e => patchProfile({ apiKey: e.target.value })}
            />
          </label>
          <p className="hint">仅保存在本机浏览器里。</p>

          <div className="field">
            <span>模型</span>
            <Combobox
              value={active.model}
              options={models}
              placeholder="gpt-4o-mini"
              open={modelOpen}
              onOpenChange={setModelOpen}
              onChange={v => patchProfile({ model: v })}
            />
            <button
              type="button"
              className="btn btn-icon"
              title="从端点拉取模型列表"
              disabled={modelsStatus.kind === 'busy'}
              onClick={() => void onFetchModels()}
            >
              <RefreshCw size={14} className={modelsStatus.kind === 'busy' ? 'spin' : ''} />
              <span>拉取列表</span>
            </button>
          </div>
          {modelsStatus.kind === 'ok' && <p className="hint hint-ok">{modelsStatus.text}</p>}
          {modelsStatus.kind === 'err' && <p className="hint hint-err">{modelsStatus.text}</p>}

          <label className="field">
            <span>释义语言</span>
            <select
              value={s.explainLanguage}
              onChange={e => patch('explainLanguage', e.target.value)}
            >
              {EXPLAIN_LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </label>
          <p className="hint">同时用于快速翻译的目标语言。</p>

          <div className="row">
            <button className="btn" onClick={() => void onTestAi()} disabled={aiStatus.kind === 'busy'}>
              {aiStatus.kind === 'busy' ? '正在请求模型…' : '测试 AI'}
            </button>
          </div>

          {aiStatus.kind === 'ok' && (
            <div className="ok">
              <p>{aiStatus.text}</p>
              {aiReply && <div className="reply">{aiReply}</div>}
            </div>
          )}
          {aiStatus.kind === 'err' && <p className="err">{aiStatus.text}</p>}
        </section>

        <section id="sec-mt" style={{ '--i': 1 } as React.CSSProperties}>
          <h2>快速翻译</h2>
          <p className="muted">
            划词后点 <Zap size={13} className="inline-icon" /> 使用，不消耗 AI 额度。
            所选服务失败时自动切换另一家。
          </p>

          <div className="field">
            <span>翻译服务</span>
            <Segmented
              value={s.mt.provider}
              options={[
                { value: 'microsoft', label: '微软翻译' },
                { value: 'google', label: '谷歌翻译' },
              ]}
              onChange={v => patchSection('mt', { provider: v })}
            />
          </div>
          <p className="hint">谷歌翻译在部分网络环境下无法连接。</p>
        </section>

        <section id="sec-anki" style={{ '--i': 2 } as React.CSSProperties}>
          <h2>Anki 单词本</h2>
          <p className="muted">
            卡片写入本地 Anki。需要
            <a href="https://apps.ankiweb.net/" target="_blank" rel="noreferrer"> Anki 桌面版</a>
            和 AnkiConnect 插件（附加组件代码 <code>2055492159</code>），使用时保持 Anki 运行。
          </p>

          <label className="field">
            <span>AnkiConnect 地址</span>
            <input
              value={s.anki.url}
              onChange={e => patchSection('anki', { url: e.target.value })}
            />
          </label>

          <label className="field">
            <span>牌组</span>
            <input
              value={s.anki.deckName}
              onChange={e => patchSection('anki', { deckName: e.target.value })}
            />
          </label>
          <p className="hint">不存在会自动创建。</p>

          <label className="field">
            <span>笔记类型</span>
            <input
              value={s.anki.noteTypeName}
              onChange={e => patchSection('anki', { noteTypeName: e.target.value })}
            />
          </label>

          <div className="field">
            <span>原句挖空</span>
            <div className="field-inline">
              <Switch
                checked={s.anki.clozeContext}
                onChange={v => patchSection('anki', { clozeContext: v })}
              />
              <span className="field-inline-label">卡片正面隐去原句中的目标词</span>
            </div>
          </div>

          <div className="row">
            <button className="btn" onClick={() => void onTestAnki()} disabled={ankiStatus.kind === 'busy'}>
              {ankiStatus.kind === 'busy' ? '检测中…' : '测试连接并同步卡片模板'}
            </button>
          </div>

          {ankiStatus.kind === 'ok' && <p className="ok">{ankiStatus.text}</p>}
          {ankiStatus.kind === 'err' && (
            <div className="err">
              <p>{ankiStatus.text}</p>
              <details>
                <summary>排查步骤</summary>
                <ol>
                  <li>确认 Anki 桌面版正在运行（不是手机版或网页版）。</li>
                  <li>「工具 → 附加组件」里确认有 AnkiConnect；没有则用代码 <code>2055492159</code> 安装并重启。</li>
                  <li>
                    仍失败：选中 AnkiConnect →「配置」，在 <code>webCorsOriginList</code> 里
                    加一项 <code>"*"</code>，重启 Anki。
                  </li>
                </ol>
              </details>
            </div>
          )}
        </section>

        <section id="sec-ux" style={{ '--i': 3 } as React.CSSProperties}>
          <h2>划词与朗读</h2>

          <div className="field">
            <span>触发方式</span>
            <Segmented
              value={s.triggerMode}
              options={[
                { value: 'icon', label: '先显示按钮' },
                { value: 'auto', label: '直接 AI 详解' },
              ]}
              onChange={v => patch('triggerMode', v)}
            />
          </div>
          <p className="hint">「直接 AI 详解」会跳过快译，每次划词都调用 AI。</p>

          <label className="field">
            <span>学习语言</span>
            <select
              value={currentLang?.label ?? ''}
              onChange={(e) => {
                const l = LANGUAGE_PRESETS.find(x => x.label === e.target.value)
                if (!l) return
                patchSection('tts', { lang: l.ttsLang })
                patchSection('anki', { ttsLang: l.ankiTtsLang })
              }}
            >
              {!currentLang && <option value="">自定义（{s.tts.lang}）</option>}
              {LANGUAGE_PRESETS.map(l => <option key={l.label} value={l.label}>{l.label}</option>)}
            </select>
          </label>
          <p className="hint">决定试听与 Anki 卡片朗读的发音。</p>

          <div className="field">
            <span>试听按钮</span>
            <div className="field-inline">
              <Switch
                checked={s.tts.enabled}
                onChange={v => patchSection('tts', { enabled: v })}
              />
              <span className="field-inline-label">
                在面板中显示（<Volume2 size={13} className="inline-icon" />）
              </span>
            </div>
          </div>

          <label className="field">
            <span>语速</span>
            <input
              type="range"
              min={0.5}
              max={1.5}
              step={0.1}
              value={s.tts.rate}
              onChange={e => patchSection('tts', { rate: Number(e.target.value) })}
            />
            <span className="value">{s.tts.rate.toFixed(1)}×</span>
          </label>
        </section>

        <p className="foot-note">设置修改后自动保存并立即生效。</p>
      </main>
    </div>
  )
}
