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
import { getSettings, isAiConfigured } from '@/lib/settings'

async function handle(req: Request): Promise<Result<unknown>> {
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

      if (settings.dict.enabled && isShortWord) {
        try {
          const meta = await getDictMeta()
          if (meta.status === 'ready') {
            const dictRes = await lookupWord(text)
            if (dictRes) {
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
      return { ok: true, data: { mode: 'mt', ...result } }
    }

    case 'save-card': {
      try {
        // 快速存卡如果缺少句子翻译且有原句，顺带异步机翻补全
        if (!req.payload.entry.contextTranslation && req.payload.sentence) {
          try {
            const mt = await quickTranslate(req.payload.sentence, {
              provider: settings.mt.provider,
              explainLanguage: settings.explainLanguage,
            })
            if (mt.translation) {
              req.payload.entry.contextTranslation = mt.translation
            }
          } catch {
            // 忽略机翻错误
          }
        }

        const noteId = await addNote(req.payload, settings)
        return { ok: true, data: { noteId, queued: false } }
      } catch (err) {
        // Anki 没开就先排队，让用户能接着读下去；其它错误（重复词等）照常报出去
        if (!(err instanceof AnkiError && err.kind === 'unreachable')) throw err

        const queued = await enqueue(req.payload)
        return { ok: true, data: { noteId: null, queued: true, pending: queued } }
      }
    }

    case 'pending-count': {
      return { ok: true, data: { count: await pendingCount() } }
    }

    case 'pending-list': {
      return { ok: true, data: { cards: await readPending() } }
    }

    case 'remove-pending': {
      return { ok: true, data: { count: await removePending(req.payload.word) } }
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
        card => addNote(card, settings),
        // 只有连不上才值得留着重试；重复词之类重试一万次也是同样的结果
        err => err instanceof AnkiError && err.kind === 'unreachable',
      )
      return { ok: true, data: result }
    }

    case 'check-duplicate': {
      const ids = await findExisting(req.payload.word, settings)
      return { ok: true, data: { exists: ids.length > 0 } }
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
  port.onDisconnect.addListener(() => {
    alive = false
  })

  port.onMessage.addListener((raw: unknown) => {
    void (async () => {
      const req = raw as StreamStart
      try {
        const settings = await getSettings()
        if (!isAiConfigured(settings)) {
          throw new AiError('还没配置 AI，请先在设置页填入 API key 和模型名。')
        }

        const key = cacheKey({ ...req, settings })
        const cached = getCached(key)
        if (cached) {
          // 命中缓存就没什么可流的了，直接给最终结果
          if (alive) port.postMessage({ type: 'done', entry: cached } satisfies StreamEvent)
          return
        }

        const entry = await streamEntry({
          ...req,
          settings,
          onPartial: (partial) => {
            if (alive) port.postMessage({ type: 'partial', entry: partial } satisfies StreamEvent)
          },
        })

        // 尝试从本地词库补充记忆主线 (Memory Hook)
        if (!entry.memoryHook && settings.dict.enabled) {
          try {
            const dictRes = await lookupWord(entry.word || req.selection)
            if (dictRes?.memoryHook) {
              entry.memoryHook = dictRes.memoryHook
            }
          } catch {
            // ignore
          }
        }

        setCached(key, entry)
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
  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    handle(message as Request)
      .then(sendResponse)
      .catch((err: unknown) => sendResponse({ ok: false, error: toErrorMessage(err) }))
    return true
  })

  // 首次安装直接把设置页推到用户面前——没配 key 的话插件什么也做不了
  browser.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
      void browser.runtime.openOptionsPage()
    }
  })
})
