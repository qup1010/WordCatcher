import { contextKey, saveLearning, readLearning, updateLearning, exportLearning, effectiveCard, markLearningSync } from '@/lib/learning'
import { browser, defineBackground } from '#imports'
import type { Browser } from 'wxt/browser'
import { AiError, PREVIEW_SAMPLE, listModels, streamEntry, testConnection } from '@/lib/ai'
import {
  AnkiError,
  addNote,
  checkConnection,
  findExisting,
  updateModelTemplates,
} from '@/lib/anki'
import { checkDesktopBridge, syncCardToDesktop } from '@/lib/desktop-bridge'
import { cacheKey, cacheSize, clearCache, getCached, setCached } from '@/lib/entry-cache'
import { MtError, quickTranslate } from '@/lib/machine-translate'
import {
  ENTRY_STREAM_PORT,
  type Request,
  type Result,
  type StreamEvent,
  type StreamStart,
} from '@/lib/messaging'
import { clearDict, getDictMeta, lookupWord } from '@/lib/open-dict/db'
import { DICT_IMPORT_PORT, handleDictImportPort } from '@/lib/open-dict/importer'
import {
  clearPending,
  enqueue,
  flushPending,
  pendingCount,
  readPending,
  removePending,
} from '@/lib/pending'
import {
  addHistory,
  clearHistory,
  importHistoryItems,
  markHistorySaved,
  readHistory,
  removeHistory,
} from '@/lib/history'
import { getSettings, isAiConfigured } from '@/lib/settings'

