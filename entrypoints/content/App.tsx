import { Check, ChevronDown, ChevronUp, Copy, GripHorizontal, Lightbulb, PanelRight, Pencil, Pin, Sparkles, Volume2, X, Zap } from 'lucide-react'
import { browser } from '#imports'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PartialEntry } from '@/lib/ai'
import { resolveOffset } from '@/lib/anki'
import type { GoogleDictEntry, MtProvider } from '@/lib/machine-translate'
import { MT_PROVIDER_LABELS } from '@/lib/machine-translate'
import { openEntryStream, sendMessage } from '@/lib/messaging'
import type { QuickDictResult } from '@/lib/open-dict/types'
import { place } from '@/lib/placement'
import { type SelectionContext, extractContext } from '@/lib/selection-context'
import { getSettings, watchSettings } from '@/lib/settings'
import { isTtsSupported, speak, stopSpeaking } from '@/lib/tts'
import { DEFAULT_SETTINGS, type Settings, type WordEntry } from '@/lib/types'

const PANEL_WIDTH = 372
const QUICK_WIDTH = 320
const QUICK_LONG_WIDTH = 440
const PILL_WIDTH = 152
const PILL_HEIGHT = 34

/** 复制按钮组件 */
function CopyBtn({ text, title = '复制词条' }: { text: string, title?: string }) {
  const [copied, setCopied] = useState(false)
  const onCopy = (e: React.MouseEvent) => {
    e.stopPropagation()
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    })
  }

  return (
    <button
      type="button"
      className={`wc-head-btn ${copied ? 'wc-copied' : ''}`}
      title={copied ? '已复制到剪贴板！' : title}
      onClick={onCopy}
    >
      {copied ? <Check size={13} style={{ color: '#3fb950' }} /> : <Copy size={13} />}
    </button>
  )
}

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

/**
 * AI 详解的加载占位。
 *
 * 用词条的真实形状（词头 / 释义 / 引用块）而不是转圈：等待 2-5 秒时，
 * 让用户先看到"结果会长这样"，体感比一个孤零零的进度指示快得多，
 * 内容到位时的布局跳动也小。
 */
