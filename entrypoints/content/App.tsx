import { Check, Sparkles, Volume2, Zap } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PartialEntry } from '@/lib/ai'
import { resolveOffset } from '@/lib/anki'
import type { MtProvider } from '@/lib/machine-translate'
import { MT_PROVIDER_LABELS } from '@/lib/machine-translate'
import { openEntryStream, sendMessage } from '@/lib/messaging'
import { place } from '@/lib/placement'
import { type SelectionContext, extractContext } from '@/lib/selection-context'
import { getSettings, watchSettings } from '@/lib/settings'
import { isTtsSupported, speak, stopSpeaking } from '@/lib/tts'
import { DEFAULT_SETTINGS, type Settings, type WordEntry } from '@/lib/types'

const PANEL_WIDTH = 372
const QUICK_WIDTH = 304
const PILL_WIDTH = 152
const PILL_HEIGHT = 34

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
function Skeleton() {
  return (
    <div className="wc-sk" aria-hidden>
      <div className="wc-sk-bar wc-sk-word" />
      <div className="wc-sk-bar wc-sk-def" />
      <div className="wc-sk-bar wc-sk-def-2" />
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
}

/**
 * 词条正文。流式和最终结果共用一套排版，
 * 这样字段陆续到齐时只是内容变多，不会整块重排。
 */
function EntryBody({ entry, ctx, ttsReady, onSpeak, streaming }: EntryBodyProps) {
  // word 是第一个到的字段，但在它到之前先用划选原文占位，避免面板从一片空白开始
  const word = entry.word || ctx.selection

  return (
    <>
      <div className="wc-head">
        <span className="wc-word">{word}</span>
        {entry.reading && <span className="wc-reading">/{entry.reading}/</span>}
        {ttsReady && !streaming && (
          <button className="wc-speak" title="试听读音" onClick={() => onSpeak(word)}>
            <Volume2 size={16} />
          </button>
        )}
        {entry.partOfSpeech && <span className="wc-pos">{entry.partOfSpeech}</span>}
      </div>

      <div className="wc-def">
        {entry.definition}
        {/* contextTranslation 排在 definition 后面，它一开始出现就说明释义已经写完了 */}
        {streaming && !entry.contextTranslation && <span className="wc-caret" aria-hidden />}
      </div>

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
  | { kind: 'quick', translation: string, provider: MtProvider, fellBack: boolean }
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
  const panelRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: PANEL_WIDTH, height: 0 })
  /** 当前流式请求的取消函数，换词或关闭面板时要调一下 */
  const streamRef = useRef<(() => void) | null>(null)

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
  }, [])

  /**
   * 开一次 AI 详解。
   *
   * 走流式：释义会逐字出现，首字通常 1 秒内就到。上一条还没结束就再划词的话，
   * 先把旧的取消掉，否则两条流会交替往同一个面板里写。
   */
  const lookup = useCallback((ctx: SelectionContext) => {
    streamRef.current?.()
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

        if (settings.triggerMode === 'auto') lookup(ctx)
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

  // 出结果就顺手查一次重，让「存入 Anki」在用户读完释义之前就变成「已收藏」
  const dupeWord = phase.kind === 'result'
    ? phase.entry.word
    : phase.kind === 'quick' && anchor
      ? anchor.ctx.selection
      : null

  useEffect(() => {
    if (!dupeWord) return

    let stale = false
    setDupe('unknown')
    void sendMessage({ type: 'check-duplicate', payload: { word: dupeWord } })
      .then((res) => {
        // 查重途中用户可能已经划了下一个词，迟到的结果不能覆盖新状态
        if (!stale && res.ok) setDupe(res.data.exists ? 'yes' : 'no')
      })
    return () => {
      stale = true
    }
  }, [dupeWord])

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
      // 排队是个需要读一句话的结果，别急着关掉面板
      setSave({ kind: 'queued', pending: res.data.pending ?? 1 })
      return
    }

    setSave({ kind: 'saved' })
    setTimeout(dismiss, 1200)
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

  // 已在牌组的词直接把按钮锁掉：让用户点一下再被 Anki 拒绝是纯粹的浪费
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
          : '存入 Anki'

  // ── 触发胶囊：⚡ 快译 | ✨ AI 词条 ────────────────
  if (phase.kind === 'trigger') {
    const pos = placeAt(anchor.rect, PILL_WIDTH, PILL_HEIGHT)
    return (
      <div className="wc-root wc-layer" style={{ left: pos.left, top: pos.top }}>
        <div className="wc-pill">
          <button title="机器翻译" onClick={() => void quickLookup(anchor.ctx)}>
            <Zap size={14} />
            <span>快译</span>
          </button>
          <div className="wc-pill-sep" />
          <button title="AI 语境释义" onClick={() => lookup(anchor.ctx)}>
            <Sparkles size={14} />
            <span>AI 详解</span>
          </button>
        </div>
      </div>
    )
  }

  // ── 快译迷你面板 ──────────────────────────────
  if (phase.kind === 'quick-loading' || phase.kind === 'quick' || phase.kind === 'quick-error') {
    const pos = placeAt(anchor.rect, QUICK_WIDTH, size.height || 90)
    return (
      <div className="wc-root wc-layer" style={{ left: pos.left, top: pos.top }}>
        <div
          className="wc-panel wc-panel-quick"
          ref={panelRef}
          style={{ maxHeight: pos.maxHeight }}
          role="dialog"
          aria-label={`「${anchor.ctx.selection}」的快速翻译`}
        >
          <div className="wc-fade" key={phase.kind} aria-live="polite">
            <div className="wc-head">
              <span className="wc-word wc-word-sm">{anchor.ctx.selection}</span>
              {ttsReady && (
                <button
                  className="wc-speak"
                  title="试听读音"
                  onClick={() => speakText(anchor.ctx.selection)}
                >
                  <Volume2 size={15} />
                </button>
              )}
              <div className="wc-spacer" />
              {/*
                服务商标注收进词头行的右端：它是元信息，不该占正文一整行。
                只放服务商名，「已自动切换」用描边变色 + tooltip 表达——
                多两个字就会把词头挤到断词，而这一行的主角是用户划的那个词。
              */}
              {phase.kind === 'quick' && (
                <span
                  className={`wc-tag ${phase.fellBack ? 'wc-tag-alt' : ''}`}
                  title={phase.fellBack
                    ? `首选服务连不上，已自动切换到${MT_PROVIDER_LABELS[phase.provider]}`
                    : undefined}
                >
                  {MT_PROVIDER_LABELS[phase.provider]}
                </span>
              )}
            </div>

            {phase.kind === 'quick-loading' && (
              <div className="wc-state">
                <Dots />
                <span>翻译中</span>
              </div>
            )}

            {phase.kind === 'quick' && (
              <div className="wc-def">{phase.translation}</div>
            )}

            {phase.kind === 'quick-error' && (
              <div className="wc-error">{phase.message}</div>
            )}

            <div className="wc-actions wc-actions-tight">
              {phase.kind === 'quick-error' && (
                <button
                  className="wc-btn wc-btn-ghost"
                  onClick={() => void quickLookup(anchor.ctx)}
                >
                  重试
                </button>
              )}
              <button
                className="wc-btn wc-btn-ghost wc-btn-accent"
                title="AI 语境释义"
                onClick={() => lookup(anchor.ctx)}
              >
                <Sparkles size={14} />
                <span>AI 详解</span>
              </button>
              {phase.kind === 'quick' && (
                <button
                  className="wc-btn wc-btn-ghost"
                  disabled={saveDisabled}
                  title={dupe === 'yes' ? '这个词已经在牌组里了' : undefined}
                  onClick={() => void onSaveQuick()}
                >
                  {saveLabel}
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
  const pos = placeAt(anchor.rect, size.width || PANEL_WIDTH, size.height)

  return (
    <div
      className="wc-root wc-layer"
      style={{
        left: pos.left,
        top: pos.top,
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
        {phase.kind === 'loading' && (
          <>
            <Skeleton />
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
              <button className="wc-btn wc-btn-primary" onClick={() => lookup(anchor.ctx)}>
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

        {phase.kind === 'streaming' && (
          <EntryBody
            entry={phase.partial}
            ctx={anchor.ctx}
            ttsReady={ttsReady}
            onSpeak={speakText}
            streaming
          />
        )}

        {phase.kind === 'result' && (
          <>
            <EntryBody
              entry={phase.entry}
              ctx={anchor.ctx}
              ttsReady={ttsReady}
              onSpeak={speakText}
            />

            <div className="wc-actions">
              <button
                className="wc-btn wc-btn-primary"
                onClick={() => void onSave()}
                disabled={saveDisabled}
                title={dupe === 'yes' ? '这个词已经在牌组里了' : undefined}
              >
                {saveLabel}
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