async function handle(req: Request, sender?: Browser.runtime.MessageSender): Promise<Result<unknown>> {
  const settings = await getSettings()

  switch (req.type) {
    case 'list-models': {
      const models = await listModels(settings)
      return { ok: true, data: { models } }
    }

    /**
     * 「测试 AI」。
     *
     * 先直接跑一次真实的结构化生成——它成功就说明整条链路都通，一次调用搞定，
     * 而且能把生成的词条卡摆给用户看，比一句"连接正常"有信息量得多。
     *
     * 只有它失败时才补一次不带结构化输出的探针，用来区分两种完全不同的故障：
     * 连不上 / key 无效（探针也失败），还是端点通但模型不支持结构化输出
     * （探针成功）——后者是小模型上最常见的坑，报错信息里根本看不出来。
     */
    case 'test-ai': {
      try {
        const sample = await streamEntry({ ...PREVIEW_SAMPLE, settings, onPartial: () => {} })
        return { ok: true, data: { sample, reply: null, structuredError: null } }
      } catch (structuredErr) {
        const reply = await testConnection(settings) // 这一步再失败就是真连不上，直接抛出去
        return {
          ok: true,
          data: { sample: null, reply, structuredError: toErrorMessage(structuredErr) },
        }
      }
    }

    case 'dict-status': {
      const meta = await getDictMeta()
      return { ok: true, data: meta }
    }

    case 'dict-clear': {
      await clearDict()
      return { ok: true, data: null }
    }

    case 'dict-lookup': {
      const result = await lookupWord(req.payload.word)
      return { ok: true, data: result }
    }

    case 'quick-translate': {
      const text = req.payload.text.trim()
      const isShortWord = text.length > 0 && text.split(/\s+/).length <= 2
      const ctx = req.payload.context

      if (settings.dict.enabled && isShortWord) {
        try {
          const meta = await getDictMeta()
          if (meta.status === 'ready') {
            const dictRes = await lookupWord(text)
            if (dictRes) {
              void addHistory({
                word: dictRes.headword,
                selection: text,
                reading: dictRes.reading,
                partOfSpeech: dictRes.primaryPos,
                definition: dictRes.coreMeanings.join('； '),
                memoryHook: dictRes.memoryHook,
                sentence: ctx?.sentence,
                sentenceOffset: ctx?.sentenceOffset,
                pageTitle: ctx?.pageTitle,
                pageUrl: ctx?.pageUrl,
                source: 'dict',
              })
              return { ok: true, data: { mode: 'dict', dict: dictRes } }
            }
          }
        } catch {
          // 本地词典异常时平滑回退
        }
      }

      // 未命中本地词典或为多词/长句，走机器翻译
      const result = await quickTranslate(text, {
        provider: settings.mt.provider,
        explainLanguage: settings.explainLanguage,
      })

      const mtPos = result.dictionary?.[0]?.pos || ''
      const mtDef = result.dictionary && result.dictionary.length > 0
        ? result.dictionary.map(d => (d.pos ? `${d.pos} ${d.meanings.join('；')}` : d.meanings.join('；'))).join(' / ')
        : result.translation

      void addHistory({
        word: text,
        selection: text,
        partOfSpeech: mtPos,
        definition: mtDef,
        sentence: ctx?.sentence,
        sentenceOffset: ctx?.sentenceOffset,
        pageTitle: ctx?.pageTitle,
        pageUrl: ctx?.pageUrl,
        source: 'mt',
      })

      return { ok: true, data: { mode: 'mt', ...result } }
    }

    case 'save-card': {
      const record = await saveLearning(req.payload)
      const card = effectiveCard(record)
      const syncDesktop = () => syncCardToDesktop({ ...record.card, edits: record.edits, updateExisting: true }, settings).catch(() => false)
      try {
        if (!card.entry.contextTranslation && card.sentence) {
          try {
            const mt = await quickTranslate(card.sentence, { provider: settings.mt.provider, explainLanguage: settings.explainLanguage })
            card.entry.contextTranslation = mt.translation
          } catch { /* 原始学习记录已保存，补译失败不影响收藏。 */ }
        }
        const noteId = await addNote(card, settings)
        await markLearningSync(record.id, undefined, record.revision)
        void markHistorySaved(record.card.entry.word)
        return { ok: true, data: { noteId, queued: false, recordId: record.id, syncedToDesktop: await syncDesktop() } }
      } catch (err) {
        const message = toErrorMessage(err)
        await markLearningSync(record.id, message, record.revision)
        const pending = await enqueue(card)
        return { ok: true, data: { noteId: null, queued: true, pending, recordId: record.id, syncError: message, syncedToDesktop: await syncDesktop() } }
      }
    }

    case 'library-list':
      return { ok: true, data: await readLearning() }
    case 'library-export':
      return { ok: true, data: await exportLearning() }
    case 'library-update': {
      const record = await updateLearning(req.payload.id, req.payload.edits)
      await enqueue(effectiveCard(record))
      return { ok: true, data: record }
    }
    case 'library-sync': {
      const record = (await readLearning()).find(r => r.id === req.payload.id)
      if (!record) throw new Error('这条语境已不存在。')
      try {
        const noteId = await addNote(effectiveCard(record), settings)
        await markLearningSync(record.id, undefined, record.revision)
        return { ok: true, data: { noteId, queued: false } }
      } catch (err) {
        const syncError = toErrorMessage(err)
        await markLearningSync(record.id, syncError, record.revision)
        await enqueue(effectiveCard(record))
        return { ok: true, data: { noteId: null, queued: true, syncError } }
      }
    }

    case 'pending-count': {
      return { ok: true, data: { count: await pendingCount() } }
    }

    case 'pending-list': {
      return { ok: true, data: { cards: await readPending() } }
    }

    case 'remove-pending': {
      return { ok: true, data: { count: await removePending(req.payload.word, req.payload.contextKey) } }
    }

    case 'clear-pending': {
      await clearPending()
      return { ok: true, data: { count: 0 } }
    }

    /*
     * 缓存只活在 service worker 的内存里，它一被回收就自然清空了。
     * 手动清的场景是：改了提示词或换了模型，想立刻看到新结果而不是旧缓存。
     */
    case 'cache-stats': {
      return { ok: true, data: { size: cacheSize() } }
    }

    case 'clear-cache': {
      const cleared = cacheSize()
      clearCache()
      return { ok: true, data: { cleared } }
    }

    case 'flush-pending': {
      const result = await flushPending(
        async card => {
          const current = card.recordId ? (await readLearning()).find(r => r.id === card.recordId) : undefined
          const noteId = await addNote(current ? effectiveCard(current) : card, settings)
          if (card.recordId) await markLearningSync(card.recordId, undefined, current?.revision ?? card.recordRevision)
          return noteId
        },
        // 只有连不上才值得留着重试；重复词之类重试一万次也是同样的结果
        err => err instanceof AnkiError && err.kind === 'unreachable',
      )
      return { ok: true, data: result }
    }

    case 'check-duplicate': {
      const exists = req.payload.context
        ? (await readLearning()).some(r => contextKey(r.card) === contextKey(req.payload.context!))
        : (await findExisting(req.payload.word, settings)).length > 0
      return { ok: true, data: { exists } }
    }

    case 'check-anki': {
      const version = await checkConnection(settings.anki.url)
      return { ok: true, data: { version } }
    }

    case 'check-desktop-bridge': {
      const alive = await checkDesktopBridge(settings.desktopBridge.url)
      return { ok: true, data: { alive } }
    }

    case 'sync-anki-templates': {
      await updateModelTemplates(settings)
      return { ok: true, data: null }
    }

    case 'open-options': {
      await browser.runtime.openOptionsPage()
      return { ok: true, data: null }
    }

    case 'history-list': {
      const list = await readHistory()
      return { ok: true, data: list }
    }

    case 'history-import': {
      const next = await importHistoryItems(req.payload.items)
      return { ok: true, data: next }
    }

    case 'history-remove': {
      const next = await removeHistory(req.payload.id)
      return { ok: true, data: next }
    }

    case 'history-clear': {
      await clearHistory()
      return { ok: true, data: null }
    }

    case 'open-sidepanel': {
      const globalChrome = (globalThis as unknown as {
        chrome?: {
          sidePanel?: {
            open?: (opts: { windowId?: number, tabId?: number }) => Promise<void>
          }
        }
      }).chrome
      const sidePanel = (browser as unknown as {
        sidePanel?: {
          open?: (opts: { windowId?: number, tabId?: number }) => Promise<void>
        }
      }).sidePanel || globalChrome?.sidePanel

      if (!sidePanel?.open) {
        return { ok: false, error: '当前浏览器不支持侧边栏 API' }
      }

      try {
        let winId = sender?.tab?.windowId
        if (!winId) {
          const win = await browser.windows.getLastFocused({ populate: false }).catch(() => null)
          winId = win?.id
        }

        if (winId) {
          try {
            await sidePanel.open({ windowId: winId })
            return { ok: true, data: null }
          } catch (winErr) {
            // 如果按 windowId 打开失败，尝试按当前 tabId 打开
            if (sender?.tab?.id) {
              await sidePanel.open({ tabId: sender.tab.id })
              return { ok: true, data: null }
            }
            throw winErr
          }
        } else if (sender?.tab?.id) {
          await sidePanel.open({ tabId: sender.tab.id })
          return { ok: true, data: null }
        }
        return { ok: false, error: '无法定位当前窗口' }
      } catch (err) {
        const msg = toErrorMessage(err)
        if (msg.toLowerCase().includes('user gesture') || msg.toLowerCase().includes('gesture')) {
          return { ok: false, error: 'gesture_required' }
        }
        return { ok: false, error: msg }
      }
    }
  }
}