function Skeleton({ onStartDrag, pinned, onTogglePin, onClose, onOpenSidePanel }: {
  onStartDrag?: (e: React.PointerEvent) => void
  pinned?: boolean
  onTogglePin?: () => void
  onClose?: () => void
  onOpenSidePanel?: () => void
}) {
  return (
    <div className="wc-sk" aria-hidden>
      {onStartDrag && (
        <div
          className="wc-drag-bar"
          title="按住拖拽移动卡片"
          onPointerDown={onStartDrag}
        />
      )}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div className="wc-sk-bar wc-sk-word" style={{ margin: 0 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {onOpenSidePanel && (
            <button
              type="button"
              className="wc-head-btn"
              title="在浏览器侧边栏中打开"
              onClick={onOpenSidePanel}
            >
              <PanelRight size={13} />
            </button>
          )}
          {onTogglePin && (
            <button
              type="button"
              className={`wc-head-btn ${pinned ? 'wc-pinned' : ''}`}
              title={pinned ? '取消固定（点击外部可关闭）' : '固定卡片（防止点击外部关闭）'}
              onClick={onTogglePin}
            >
              <Pin size={13} />
            </button>
          )}
          {onStartDrag && (
            <button
              type="button"
              className="wc-head-btn wc-drag-handle"
              title="按住拖拽移动卡片"
              onPointerDown={onStartDrag}
            >
              <GripHorizontal size={14} />
            </button>
          )}
          {onClose && (
            <button
              type="button"
              className="wc-head-btn"
              title="关闭 (Esc)"
              onClick={onClose}
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>
      <div className="wc-sk-def" style={{ marginTop: 6 }} />
      <div className="wc-sk-def-2" />
      <div className="wc-sk-quote">
        <div className="wc-sk-bar" />
        <div className="wc-sk-bar wc-sk-short" />
      </div>
    </div>
  )
}

interface EntryBodyProps {
  entry: PartialEntry
  ctx: SelectionContext
  ttsReady: boolean
  onSpeak: (text: string) => void
  /** 还在生成中：字段可能缺席，也不能试听半个词 */
  streaming?: boolean
  pinned?: boolean
  onTogglePin?: () => void
  onStartDrag?: (e: React.PointerEvent) => void
  onClose?: () => void
  onOpenSidePanel?: () => void
  onEditDefinition?: (def: string) => void
}

/**
 * 词条正文。流式和最终结果共用一套排版，
 * 这样字段陆续到齐时只是内容变多，不会整块重排。
 */
function EntryBody({
  entry,
  ctx,
  ttsReady,
  onSpeak,
  streaming,
  pinned,
  onTogglePin,
  onStartDrag,
  onClose,
  onOpenSidePanel,
  onEditDefinition,
}: EntryBodyProps) {
  // word 是第一个到的字段，但在它到之前先用划选原文占位，避免面板从一片空白开始
  const word = entry.word || ctx.selection
  const copyText = `${word}${entry.reading ? ` /${entry.reading}/` : ''}: ${entry.definition || ''}`
  const [editing, setEditing] = useState(false)
  const [defDraft, setDefDraft] = useState(entry.definition || '')

  useEffect(() => {
    setDefDraft(entry.definition || '')
  }, [entry.definition])

  const commitEdit = () => {
    setEditing(false)
    if (defDraft.trim() && defDraft !== entry.definition) {
      onEditDefinition?.(defDraft.trim())
    }
  }

  return (
    <>
      {onStartDrag && (
        <div
          className="wc-drag-bar"
          title="按住拖拽移动卡片"
          onPointerDown={onStartDrag}
        />
      )}
      <div
        className="wc-head"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('button, input, textarea, a')) return
          onStartDrag?.(e)
        }}
      >
        <div className="wc-head-main" onPointerDown={onStartDrag}>
          <span className="wc-word">{word}</span>
          {entry.reading && <span className="wc-reading">/{entry.reading}/</span>}
          {ttsReady && !streaming && (
            <button
              type="button"
              className="wc-speak"
              title="试听读音 (P)"
              onClick={(e) => {
                e.stopPropagation()
                onSpeak(word)
              }}
            >
              <Volume2 size={15} />
            </button>
          )}
          {entry.partOfSpeech && <span className="wc-pos">{entry.partOfSpeech}</span>}
        </div>

        <div className="wc-head-actions">
          <CopyBtn text={copyText} />
          {onOpenSidePanel && (
            <button
              type="button"
              className="wc-head-btn"
              title="在浏览器侧边栏中打开"
              onClick={(e) => {
                e.stopPropagation()
                onOpenSidePanel()
              }}
            >
              <PanelRight size={13} />
            </button>
          )}
          {onTogglePin && (
            <button
              type="button"
              className={`wc-head-btn ${pinned ? 'wc-pinned' : ''}`}
              title={pinned ? '取消固定（点击外部可关闭）' : '固定卡片（防止点击外部关闭，划选新词时在当前位置更新）'}
              onClick={(e) => {
                e.stopPropagation()
                onTogglePin()
              }}
            >
              <Pin size={13} />
            </button>
          )}
          {onStartDrag && (
            <button
              type="button"
              className="wc-head-btn wc-drag-handle"
              title="按住拖拽移动卡片"
              onPointerDown={onStartDrag}
            >
              <GripHorizontal size={14} />
            </button>
          )}
          {onClose && (
            <button
              type="button"
              className="wc-head-btn"
              title="关闭 (Esc)"
              onClick={(e) => {
                e.stopPropagation()
                onClose()
              }}
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {editing ? (
        <div className="wc-def-edit-wrap">
          <textarea
            className="wc-def-textarea"
            rows={2}
            autoFocus
            value={defDraft}
            onChange={e => setDefDraft(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || !e.shiftKey)) {
                e.preventDefault()
                commitEdit()
              } else if (e.key === 'Escape') {
                e.stopPropagation()
                setDefDraft(entry.definition || '')
                setEditing(false)
              }
            }}
          />
        </div>
      ) : (
        <div
          className={`wc-def ${!streaming ? 'wc-def-editable' : ''}`}
          title={!streaming ? '点击可微调释义' : undefined}
          onClick={() => !streaming && setEditing(true)}
        >
          {entry.definition}
          {/* contextTranslation 排在 definition 后面，它一开始出现就说明释义已经写完了 */}
          {streaming && !entry.contextTranslation && <span className="wc-caret" aria-hidden />}
        </div>
      )}

      {entry.memoryHook && (
        <div className="wc-hook-card">
          <div className="wc-hook-card-header">
            <span className="wc-hook-badge">
              <Lightbulb size={12.5} />
              <span>记忆线索</span>
            </span>
          </div>
          <div className="wc-hook-body">{entry.memoryHook}</div>
        </div>
      )}

      <div className="wc-context">
        <div>{highlight(ctx)}</div>
        {entry.contextTranslation && (
          <div className="wc-context-trans">{entry.contextTranslation}</div>
        )}
      </div>
    </>
  )
}

type Phase =
  | { kind: 'hidden' }
  | { kind: 'trigger' }
  | { kind: 'quick-loading' }
  | {
    kind: 'quick'
    mode: 'dict'
    dict: QuickDictResult
  }
  | {
    kind: 'quick'
    mode: 'mt'
    translation: string
    provider: MtProvider
    fellBack: boolean
    /** 谷歌词典：词性 + 多义项；微软路径没有 */
    dictionary?: GoogleDictEntry[]
  }
  | { kind: 'quick-error', message: string }
  | { kind: 'loading' }
  /** 流式生成中：字段陆续到齐，先渲染已有的部分 */
  | { kind: 'streaming', partial: PartialEntry }
  | { kind: 'result', entry: WordEntry }
  | { kind: 'error', message: string }

/**
 * 这个词是不是已经在牌组里了。
 *
 * unknown 涵盖「还没查」和「查不到（Anki 没开）」两种情况——两者对界面的
 * 要求是一样的：什么都别说，按正常流程让用户点保存。查重是锦上添花，
 * 它自己失败了不该冒出一条用户无法处理的报错。
 */
type Dupe = 'unknown' | 'yes' | 'no'

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  /** Anki 没开，卡片进了待写队列，等它起来再补写 */
  | { kind: 'queued', pending: number }
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

/** 把当前视口尺寸补进纯函数版的 place */
function placeAt(rect: DOMRect, width: number, height: number) {
  return place(rect, { width, height }, {
    width: window.innerWidth,
    height: window.innerHeight,
  })
}

/** 标出原句里的目标词，用抽取时记下的精确偏移而不是重新查找 */
function highlight(ctx: SelectionContext) {
  const needle = ctx.selection.trim()
  const at = resolveOffset(ctx.sentence, needle, ctx.offset)
  if (at < 0) return ctx.sentence

  return (
    <>
      {ctx.sentence.slice(0, at)}
      <mark>{ctx.sentence.slice(at, at + needle.length)}</mark>
      {ctx.sentence.slice(at + needle.length)}
    </>
  )
}

export default function App({ shadowHost }: { shadowHost: HTMLElement }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [phase, setPhase] = useState<Phase>({ kind: 'hidden' })
  const [save, setSave] = useState<SaveState>({ kind: 'idle' })
  const [anchor, setAnchor] = useState<Anchor | null>(null)
  const [dupe, setDupe] = useState<Dupe>('unknown')
  const [pinned, setPinned] = useState(false)
  const [fixedPos, setFixedPos] = useState<{ left: number, top: number } | null>(null)
  const [dragOffset, setDragOffset] = useState<{ x: number, y: number }>({ x: 0, y: 0 })
  const [overrideDef, setOverrideDef] = useState<string | null>(null)
  const [sidePanelHint, setSidePanelHint] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const [expandDict, setExpandDict] = useState(false)
  const [size, setSize] = useState({ width: PANEL_WIDTH, height: 0 })
  /** 当前流式请求的取消函数，换词或关闭面板时要调一下 */
  const streamRef = useRef<(() => void) | null>(null)

  const clampPos = useCallback((left: number, top: number, width: number) => {
    const minLeft = 8
    const maxLeft = Math.max(minLeft, window.innerWidth - width - 8)
    const minTop = 8
    const maxTop = Math.max(minTop, window.innerHeight - 60)
    return {
      left: Math.max(minLeft, Math.min(maxLeft, left)),
      top: Math.max(minTop, Math.min(maxTop, top)),
    }
  }, [])

  useEffect(() => {
    void getSettings().then(setSettings)
    return watchSettings(setSettings)
  }, [])

  const dismiss = useCallback(() => {
    stopSpeaking()
    // 关掉面板就没人看结果了，别让流继续跑
    streamRef.current?.()
    streamRef.current = null
    setPhase({ kind: 'hidden' })
    setSave({ kind: 'idle' })
    setDupe('unknown')
    setAnchor(null)
    setExpandDict(false)
    setPinned(false)
    setFixedPos(null)
    setDragOffset({ x: 0, y: 0 })
    setOverrideDef(null)
  }, [])

  const togglePin = useCallback(() => {
    setPinned((prev) => {
      const next = !prev
      if (next) {
        if (panelRef.current) {
          const r = panelRef.current.getBoundingClientRect()
          setFixedPos({ left: Math.round(r.left), top: Math.round(r.top) })
          setDragOffset({ x: 0, y: 0 })
        }
      } else {
        setFixedPos(null)
      }
      return next
    })
  }, [])

  const onStartDrag = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()

    setIsDragging(true)
    const startX = e.clientX
    const startY = e.clientY
    const curW = panelRef.current?.offsetWidth || PANEL_WIDTH

    if (fixedPos) {
      const startLeft = fixedPos.left
      const startTop = fixedPos.top

      const onPointerMove = (moveEvent: PointerEvent) => {
        const dx = moveEvent.clientX - startX
        const dy = moveEvent.clientY - startY
        setFixedPos(clampPos(startLeft + dx, startTop + dy, curW))
      }

      const onPointerUp = () => {
        setIsDragging(false)
        window.removeEventListener('pointermove', onPointerMove)
        window.removeEventListener('pointerup', onPointerUp)
      }

      window.addEventListener('pointermove', onPointerMove)
      window.addEventListener('pointerup', onPointerUp)
    } else {
      const startOffsetX = dragOffset.x
      const startOffsetY = dragOffset.y

      const onPointerMove = (moveEvent: PointerEvent) => {
        const dx = moveEvent.clientX - startX
        const dy = moveEvent.clientY - startY
        setDragOffset({
          x: startOffsetX + dx,
          y: startOffsetY + dy,
        })
      }

      const onPointerUp = () => {
        setIsDragging(false)
        window.removeEventListener('pointermove', onPointerMove)
        window.removeEventListener('pointerup', onPointerUp)
      }

      window.addEventListener('pointermove', onPointerMove)
      window.addEventListener('pointerup', onPointerUp)
    }
  }, [fixedPos, dragOffset, clampPos])

  /**
   * 开一次 AI 详解。
   *
   * 走流式：释义会逐字出现，首字通常 1 秒内就到。上一条还没结束就再划词的话，
   * 先把旧的取消掉，否则两条流会交替往同一个面板里写。
   */
  const lookup = useCallback((ctx: SelectionContext) => {
    streamRef.current?.()
    setOverrideDef(null)
    setPhase({ kind: 'loading' })

    streamRef.current = openEntryStream(ctx, {
      onPartial: partial => setPhase({ kind: 'streaming', partial }),
      onDone: (entry) => {
        streamRef.current = null
        setPhase({ kind: 'result', entry })
      },
      onError: (message) => {
        streamRef.current = null
        setPhase({ kind: 'error', message })
      },
    })
  }, [])

  const quickLookup = useCallback(async (ctx: SelectionContext) => {
    setOverrideDef(null)
    setPhase({ kind: 'quick-loading' })
    setExpandDict(false)
    const res = await sendMessage({
      type: 'quick-translate',
      payload: {
        text: ctx.selection,
        context: {
          sentence: ctx.sentence,
          pageTitle: document.title,
          pageUrl: location.href,
        },
      },
    })
    if (!res.ok) {
      setPhase({ kind: 'quick-error', message: res.error })
      return
    }

    if (res.data.mode === 'dict') {
      setPhase({ kind: 'quick', mode: 'dict', dict: res.data.dict })
    } else {
      setPhase({ kind: 'quick', ...res.data })
    }
  }, [])

  const openSidePanel = useCallback(async () => {
    const res = await sendMessage({ type: 'open-sidepanel' })
    if (!res.ok) {
      setSidePanelHint(true)
      setTimeout(() => setSidePanelHint(false), 3500)
    }
  }, [])

  const speakText = useCallback((text: string) => {
    speak(text, {
      lang: settings.tts.lang,
      rate: settings.tts.rate,
      autoDetect: settings.tts.autoDetect,
    })
  }, [settings.tts])

  const ttsReady = settings.tts.enabled && isTtsSupported()

  // 面板高度是内容撑出来的，量到之后才能决定往上翻还是往下放
  useEffect(() => {
    if (!panelRef.current) return
    const el = panelRef.current
    const observer = new ResizeObserver(() => {
      setSize({ width: el.offsetWidth, height: el.offsetHeight })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [phase.kind, expandDict])

  const saveCard = useCallback(async (entry: WordEntry) => {
    if (!anchor) return

    setSave({ kind: 'saving' })
    const res = await sendMessage({
      type: 'save-card',
      payload: {
        entry,
        selection: anchor.ctx.selection,
        sentence: anchor.ctx.sentence,
        sentenceOffset: anchor.ctx.offset,
        pageUrl: location.href,
        pageTitle: document.title,
        createdAt: Date.now(),
      },
    })

    if (!res.ok) {
      setSave({ kind: 'failed', message: res.error })
      return
    }

    if (res.data.queued) {
      setSave({ kind: 'queued', pending: res.data.pending ?? 1 })
      return
    }

    setSave({ kind: 'saved' })
    setTimeout(dismiss, 1200)
  }, [anchor, dismiss])

  const onSave = useCallback(async () => {
    if (phase.kind !== 'result') return
    const entryToSave = overrideDef
      ? { ...phase.entry, definition: overrideDef }
      : phase.entry
    await saveCard(entryToSave)
  }, [phase, saveCard, overrideDef])

  /** 快译结果直接存卡：有离线词典用离线词典，否则用机器翻译 */
  const onSaveQuick = useCallback(async () => {
    if (phase.kind !== 'quick' || !anchor) return

    if (phase.mode === 'dict') {
      const d = phase.dict
      await saveCard({
        word: d.headword,
        reading: d.reading,
        partOfSpeech: d.primaryPos || '',
        definition: d.coreMeanings.join('；'),
        contextTranslation: '',
        memoryHook: d.memoryHook,
      })
      return
    }

    const dict = phase.dictionary
    const pos = dict?.[0]?.pos ?? ''
    const definition = dict && dict.length > 0
      ? dict
        .map(d => (d.pos ? `${d.pos} ${d.meanings.join('；')}` : d.meanings.join('；')))
        .join(' / ')
      : phase.translation
    await saveCard({
      word: anchor.ctx.selection,
      reading: '',
      partOfSpeech: pos,
      definition,
      contextTranslation: '',
    })
  }, [phase, anchor, saveCard])

  // 出结果就顺手查一次重，让「存入单词本」在用户读完释义之前就变成「已收藏」
  const dupeWord = phase.kind === 'result'
    ? phase.entry.word
    : phase.kind === 'quick' && anchor
      ? (phase.mode === 'dict' ? phase.dict.headword : anchor.ctx.selection)
      : null

  useEffect(() => {
    if (!dupeWord) return

    let stale = false
    setDupe('unknown')
    void sendMessage({ type: 'check-duplicate', payload: { word: dupeWord } })
      .then((res) => {
        if (!stale && res.ok) setDupe(res.data.exists ? 'yes' : 'no')
      })
    return () => {
      stale = true
    }
  }, [dupeWord])

  const saved = save.kind === 'saved'
  const queued = save.kind === 'queued'
  const saveDisabled = save.kind === 'saving' || saved || queued || dupe === 'yes'
  const saveLabel = save.kind === 'saving'
    ? '保存中…'
    : saved
      ? '已存入'
      : queued
        ? '已排队'
        : dupe === 'yes'
          ? '已在牌组'
          : '存入单词本'

  // ── 选区监听 ──────────────────────────────────
  useEffect(() => {
    const insideUi = (target: EventTarget | null) =>
      target instanceof Node && shadowHost.contains(target)

    const onMouseUp = (e: MouseEvent) => {
      if (insideUi(e.target)) return

      // 1. 域名黑名单过滤
      const host = location.hostname.toLowerCase()
      if (settings.blacklist?.some(item => item && host.includes(item.toLowerCase()))) {
        return
      }

      // 2. 修饰按键检查
      if (settings.modifierKey === 'alt' && !e.altKey) return
      if (settings.modifierKey === 'ctrl' && !e.ctrlKey) return
      if (settings.modifierKey === 'shift' && !e.shiftKey) return
      if (settings.modifierKey === 'meta' && !e.metaKey) return

      const isDoubleClick = e.detail === 2

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
        setExpandDict(false)

        // 联动广播给侧边栏（如果已开）
        browser.runtime.sendMessage({
          type: 'sidepanel-sync-word',
          payload: { word: ctx.selection, sentence: ctx.sentence },
        }).catch(() => {})

        if (!pinned) {
          setDragOffset({ x: 0, y: 0 })
        }

        // 双击单词时：若开启了双击查词，跳过操作胶囊直接展开快速翻译
        if (settings.doubleClickLookup && isDoubleClick) {
          void quickLookup(ctx)
          return
        }

        if (settings.triggerMode === 'auto' || settings.triggerMode === 'ai') {
          lookup(ctx)
        } else if (settings.triggerMode === 'quick') {
          void quickLookup(ctx)
        } else {
          // 如果已被 Pin 住，直接更新内容，不退回操作胶囊
          if (pinned) {
            void quickLookup(ctx)
          } else {
            setPhase({ kind: 'trigger' })
          }
        }
      }, 0)
    }

    const onMouseDown = (e: MouseEvent) => {
      if (pinned) return
      if (!insideUi(e.target)) dismiss()
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        dismiss()
        return
      }

      if (phase.kind === 'hidden') return

      const target = e.target as HTMLElement | null
      const isInput = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)

      if (!isInput) {
        if (e.key === 'Enter') {
          if (phase.kind === 'result' && !saveDisabled) {
            e.preventDefault()
            void onSave()
          } else if (phase.kind === 'quick' && !saveDisabled) {
            e.preventDefault()
            void onSaveQuick()
          }
        } else if ((e.key === 'p' || e.key === 'P') && ttsReady) {
          e.preventDefault()
          const textToSpeak = dupeWord || anchor?.ctx.selection
          if (textToSpeak) speakText(textToSpeak)
        }
      }
    }

    document.addEventListener('mouseup', onMouseUp)
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mouseup', onMouseUp)
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [
    shadowHost,
    settings.triggerMode,
    settings.doubleClickLookup,
    settings.modifierKey,
    settings.blacklist,
    lookup,
    quickLookup,
    dismiss,
    pinned,
    phase.kind,
    saveDisabled,
    onSave,
    onSaveQuick,
    ttsReady,
    dupeWord,
    anchor,
    speakText,
  ])

  // 页面滚动时重新贴合选区（如果已被 Pin 固定则保持视口绝对位置不动）
  useEffect(() => {
    if (phase.kind === 'hidden' || !anchor || (pinned && fixedPos)) return

    const reposition = () => {
      setAnchor(prev => (prev ? { ...prev, rect: prev.range.getBoundingClientRect() } : prev))
    }
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [phase.kind, anchor?.range, pinned, fixedPos])

  if (phase.kind === 'hidden' || !anchor) return null

  // ── 触发胶囊：⚡ 快译 | ✨ AI 词条 ────────────────
  if (phase.kind === 'trigger') {
    const pos = placeAt(anchor.rect, PILL_WIDTH, PILL_HEIGHT)
    return (
      <div className="wc-root wc-layer" style={{ left: pos.left, top: pos.top }}>
        <div className="wc-pill">
          <button type="button" title="快速查词/翻译" onClick={() => void quickLookup(anchor.ctx)}>
            <Zap size={14} />
            <span>快译</span>
          </button>
          <div className="wc-pill-sep" />
          <button type="button" title="结合语境进行 AI 释义" onClick={() => lookup(anchor.ctx)}>
            <Sparkles size={14} />
            <span>AI 释义</span>
          </button>
        </div>
      </div>
    )
  }

  // ── 快译迷你面板 ──────────────────────────────
  if (phase.kind === 'quick-loading' || phase.kind === 'quick' || phase.kind === 'quick-error') {
    const rawSelection = anchor.ctx.selection.trim()
    const isLongText = rawSelection.length > 35 || rawSelection.includes('\n') || rawSelection.split(/\s+/).length > 5
    const panelWidth = isLongText ? QUICK_LONG_WIDTH : QUICK_WIDTH
    const pos = placeAt(anchor.rect, panelWidth, size.height || 90)
    const isDict = phase.kind === 'quick' && phase.mode === 'dict'
    const wordToSpeak = isDict ? phase.dict.headword : anchor.ctx.selection

    const rawLeft = fixedPos ? fixedPos.left : (pos.left + dragOffset.x)
    const rawTop = fixedPos ? fixedPos.top : (pos.top + dragOffset.y)
    const clamped = clampPos(rawLeft, rawTop, panelWidth)
    const finalLeft = clamped.left
    const finalTop = clamped.top

    return (
      <div
        className={`wc-root wc-layer ${isDragging ? 'wc-dragging' : ''}`}
        style={{ left: finalLeft, top: finalTop }}
      >
        <div
          className={`wc-panel wc-panel-quick ${isLongText ? 'wc-panel-long' : ''}`}
          ref={panelRef}
          style={{ maxHeight: pos.maxHeight }}
          role="dialog"
          aria-label={isLongText ? '快速翻译' : `「${anchor.ctx.selection}」的快速查词`}
        >
          <div className="wc-fade" key={phase.kind} aria-live="polite">
            <div
              className="wc-drag-bar"
              title="按住拖拽移动卡片"
              onPointerDown={onStartDrag}
            />
            {sidePanelHint && (
              <div className="wc-toast-hint" role="status">
                受浏览器限制，请点击浏览器右上角扩展栏插件图标打开侧边栏
              </div>
            )}
            <div
              className="wc-head"
              onPointerDown={(e) => {
                if ((e.target as HTMLElement).closest('button, input, textarea, a')) return
                onStartDrag?.(e)
              }}
            >
              <div className="wc-head-main" onPointerDown={onStartDrag}>
                {isLongText ? (
                  <span className="wc-head-title">译文</span>
                ) : (
                  <span className="wc-word wc-word-sm">
                    {isDict ? phase.dict.headword : anchor.ctx.selection}
                  </span>
                )}
                {!isLongText && isDict && phase.dict.reading && (
                  <span className="wc-reading">
                    /{phase.dict.reading}/
                  </span>
                )}
                {ttsReady && (
                  <button
                    type="button"
                    className="wc-speak"
                    title={isLongText ? '朗读原文' : '试听读音'}
                    onClick={(e) => {
                      e.stopPropagation()
                      speakText(wordToSpeak)
                    }}
                  >
                    <Volume2 size={15} />
                  </button>
                )}
              </div>

              <div className="wc-head-actions">
                {phase.kind === 'quick' && (
                  <span
                    className={`wc-tag ${phase.mode === 'mt' && phase.fellBack ? 'wc-tag-alt' : ''}`}
                    title={
                      phase.mode === 'dict'
                        ? '已从本地 Open Dictionary 离线词库检索'
                        : phase.fellBack
                          ? `首选服务连不上，已自动切换到${MT_PROVIDER_LABELS[phase.provider]}`
                          : undefined
                    }
                  >
                    {phase.mode === 'dict' ? '离线词典' : MT_PROVIDER_LABELS[phase.provider]}
                  </span>
                )}
                {phase.kind === 'quick' && (
                  <CopyBtn
                    text={
                      isDict
                        ? `${phase.dict.headword}${phase.dict.reading ? ` /${phase.dict.reading}/` : ''}: ${phase.dict.coreMeanings.join('； ')}`
                        : `${anchor.ctx.selection}: ${phase.mode === 'mt' ? phase.translation : ''}`
                    }
                  />
                )}
                <button
                  type="button"
                  className="wc-head-btn"
                  title="在浏览器侧边栏中打开"
                  onClick={(e) => {
                    e.stopPropagation()
                    void openSidePanel()
                  }}
                >
                  <PanelRight size={13} />
                </button>
                <button
                  type="button"
                  className={`wc-head-btn ${pinned ? 'wc-pinned' : ''}`}
                  title={pinned ? '取消固定（点击外部可关闭）' : '固定卡片（防止点击外部关闭，划选新词时在当前位置更新）'}
                  onClick={(e) => {
                    e.stopPropagation()
                    togglePin()
                  }}
                >
                  <Pin size={13} />
                </button>
                <button
                  type="button"
                  className="wc-head-btn wc-drag-handle"
                  title="按住拖拽移动卡片"
                  onPointerDown={onStartDrag}
                >
                  <GripHorizontal size={14} />
                </button>
                <button
                  type="button"
                  className="wc-head-btn"
                  title="关闭 (Esc)"
                  onClick={(e) => {
                    e.stopPropagation()
                    dismiss()
                  }}
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            {phase.kind === 'quick-loading' && (
              <div className="wc-state">
                <Dots />
                <span>查询中</span>
              </div>
            )}

            {/* ── 离线词典视图 ── */}
            {phase.kind === 'quick' && phase.mode === 'dict' && (
              <div className="wc-quick-body">
                {phase.dict.coreGroups && phase.dict.coreGroups.length > 0 ? (
                  <div className="wc-dict-core-groups">
                    {phase.dict.coreGroups.map((g, idx) => (
                      <div className="wc-dict-group-row" key={idx}>
                        <span className="wc-dict-group-pos">{g.pos}</span>
                        <div className="wc-dict-group-meanings">
                          {g.meanings.map((m, mIdx) => (
                            <span className="wc-dict-group-item" key={mIdx}>{m}</span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="wc-dict-core-list">
                    {phase.dict.coreMeanings.map((m, idx) => (
                      <div className="wc-dict-core-item" key={idx}>
                        {m}
                      </div>
                    ))}
                  </div>
                )}

                {phase.dict.memoryHook && (
                  <div className="wc-hook-card">
                    <div className="wc-hook-card-header">
                      <span className="wc-hook-badge">
                        <Lightbulb size={12.5} />
                        <span>记忆线索</span>
                      </span>
                    </div>
                    <div className="wc-hook-body">{phase.dict.memoryHook}</div>
                  </div>
                )}

                {phase.dict.allPosGroups.length > 0 && (
                  <div>
                    <button
                      type="button"
                      className="wc-dict-toggle"
                      onClick={() => setExpandDict(!expandDict)}
                    >
                      {expandDict ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                      <span>{expandDict ? '收起全部义项' : '展开全部词性与义项'}</span>
                    </button>

                    {expandDict && (
                      <div className="wc-dict" style={{ marginTop: 4 }}>
                        {phase.dict.allPosGroups.map((pg, gIdx) => (
                          <div className="wc-dict-pos-group" key={gIdx}>
                            <div className="wc-dict-pos-header">
                              {pg.pos} {pg.summary ? `· ${pg.summary}` : ''}
                            </div>
                            {pg.meanings.map((m, mIdx) => (
                              <div className="wc-dict-meaning-item" key={mIdx}>
                                • {m.short_gloss || m.learner_explanation}
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ── 在线机翻视图 ── */}
            {phase.kind === 'quick' && phase.mode === 'mt' && (
              <div className="wc-quick-body">
                <div className={`wc-def ${isLongText ? 'wc-def-long' : ''}`}>
                  {phase.translation}
                </div>
                {!isLongText && phase.dictionary && phase.dictionary.length > 0 && (
                  <div className="wc-dict">
                    {phase.dictionary.map(entry => (
                      <div className="wc-dict-row" key={entry.pos}>
                        <span className="wc-dict-pos">{entry.pos}</span>
                        <span className="wc-dict-meanings">
                          {entry.meanings.join('；')}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {phase.kind === 'quick-error' && (
              <div className="wc-error">{phase.message}</div>
            )}

            <div className="wc-actions wc-actions-tight">
              {phase.kind === 'quick-error' && (
                <button
                  type="button"
                  className="wc-btn wc-btn-ghost"
                  onClick={() => void quickLookup(anchor.ctx)}
                >
                  重试
                </button>
              )}
              <button
                type="button"
                className="wc-btn wc-btn-ghost wc-btn-accent"
                title="结合语境进行 AI 释义"
                onClick={() => lookup(anchor.ctx)}
              >
                <Sparkles size={14} />
                <span>AI 释义</span>
              </button>
              {phase.kind === 'quick' && (
                <button
                  type="button"
                  className="wc-btn wc-btn-ghost"
                  disabled={saveDisabled}
                  title={dupe === 'yes' ? '这个词已经在牌组里了' : '快捷键: Enter'}
                  onClick={() => void onSaveQuick()}
                >
                  <span>{saveLabel}</span>
                  {!saveDisabled && <span className="wc-kbd">↵</span>}
                </button>
              )}
              <div className="wc-spacer" />
              <button type="button" className="wc-btn wc-btn-ghost" onClick={dismiss}>关闭</button>
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
  const panelW = size.width || PANEL_WIDTH
  const pos = placeAt(anchor.rect, panelW, size.height)
  const rawLeft = fixedPos ? fixedPos.left : (pos.left + dragOffset.x)
  const rawTop = fixedPos ? fixedPos.top : (pos.top + dragOffset.y)
  const clamped = clampPos(rawLeft, rawTop, panelW)
  const finalLeft = clamped.left
  const finalTop = clamped.top

  return (
    <div
      className={`wc-root wc-layer ${isDragging ? 'wc-dragging' : ''}`}
      style={{
        left: finalLeft,
        top: finalTop,
        // 高度是内容撑出来的，量到之前无法判断该往上翻还是往下放。
        // 先藏起来量一帧，否则用户会看见面板从下方跳到上方。
        visibility: size.height === 0 ? 'hidden' : undefined,
      }}
    >
      <div
        className="wc-panel"
        ref={panelRef}
        style={{ maxHeight: pos.maxHeight }}
        role="dialog"
        aria-label={`「${anchor.ctx.selection}」的词条`}
      >
        <div className="wc-fade" key={phase.kind} aria-live="polite">
        {sidePanelHint && (
          <div className="wc-toast-hint" role="status">
            受浏览器限制，请点击浏览器右上角扩展栏插件图标打开侧边栏
          </div>
        )}
        {phase.kind === 'loading' && (
          <>
            <Skeleton
              onStartDrag={onStartDrag}
              pinned={pinned}
              onTogglePin={togglePin}
              onClose={dismiss}
              onOpenSidePanel={openSidePanel}
            />
            <div className="wc-state wc-state-quiet">
              <Dots />
              <span>正在结合上下文解释「{anchor.ctx.selection}」</span>
            </div>
          </>
        )}

        {phase.kind === 'error' && (
          <>
            <div className="wc-error">{phase.message}</div>
            <div className="wc-actions">
              <button type="button" className="wc-btn wc-btn-primary" onClick={() => lookup(anchor.ctx)}>
                重试
              </button>
              <button
                type="button"
                className="wc-btn wc-btn-ghost"
                onClick={() => void sendMessage({ type: 'open-options' })}
              >
                打开设置
              </button>
              <div className="wc-spacer" />
              <button type="button" className="wc-btn wc-btn-ghost" onClick={dismiss}>关闭</button>
            </div>
          </>
        )}

        {phase.kind === 'streaming' && (
          <EntryBody
            entry={phase.partial}
            ctx={anchor.ctx}
            ttsReady={ttsReady}
            onSpeak={speakText}
            streaming
            pinned={pinned}
            onTogglePin={togglePin}
            onStartDrag={onStartDrag}
            onClose={dismiss}
            onOpenSidePanel={openSidePanel}
          />
        )}

        {phase.kind === 'result' && (
          <>
            <EntryBody
              entry={overrideDef ? { ...phase.entry, definition: overrideDef } : phase.entry}
              ctx={anchor.ctx}
              ttsReady={ttsReady}
              onSpeak={speakText}
              pinned={pinned}
              onTogglePin={togglePin}
              onStartDrag={onStartDrag}
              onClose={dismiss}
              onOpenSidePanel={openSidePanel}
              onEditDefinition={setOverrideDef}
            />

            <div className="wc-actions">
              <button
                type="button"
                className="wc-btn wc-btn-primary"
                onClick={() => void onSave()}
                disabled={saveDisabled}
                title={dupe === 'yes' ? '这个词已经在牌组里了' : '快捷键: Enter'}
              >
                <span>{saveLabel}</span>
                {!saveDisabled && <span className="wc-kbd">↵ Enter</span>}
              </button>

              {saved && (
                <span className="wc-note wc-note-ok">
                  <Check size={13} />
                  <span>已加入单词本</span>
                </span>
              )}

              {dupe === 'yes' && !saved && !queued && (
                <span className="wc-note">读过就好，不用重复收藏</span>
              )}

              {save.kind === 'queued' && (
                <span className="wc-note wc-note-ok">
                  <Check size={13} />
                  <span>Anki 没开，已排队（{save.pending}）</span>
                </span>
              )}

              <div className="wc-spacer" />
              <button type="button" className="wc-btn wc-btn-ghost" onClick={dismiss}>关闭</button>
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
