import { browser, defineBackground } from '#imports'
import { AiError, generateEntry, listModels, testConnection } from '@/lib/ai'
import { AnkiError, addNote, checkConnection, updateModelTemplates } from '@/lib/anki'
import { MtError, quickTranslate } from '@/lib/machine-translate'
import type { Request, Result } from '@/lib/messaging'
import { getSettings, isAiConfigured } from '@/lib/settings'

async function handle(req: Request): Promise<Result<unknown>> {
  const settings = await getSettings()

  switch (req.type) {
    case 'generate-entry': {
      if (!isAiConfigured(settings)) {
        return { ok: false, error: '还没配置 AI，请先在设置页填入 API key 和模型名。' }
      }
      const entry = await generateEntry({ ...req.payload, settings })
      return { ok: true, data: entry }
    }

    case 'list-models': {
      const models = await listModels(settings)
      return { ok: true, data: { models } }
    }

    case 'test-ai': {
      const reply = await testConnection(settings)
      return { ok: true, data: { reply } }
    }

    case 'quick-translate': {
      const result = await quickTranslate(req.payload.text, {
        provider: settings.mt.provider,
        explainLanguage: settings.explainLanguage,
      })
      return { ok: true, data: result }
    }

    case 'save-card': {
      const noteId = await addNote(req.payload, settings)
      return { ok: true, data: { noteId } }
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

export default defineBackground(() => {
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