function toErrorMessage(err: unknown): string {
  if (err instanceof AnkiError || err instanceof AiError || err instanceof MtError) return err.message
  if (err instanceof Error) return err.message
  return String(err)
}

/**
 * 流式词条的 port 处理。
 *
 * 每次划词开一条新 port，生成结束后由 background 主动断开——内容脚本那边
 * 靠 done/error 事件判断正常结束，断开只是收尾。
 */
function handleEntryStream(port: Browser.runtime.Port): void {
  let alive = true
  const controller = new AbortController()
  let started = false
  port.onDisconnect.addListener(() => {
    alive = false
    controller.abort()
  })

  port.onMessage.addListener((raw: unknown) => {
    void (async () => {
      if (started || !alive) return
      started = true
      const req = raw as StreamStart
      try {
        const settings = await getSettings()
        if (!alive || controller.signal.aborted) return
        if (!isAiConfigured(settings)) {
          throw new AiError('还没配置 AI，请先在设置页填入 API key 和模型名。')
        }

        const key = cacheKey({ ...req, settings })
        const cached = req.bypassCache ? undefined : getCached(key)
        if (cached) {
          void addHistory({
            word: cached.word || req.selection,
            entry: cached, selection: req.selection,
            reading: cached.reading,
            partOfSpeech: cached.partOfSpeech,
            definition: cached.definition,
            contextTranslation: cached.contextTranslation,
            memoryHook: cached.memoryHook,
            sentence: req.sentence,
            sentenceOffset: req.sentenceOffset,
            pageUrl: req.pageUrl,
            pageTitle: req.pageTitle,
            source: 'ai',
          })
          // 命中缓存就没什么可流的了，直接给最终结果
          if (alive) port.postMessage({ type: 'done', entry: cached } satisfies StreamEvent)
          return
        }

        const entry = await streamEntry({
          ...req,
          signal: controller.signal,
          settings,
          onPartial: (partial) => {
            if (alive) port.postMessage({ type: 'partial', entry: partial } satisfies StreamEvent)
          },
        })

        // 优先使用本地词库中人工精校的记忆线索，若无则保留 AI 生成的 memoryHook
        if (settings.dict.enabled) {
          try {
            const dictRes = await lookupWord(entry.word || req.selection)
            if (dictRes?.memoryHook) {
              entry.memoryHook = dictRes.memoryHook
            }
          } catch {
            // ignore
          }
        }

        if (!alive || controller.signal.aborted) return
        setCached(key, entry)
        void addHistory({
          word: entry.word || req.selection,
          entry, selection: req.selection,
          reading: entry.reading,
          partOfSpeech: entry.partOfSpeech,
          definition: entry.definition,
          contextTranslation: entry.contextTranslation,
          memoryHook: entry.memoryHook,
          sentence: req.sentence,
          sentenceOffset: req.sentenceOffset,
          pageUrl: req.pageUrl,
          pageTitle: req.pageTitle,
          source: 'ai',
        })

        if (alive) port.postMessage({ type: 'done', entry } satisfies StreamEvent)
      } catch (err) {
        if (alive) {
          port.postMessage({ type: 'error', message: toErrorMessage(err) } satisfies StreamEvent)
        }
      } finally {
        if (alive) port.disconnect()
      }
    })()
  })
}

export default defineBackground(() => {
  browser.runtime.onConnect.addListener((port) => {
    if (port.name === ENTRY_STREAM_PORT) handleEntryStream(port)
    else if (port.name === DICT_IMPORT_PORT) handleDictImportPort(port)
  })

  // 用 sendResponse + return true，而不是返回 Promise：
  // WXT 0.20 起 browser 默认走原生 API，Chrome 的 onMessage 不认 Promise 返回值。
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handle(message as Request, sender)
      .then(sendResponse)
      .catch((err: unknown) => sendResponse({ ok: false, error: toErrorMessage(err) }))
    return true
  })

  // 尝试配置点击扩展图标时默认展开侧边栏（如果宿主浏览器支持）
  const globalChrome = (globalThis as unknown as {
    chrome?: {
      sidePanel?: {
        setPanelBehavior?: (opts: { openPanelOnActionClick: boolean }) => Promise<void>
      }
    }
  }).chrome
  globalChrome?.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true })?.catch?.(() => {})

  // 首次安装直接把设置页推到用户面前——没配 key 的话插件什么也做不了
  browser.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
      void browser.runtime.openOptionsPage()
    }
  })
})
