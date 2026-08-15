import { browser } from '#imports'
import type { Browser } from 'wxt/browser'
import { openDictDb, saveBatchEntries, saveDictMeta } from './db'
import type { OpenDictEntry } from './types'

export const DICT_IMPORT_PORT = 'wc-dict-import'

export interface ImportProgress {
  percent: number
  processedCount: number
  statusText: string
}

export interface ImportHandlers {
  onProgress: (p: ImportProgress) => void
  onDone: (count: number) => void
  onError: (message: string) => void
  onAborted?: () => void
}

export type ImportPortMessage =
  | { type: 'progress', percent: number, processedCount: number, statusText: string }
  | { type: 'done', count: number, percent: number, statusText: string }
  | { type: 'error', message: string }
  | { type: 'aborted' }

/**
 * 客户端（设置页）调用：通过 Background Port 发起离线词典下载与导入
 * 返回一个 abort 取消函数
 */
export function startDictImport(downloadUrl: string, handlers: ImportHandlers): () => void {
  let finished = false
  let port: ReturnType<typeof browser.runtime.connect>

  try {
    port = browser.runtime.connect({ name: DICT_IMPORT_PORT })
  } catch (err: any) {
    handlers.onError(`无法连接扩展后台: ${err?.message || err}`)
    return () => {}
  }

  port.onMessage.addListener((raw) => {
    if (finished) return
    const msg = raw as ImportPortMessage

    if (msg.type === 'progress') {
      handlers.onProgress({
        percent: msg.percent,
        processedCount: msg.processedCount,
        statusText: msg.statusText,
      })
    } else if (msg.type === 'done') {
      finished = true
      handlers.onDone(msg.count)
    } else if (msg.type === 'error') {
      finished = true
      handlers.onError(msg.message)
    } else if (msg.type === 'aborted') {
      finished = true
      handlers.onAborted?.()
    }
  })

  port.onDisconnect.addListener(() => {
    if (finished) return
    finished = true
    handlers.onError('与扩展后台的连接断开')
  })

  port.postMessage({ type: 'start', url: downloadUrl })

  return () => {
    if (!finished) {
      finished = true
      try {
        port.postMessage({ type: 'abort' })
      } catch {
        // ignore
      }
      setTimeout(() => {
        try {
          port.disconnect()
        } catch {
          // ignore
        }
      }, 100)
    }
  }
}

/**
 * 客户端（设置页）调用：直接导入用户本地下载的词库文件（支持 .jsonl.gz, .gz 或解压后的 .jsonl）
 */
export async function importLocalDictFile(
  file: File,
  handlers: ImportHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const isGzip = file.name.endsWith('.gz') || file.type.includes('gzip')

  handlers.onProgress({
    percent: 5,
    processedCount: 0,
    statusText: isGzip ? '正在读取并解压本地词库文件...' : '正在读取本地词库文件...',
  })

  await saveDictMeta({
    status: 'downloading',
    entryCount: 0,
    updatedAt: Date.now(),
  })

  await openDictDb()

  let stream = file.stream()
  if (isGzip) {
    if (typeof DecompressionStream !== 'undefined') {
      stream = stream.pipeThrough(new DecompressionStream('gzip'))
    } else {
      throw new Error('当前浏览器环境不支持 DecompressionStream 解压 gzip 文件')
    }
  }

  const reader = stream.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  let count = 0
  let batch: OpenDictEntry[] = []
  const BATCH_SIZE = 2000
  const ESTIMATED_TOTAL = 84500

  try {
    while (true) {
      if (signal?.aborted) {
        throw new Error('用户取消导入')
      }

      const { value, done } = await reader.read()
      if (done) break

      buffer += value
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue

        try {
          const entry = JSON.parse(trimmed) as OpenDictEntry
          if (entry.headword) {
            batch.push(entry)
            count++
          }
        } catch {
          // 忽略非法行
        }

        if (batch.length >= BATCH_SIZE) {
          await saveBatchEntries(batch)
          batch = []

          const progress = Math.min(98, Math.round(10 + (count / ESTIMATED_TOTAL) * 88))
          handlers.onProgress({
            percent: progress,
            processedCount: count,
            statusText: `正在导入本地词条: 已写入 ${count.toLocaleString()} 条...`,
          })
        }
      }
    }

    if (buffer.trim()) {
      try {
        const entry = JSON.parse(buffer.trim()) as OpenDictEntry
        if (entry.headword) {
          batch.push(entry)
          count++
        }
      } catch {
        // ignore
      }
    }

    if (batch.length > 0) {
      await saveBatchEntries(batch)
    }

    if (count === 0) {
      throw new Error('文件中未解析到有效的词条数据，请确认是否为正确的 Open Dictionary 数据包')
    }

    await saveDictMeta({
      status: 'ready',
      entryCount: count,
      updatedAt: Date.now(),
    })

    handlers.onDone(count)
  } catch (err: any) {
    if (signal?.aborted) {
      await saveDictMeta({
        status: 'uninstalled',
        entryCount: 0,
        updatedAt: Date.now(),
      })
      handlers.onAborted?.()
    } else {
      const msg = err?.message || String(err)
      await saveDictMeta({
        status: 'error',
        entryCount: 0,
        updatedAt: Date.now(),
        errorMessage: msg,
      })
      handlers.onError(msg)
    }
  }
}

