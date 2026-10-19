import { contextKey, saveLearning, readLearning, updateLearning, removeLearning, importLearning, exportLearning, effectiveCard, markLearningSync } from '@/lib/learning'
import { WebDavError, getWebDavSyncState, syncLearningWithWebDav, testWebDavConnection } from '@/lib/webdav'
import { browser, defineBackground } from '#imports'
import type { Browser } from 'wxt/browser'
import { AiError, PREVIEW_SAMPLE, listModels, streamEntry, testConnection, translateSentenceWithAi } from '@/lib/ai'
import {
  AnkiError,
  addNote,
  checkConnection,
  findExisting,
  updateModelTemplates,
} from '@/lib/anki'
import { cacheKey, cacheSize, clearCache, getCached, setCached } from '@/lib/entry-cache'
import { MtError, quickTranslate } from '@/lib/machine-translate'
import {
  type ActiveLookupSnapshot,
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
import { getSettings, isAiConfigured, watchSettings } from '@/lib/settings'

let lastActiveLookup: ActiveLookupSnapshot | null = null
let webdavDebounceTimer: ReturnType<typeof setTimeout> | null = null
const sentenceTransCache = new Map<string, { translation: string, mode: 'mt' | 'ai' }>()
let sentenceTransCacheVersion = 0

function scheduleWebDavAutoSync(forcePush = true): void {
  if (webdavDebounceTimer) clearTimeout(webdavDebounceTimer)
  webdavDebounceTimer = setTimeout(() => {
    webdavDebounceTimer = null
    void getSettings().then((s) => {
      if (s.webdav?.enabled && s.webdav.autoSync && s.webdav.url.trim()) {
        void syncLearningWithWebDav(s.webdav, forcePush).catch(() => {})
      }
    }).catch(() => {})
  }, 2500)
}

async function handle(req: Request, sender?: Browser.runtime.MessageSender): Promise<Result<unknown>> {
  const requestCacheVersion = sentenceTransCacheVersion
  const settings = await getSettings()

  switch (req.type) {
    case 'list-models': {
      const models = await listModels(settings)
      return { ok: true, data: { models } }
    }

    case 'test-ai': {
      try {
        const sample = await streamEntry({ ...PREVIEW_SAMPLE, settings, onPartial: () => {} })
        return { ok: true, data: { sample, reply: null, structuredError: null } }
      } catch (structuredErr) {
        const reply = await testConnection(settings)
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
              const entry = {
                word: dictRes.headword,
                reading: dictRes.reading || '',
                partOfSpeech: dictRes.primaryPos || '',
                definition: dictRes.coreMeanings.join('； '),
                contextTranslation: '',
                memoryHook: dictRes.memoryHook,
              }
              lastActiveLookup = {
                word: dictRes.headword,
                selection: text,
                sentence: ctx?.sentence || '',
                sentenceOffset: ctx?.sentenceOffset ?? -1,
                pageUrl: ctx?.pageUrl || '',
                pageTitle: ctx?.pageTitle || '',
                entry,
                dict: dictRes,
                updatedAt: Date.now(),
              }
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
          // 本地词典未命中或读取失败时回退至在线翻译
        }
      }

      const result = await quickTranslate(text, {
        provider: settings.mt.provider,
        explainLanguage: settings.explainLanguage,
      })

      const mtPos = result.dictionary?.[0]?.pos || ''
      const mtDef = result.dictionary && result.dictionary.length > 0
        ? result.dictionary.map(d => (d.pos ? `${d.pos} ${d.meanings.join('；')}` : d.meanings.join('；'))).join(' / ')
        : result.translation

      lastActiveLookup = {
        word: text,
        selection: text,
        sentence: ctx?.sentence || '',
        sentenceOffset: ctx?.sentenceOffset ?? -1,
        pageUrl: ctx?.pageUrl || '',
        pageTitle: ctx?.pageTitle || '',
        entry: {
          word: text,
          reading: '',
          partOfSpeech: mtPos,
          definition: mtDef,
          contextTranslation: '',
        },
        updatedAt: Date.now(),
      }

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

    case 'translate-sentence': {
      const rawSentence = req.payload.sentence.trim()
      if (!rawSentence) {
        throw new Error('原句内容为空，无法翻译。')
      }
      const mode: 'mt' | 'ai' = settings.mt.sentenceMode === 'ai' ? 'ai' : 'mt'
      const key = JSON.stringify([
        mode,
        settings.explainLanguage,
        mode === 'mt' ? settings.mt.provider : settings.ai.activeId,
        rawSentence,
        req.payload.selection ?? '',
      ])
      const cached = requestCacheVersion === sentenceTransCacheVersion ? sentenceTransCache.get(key) : undefined
      if (cached) {
        return { ok: true, data: cached }
      }

      let translation: string
      if (mode === 'ai') {
        translation = await translateSentenceWithAi({
          sentence: rawSentence,
          selection: req.payload.selection,
          settings,
        })
      } else {
        const mtRes = await quickTranslate(rawSentence, {
          provider: settings.mt.provider,
          explainLanguage: settings.explainLanguage,
        })
        translation = mtRes.translation
      }

      const out = { translation, mode }
      if (requestCacheVersion === sentenceTransCacheVersion) {
        if (sentenceTransCache.size >= 100) {
          const firstKey = sentenceTransCache.keys().next().value
          if (firstKey !== undefined) sentenceTransCache.delete(firstKey)
        }
        sentenceTransCache.set(key, out)
      }
      return { ok: true, data: out }
    }

    case 'save-card': {
      const record = await saveLearning(req.payload)
      const card = effectiveCard(record)
      if (settings.webdav?.enabled && settings.webdav.autoSync && settings.webdav.url.trim()) {
        scheduleWebDavAutoSync(true)
      }

      // 若用户关闭了 Anki 自动同步拓展，直接保存在本地单词本即可，无需报错或入队
      if (settings.anki.enabled === false) {
        void markHistorySaved(record.card.entry.word)
        return { ok: true, data: { noteId: null, queued: false, recordId: record.id } }
      }

      try {
        const noteId = await addNote(card, settings)
        await markLearningSync(record.id, undefined, record.revision)
        void markHistorySaved(record.card.entry.word)
        return { ok: true, data: { noteId, queued: false, recordId: record.id } }
      } catch (err) {
        const message = toErrorMessage(err)
        await markLearningSync(record.id, message, record.revision)
        const pending = await enqueue(card)
        return { ok: true, data: { noteId: null, queued: true, pending, recordId: record.id, syncError: message } }
      }
    }

    case 'library-list':
      return { ok: true, data: await readLearning() }
    case 'library-export':
      return { ok: true, data: await exportLearning() }
    case 'library-import': {
      const added = await importLearning(req.payload.json)
      if (added > 0 && settings.webdav?.enabled && settings.webdav.autoSync && settings.webdav.url.trim()) {
        scheduleWebDavAutoSync(true)
      }
      return { ok: true, data: { added, records: await readLearning() } }
    }
    case 'library-remove': {
      const next = await removeLearning(req.payload.id)
      if (settings.webdav?.enabled && settings.webdav.autoSync && settings.webdav.url.trim()) {
        scheduleWebDavAutoSync(true)
      }
      return { ok: true, data: next }
    }
    case 'library-update': {
      const record = await updateLearning(req.payload.id, req.payload.edits)
      if (settings.webdav?.enabled && settings.webdav.autoSync && settings.webdav.url.trim()) {
        scheduleWebDavAutoSync(true)
      }
      if (settings.anki.enabled !== false) {
        await enqueue(effectiveCard(record))
      }
      return { ok: true, data: record }
    }
    case 'library-sync': {
      const record = (await readLearning()).find(r => r.id === req.payload.id)
      if (!record) throw new Error('未找到该条语境记录。')
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

    case 'webdav-test': {
      const res = await testWebDavConnection(settings.webdav)
      return { ok: true, data: res }
    }

    case 'webdav-sync': {
      const res = await syncLearningWithWebDav(settings.webdav, req.payload?.forcePush ?? false)
      const records = await readLearning()
      return { ok: true, data: { ...res, records } }
    }

    case 'webdav-status': {
      const state = await getWebDavSyncState()
      return { ok: true, data: state }
    }

    case 'pending-count': {
      return { ok: true, data: { count: await pendingCount() } }
    }

    case 'pending-list': {
      return { ok: true, data: { cards: await readPending() } }
    }

    case 'remove-pending': {
      return { ok: true, data: { count: await removePending(req.payload.word, req.payload.contextKey, req.payload.recordId) } }
    }

    case 'clear-pending': {
      await clearPending()
      return { ok: true, data: { count: 0 } }
    }

    case 'cache-stats': {
      return { ok: true, data: { size: cacheSize() } }
    }

    case 'clear-cache': {
      const cleared = cacheSize() + sentenceTransCache.size
      clearCache()
      sentenceTransCache.clear()
      return { ok: true, data: { cleared } }
    }

    case 'flush-pending': {
      const result = await flushPending(
        async card => {
          const records = await readLearning()
          const matches = card.recordId
            ? records.filter(r => r.id === card.recordId)
            : records.filter(r => contextKey(r.card) === contextKey(card))
          if (matches.length !== 1) throw new Error('本地记录已删除或身份不明确，跳过 Anki 写入。')
          const current = matches[0]
          const noteId = await addNote(effectiveCard(current), settings)
          await markLearningSync(current.id, undefined, current.revision)
          return noteId
        },
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

    case 'sidepanel-set-active': {
      lastActiveLookup = req.payload
      return { ok: true, data: null }
    }

    case 'sidepanel-get-active': {
      return { ok: true, data: lastActiveLookup }
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
        return { ok: false, error: '当前浏览器不支持侧边栏功能。' }
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
        return { ok: false, error: '未能定位当前浏览器窗口。' }
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
  if (err instanceof AnkiError || err instanceof AiError || err instanceof MtError || err instanceof WebDavError) return err.message
  if (err instanceof Error) return err.message
  return String(err)
}

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
          throw new AiError('尚未配置 AI 服务，请先在设置页填写 API Key 和模型名称。')
        }

        const key = cacheKey({ ...req, settings })
        const cached = req.bypassCache ? undefined : getCached(key)
        if (cached) {
          lastActiveLookup = {
            word: cached.word || req.selection,
            selection: req.selection,
            sentence: req.sentence || '',
            sentenceOffset: req.sentenceOffset ?? -1,
            pageUrl: req.pageUrl || '',
            pageTitle: req.pageTitle || '',
            entry: cached,
            updatedAt: Date.now(),
          }
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
        lastActiveLookup = {
          word: entry.word || req.selection,
          selection: req.selection,
          sentence: req.sentence || '',
          sentenceOffset: req.sentenceOffset ?? -1,
          pageUrl: req.pageUrl || '',
          pageTitle: req.pageTitle || '',
          entry,
          updatedAt: Date.now(),
        }
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
  watchSettings(() => {
    sentenceTransCacheVersion++
    sentenceTransCache.clear()
  })
  browser.runtime.onConnect.addListener((port) => {
    if (port.name === ENTRY_STREAM_PORT) handleEntryStream(port)
    else if (port.name === DICT_IMPORT_PORT) handleDictImportPort(port)
  })

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handle(message as Request, sender)
      .then(sendResponse)
      .catch((err: unknown) => sendResponse({ ok: false, error: toErrorMessage(err) }))
    return true
  })

  const globalChrome = (globalThis as unknown as {
    chrome?: {
      sidePanel?: {
        setPanelBehavior?: (opts: { openPanelOnActionClick: boolean }) => Promise<void>
      }
    }
  }).chrome
  globalChrome?.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true })?.catch?.(() => {})

  browser.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
      void browser.runtime.openOptionsPage()
    }
  })
})
