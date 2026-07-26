import { Check, Sparkles, Volume2, Zap } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { MtProvider } from '@/lib/machine-translate'
import { MT_PROVIDER_LABELS } from '@/lib/machine-translate'
import { sendMessage } from '@/lib/messaging'
import { type SelectionContext, extractContext } from '@/lib/selection-context'
import { getSettings, watchSettings } from '@/lib/settings'
import { isTtsSupported, speak, stopSpeaking } from '@/lib/tts'
import { DEFAULT_SETTINGS, type Settings, type WordEntry } from '@/lib/types'

const PANEL_WIDTH = 372
const QUICK_WIDTH = 304
const PILL_WIDTH = 152
const PILL_HEIGHT = 34
const GAP = 8

/** 三点呼吸加载指示 */
function Dots() {
  return (
    <span className="wc-dots" aria-hidden>
      <i />
      <i />
      <i />
    </span>
  )
}

type Phase =
  | { kind: 'hidden' }
  | { kind: 'trigger' }
  | { kind: 'quick-loading' }
  | { kind: 'quick', translation: string, provider: MtProvider, fellBack: boolean }
  | { kind: 'quick-error', message: string }
  | { kind: 'loading' }
  | { kind: 'result', entry: WordEntry }
  | { kind: 'error', message: string }

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'failed', message: string }

interface Anchor {
  ctx: SelectionContext
  range: Range
  rect: DOMRect
}

function isEditable(node: Node | null): boolean {
  let el = node instanceof Element ? node : node?.parentElement
  while (el) {
    const tag = el.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA') return true
    if ((el as HTMLElement).isContentEditable) return true
    el = el.parentElement
  }
  return false
}

/** 面板放在选区下方，放不下就翻到上方；左右都夹在视口内 */
function place(rect: DOMRect, width: number, height: number) {
  let left = rect.left
  if (left + width > window.innerWidth - GAP) left = window.innerWidth - width - GAP
  if (left < GAP) left = GAP

  const below = window.innerHeight - rect.bottom - GAP
  const above = rect.top - GAP
  const top = height <= below || below >= above
    ? rect.bottom + GAP
    : Math.max(GAP, rect.top - height - GAP)

  return { left, top }
}

/** 把原句里的目标词标出来，让"这个词在这句话里"一眼可见 */
function highlight(sentence: string, selection: string) {
  const at = sentence.toLowerCase().indexOf(selection.trim().toLowerCase())
  if (at === -1 || !selection.trim()) return sentence

  return (
    <>
      {sentence.slice(0, at)}
      <mark>{sentence.slice(at, at + selection.trim().length)}</mark>
      {sentence.slice(at + selection.trim().length)}
    </>
  )
}