/**
 * Background Service Worker 执行端：
 * 拥有 host_permissions，无跨域限制，支持 302 重定向流式下载、解压并写入 IndexedDB
 */
export function handleDictImportPort(port: Browser.runtime.Port): void {
  let alive = true
  let aborted = false
  const abortController = new AbortController()

  port.onDisconnect.addListener(() => {
    alive = false
    aborted = true
    abortController.abort()
  })

  port.onMessage.addListener((raw: unknown) => {
    const data = raw as { type: string, url?: string }

    if (data.type === 'abort') {
      aborted = true
      abortController.abort()
      return
    }

    if (data.type === 'start' && data.url) {
      const downloadUrl = data.url.trim()
      void (async () => {
        try {
          await saveDictMeta({
            status: 'downloading',
            entryCount: 0,
            updatedAt: Date.now(),
          })

          if (alive) {
            port.postMessage({
              type: 'progress',
              percent: 5,
              processedCount: 0,
              statusText: '正在连接服务器并下载词典包 (约 93MB)...',
            } satisfies ImportPortMessage)
          }

          const res = await fetch(downloadUrl, {
            signal: abortController.signal,
          })

          if (!res.ok) {
            throw new Error(`下载失败，服务器返回 HTTP ${res.status}`)
          }

          if (!res.body) {
            throw new Error('未获取到有效响应数据流')
          }

          if (alive) {
            port.postMessage({
              type: 'progress',
              percent: 15,
              processedCount: 0,
              statusText: '开始流式解压与解析词条...',
            } satisfies ImportPortMessage)
          }

          // 确保 IndexedDB 就绪
          await openDictDb()

          let stream = res.body
          if (typeof DecompressionStream !== 'undefined') {
            stream = stream.pipeThrough(new DecompressionStream('gzip'))
          }

          const reader = stream.pipeThrough(new TextDecoderStream()).getReader()

          let buffer = ''
          let count = 0
          let batch: OpenDictEntry[] = []
          const BATCH_SIZE = 2000
          // 84,212 词条为基准
          const ESTIMATED_TOTAL = 84500

          while (true) {
            if (aborted) {
              throw new Error('用户取消下载')
            }

            const { value, done } = await reader.read()
            if (done) break

            buffer += value
            const lines = buffer.split('\n')
            buffer = lines.pop() ?? ''

            for (const line of lines) {
              const trimmed = line.trim()
              if (!trimmed) continue

              try {
                const entry = JSON.parse(trimmed) as OpenDictEntry
                if (entry.headword) {
                  batch.push(entry)
                  count++
                }
              } catch {
                // 忽略异常行
              }

              if (batch.length >= BATCH_SIZE) {
                await saveBatchEntries(batch)
                batch = []

                const progress = Math.min(96, Math.round(15 + (count / ESTIMATED_TOTAL) * 80))
                if (alive) {
                  port.postMessage({
                    type: 'progress',
                    percent: progress,
                    processedCount: count,
                    statusText: `已写入 ${count.toLocaleString()} 条词目...`,
                  } satisfies ImportPortMessage)
                }
              }
            }
          }

          if (buffer.trim()) {
            try {
              const entry = JSON.parse(buffer.trim()) as OpenDictEntry
              if (entry.headword) {
                batch.push(entry)
                count++
              }
            } catch {
              // ignore
            }
          }

          if (batch.length > 0) {
            await saveBatchEntries(batch)
          }

          await saveDictMeta({
            status: 'ready',
            entryCount: count,
            updatedAt: Date.now(),
          })

          if (alive) {
            port.postMessage({
              type: 'done',
              count,
              percent: 100,
              statusText: `离线词库安装完成，共导入 ${count.toLocaleString()} 条词目！`,
            } satisfies ImportPortMessage)
          }
        } catch (err: any) {
          if (aborted) {
            await saveDictMeta({
              status: 'uninstalled',
              entryCount: 0,
              updatedAt: Date.now(),
            })
            if (alive) {
              port.postMessage({ type: 'aborted' } satisfies ImportPortMessage)
            }
          } else {
            const errorMsg = err?.message || String(err)
            await saveDictMeta({
              status: 'error',
              entryCount: 0,
              updatedAt: Date.now(),
              errorMessage: errorMsg,
            })
            if (alive) {
              port.postMessage({ type: 'error', message: errorMsg } satisfies ImportPortMessage)
            }
          }
        } finally {
          if (alive) {
            try {
              port.disconnect()
            } catch {
              // ignore
            }
          }
        }
      })()
    }
  })
}