export default function App({ shadowHost }: { shadowHost: HTMLElement }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [phase, setPhase] = useState<Phase>({ kind: 'hidden' })
  const [save, setSave] = useState<SaveState>({ kind: 'idle' })
  const [anchor, setAnchor] = useState<Anchor | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: PANEL_WIDTH, height: 0 })

  useEffect(() => {
    void getSettings().then(setSettings)
    return watchSettings(setSettings)
  }, [])

  const dismiss = useCallback(() => {
    stopSpeaking()
    setPhase({ kind: 'hidden' })
    setSave({ kind: 'idle' })
    setAnchor(null)
  }, [])

  const lookup = useCallback(async (ctx: SelectionContext) => {
    setPhase({ kind: 'loading' })
    const res = await sendMessage({ type: 'generate-entry', payload: ctx })
    setPhase(res.ok
      ? { kind: 'result', entry: res.data }
      : { kind: 'error', message: res.error })
  }, [])

  const quickLookup = useCallback(async (ctx: SelectionContext) => {
    setPhase({ kind: 'quick-loading' })
    const res = await sendMessage({ type: 'quick-translate', payload: { text: ctx.selection } })
    setPhase(res.ok
      ? { kind: 'quick', ...res.data }
      : { kind: 'quick-error', message: res.error })
  }, [])

  // ── 选区监听 ──────────────────────────────────
  useEffect(() => {
    const insideUi = (target: EventTarget | null) =>
      target instanceof Node && shadowHost.contains(target)

    const onMouseUp = (e: MouseEvent) => {
      if (insideUi(e.target)) return

      // 交给浏览器先把选区结算完，否则拿到的还是上一次的
      setTimeout(() => {
        const sel = window.getSelection()
        if (!sel || sel.isCollapsed || sel.rangeCount === 0) return
        if (isEditable(sel.anchorNode)) return

        const range = sel.getRangeAt(0)
        const ctx = extractContext(range)
        if (!ctx) return

        const rect = range.getBoundingClientRect()
        setAnchor({ ctx, range: range.cloneRange(), rect })
        setSave({ kind: 'idle' })

        if (settings.triggerMode === 'auto') void lookup(ctx)
        else setPhase({ kind: 'trigger' })
      }, 0)
    }

    const onMouseDown = (e: MouseEvent) => {
      if (!insideUi(e.target)) dismiss()
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss()
    }

    document.addEventListener('mouseup', onMouseUp)
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mouseup', onMouseUp)
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [shadowHost, settings.triggerMode, lookup, dismiss])

  // 页面滚动时重新贴合选区，否则面板会飘在错误的位置
  useEffect(() => {
    if (phase.kind === 'hidden' || !anchor) return

    const reposition = () => {
      setAnchor(prev => (prev ? { ...prev, rect: prev.range.getBoundingClientRect() } : prev))
    }
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [phase.kind, anchor?.range])

  // 面板高度是内容撑出来的，量到之后才能决定往上翻还是往下放
  useEffect(() => {
    if (!panelRef.current) return
    const el = panelRef.current
    const observer = new ResizeObserver(() => {
      setSize({ width: el.offsetWidth, height: el.offsetHeight })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [phase.kind])

  const saveCard = useCallback(async (entry: WordEntry) => {
    if (!anchor) return

    setSave({ kind: 'saving' })
    const res = await sendMessage({
      type: 'save-card',
      payload: {
        entry,
        selection: anchor.ctx.selection,
        sentence: anchor.ctx.sentence,
        pageUrl: location.href,
        pageTitle: document.title,
        createdAt: Date.now(),
      },
    })

    if (res.ok) {
      setSave({ kind: 'saved' })
      setTimeout(dismiss, 1200)
    } else {
      setSave({ kind: 'failed', message: res.error })
    }
  }, [anchor, dismiss])

  const onSave = useCallback(async () => {
    if (phase.kind !== 'result') return
    await saveCard(phase.entry)
  }, [phase, saveCard])

  /** 快译结果直接存卡：没有 AI 的词形还原和语境释义，用机器翻译当释义 */
  const onSaveQuick = useCallback(async () => {
    if (phase.kind !== 'quick' || !anchor) return
    await saveCard({
      word: anchor.ctx.selection,
      reading: '',
      partOfSpeech: '',
      definition: phase.translation,
      contextTranslation: '',
    })
  }, [phase, anchor, saveCard])

  if (phase.kind === 'hidden' || !anchor) return null

  const speakText = (text: string) =>
    speak(text, { lang: settings.tts.lang, rate: settings.tts.rate })

  const ttsReady = settings.tts.enabled && isTtsSupported()

  // ── 触发胶囊：⚡ 快译 | ✨ AI 词条 ────────────────
  if (phase.kind === 'trigger') {
    const pos = place(anchor.rect, PILL_WIDTH, PILL_HEIGHT)
    return (
      <div className="wc-root wc-layer" style={pos}>
        <div className="wc-pill">
          <button title="免费机器翻译，即时出结果" onClick={() => void quickLookup(anchor.ctx)}>
            <Zap size={14} />
            <span>快译</span>
          </button>
          <div className="wc-pill-sep" />
          <button title="AI 结合原句给出语境释义，可存入 Anki" onClick={() => void lookup(anchor.ctx)}>
            <Sparkles size={14} />
            <span>AI 详解</span>
          </button>
        </div>
      </div>
    )
  }

  // ── 快译迷你面板 ──────────────────────────────
  if (phase.kind === 'quick-loading' || phase.kind === 'quick' || phase.kind === 'quick-error') {
    const pos = place(anchor.rect, QUICK_WIDTH, size.height || 90)
    return (
      <div className="wc-root wc-layer" style={pos}>
        <div className="wc-panel wc-panel-quick" ref={panelRef}>
          <div className="wc-fade" key={phase.kind}>
            <div className="wc-quick-head">
              <span className="wc-quick-word">{anchor.ctx.selection}</span>
              {ttsReady && (
                <button
                  className="wc-speak"
                  title="试听读音"
                  onClick={() => speakText(anchor.ctx.selection)}
                >
                  <Volume2 size={15} />
                </button>
              )}
            </div>

            {phase.kind === 'quick-loading' && (
              <div className="wc-state">
                <Dots />
                <span>翻译中</span>
              </div>
            )}

            {phase.kind === 'quick' && (
              <>
                <div className="wc-quick-trans">{phase.translation}</div>
                {/* 来源标注单独一行：塞进按钮行会把面板挤到折行 */}
                <div className="wc-caption wc-caption-block">
                  {MT_PROVIDER_LABELS[phase.provider]}
                  {phase.fellBack && ' · 已自动切换'}
                </div>
              </>
            )}

            {phase.kind === 'quick-error' && (
              <div className="wc-error">{phase.message}</div>
            )}

            <div className="wc-actions wc-actions-tight">
              <button
                className="wc-btn wc-btn-ghost wc-btn-accent"
                title="AI 结合原句给出语境释义"
                onClick={() => void lookup(anchor.ctx)}
              >
                <Sparkles size={14} />
                <span>AI 详解</span>
              </button>
              {phase.kind === 'quick' && (
                <button
                  className="wc-btn wc-btn-ghost"
                  disabled={save.kind === 'saving' || save.kind === 'saved'}
                  onClick={() => void onSaveQuick()}
                >
                  {save.kind === 'saving' ? '保存中' : save.kind === 'saved' ? '已存入' : '存入 Anki'}
                </button>
              )}
              <div className="wc-spacer" />
              <button className="wc-btn wc-btn-ghost" onClick={dismiss}>关闭</button>
            </div>

            {save.kind === 'failed' && (
              <div className="wc-error" style={{ marginTop: 8 }}>{save.message}</div>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ── AI 词条面板 ──────────────────────────────
  const pos = place(anchor.rect, size.width || PANEL_WIDTH, size.height)

  return (
    <div className="wc-root wc-layer" style={pos}>
      <div className="wc-panel" ref={panelRef}>
        <div className="wc-fade" key={phase.kind}>
        {phase.kind === 'loading' && (
          <div className="wc-state">
            <Dots />
            <span>正在结合上下文解释「{anchor.ctx.selection}」</span>
          </div>
        )}

        {phase.kind === 'error' && (
          <>
            <div className="wc-error">{phase.message}</div>
            <div className="wc-actions">
              <button className="wc-btn wc-btn-primary" onClick={() => void lookup(anchor.ctx)}>
                重试
              </button>
              <button
                className="wc-btn wc-btn-ghost"
                onClick={() => void sendMessage({ type: 'open-options' })}
              >
                打开设置
              </button>
              <div className="wc-spacer" />
              <button className="wc-btn wc-btn-ghost" onClick={dismiss}>关闭</button>
            </div>
          </>
        )}

        {phase.kind === 'result' && (
          <>
            <div className="wc-head">
              <span className="wc-word">{phase.entry.word}</span>
              {phase.entry.reading && <span className="wc-reading">/{phase.entry.reading}/</span>}
              {ttsReady && (
                <button
                  className="wc-speak"
                  title="试听读音"
                  onClick={() => speakText(phase.entry.word)}
                >
                  <Volume2 size={16} />
                </button>
              )}
              {phase.entry.partOfSpeech && (
                <span className="wc-pos">{phase.entry.partOfSpeech}</span>
              )}
            </div>

            <div className="wc-def">{phase.entry.definition}</div>

            <div className="wc-context">
              <div>{highlight(anchor.ctx.sentence, anchor.ctx.selection)}</div>
              {phase.entry.contextTranslation && (
                <div className="wc-context-trans">{phase.entry.contextTranslation}</div>
              )}
            </div>

            <div className="wc-actions">
              <button
                className="wc-btn wc-btn-primary"
                onClick={() => void onSave()}
                disabled={save.kind === 'saving' || save.kind === 'saved'}
              >
                {save.kind === 'saving' ? '保存中…' : save.kind === 'saved' ? '已存入' : '存入 Anki'}
              </button>

              {save.kind === 'saved' && (
                <span className="wc-note wc-note-ok">
                  <Check size={13} />
                  <span>已加入单词本</span>
                </span>
              )}

              <div className="wc-spacer" />
              <button className="wc-btn wc-btn-ghost" onClick={dismiss}>关闭</button>
            </div>

            {save.kind === 'failed' && (
              <div className="wc-error" style={{ marginTop: 8 }}>
                {save.message}
                {' '}
                <button
                  className="wc-link"
                  onClick={() => void sendMessage({ type: 'open-options' })}
                >
                  去设置
                </button>
              </div>
            )}
          </>
        )}
        </div>
      </div>
    </div>
  )
}
