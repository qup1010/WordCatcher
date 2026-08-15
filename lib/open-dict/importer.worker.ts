import { openDictDb, saveBatchEntries, saveDictMeta } from './db'
import type { OpenDictEntry } from './types'

// 确保 IndexedDB 在 Worker 中可用
self.onmessage = async (e: MessageEvent) => {
  const { type, url } = e.data

  if (type === 'start') {
    let aborted = false
    const abortController = new AbortController()

    const handleAbort = (evt: MessageEvent) => {
      if (evt.data?.type === 'abort') {
        aborted = true
        abortController.abort()
      }
    }
    self.addEventListener('message', handleAbort)

    try {
      await saveDictMeta({
        status: 'downloading',
        entryCount: 0,
        updatedAt: Date.now(),
      })

      self.postMessage({
        type: 'progress',
        percent: 5,
        processedCount: 0,
        statusText: '正在连接服务器并下载词典包...',
      })

      const res = await fetch(url, { signal: abortController.signal })
      if (!res.ok) {
        throw new Error(`下载失败，服务器返回 HTTP ${res.status}`)
      }

      if (!res.body) {
        throw new Error('未获取到有效响应数据流')
      }

      self.postMessage({
        type: 'progress',
        percent: 15,
        processedCount: 0,
        statusText: '开始流式解压与解析词条...',
      })

      // 确保 IndexedDB 连接已建立
      await openDictDb()

      let stream = res.body
      if (typeof DecompressionStream !== 'undefined') {
        // 原生 Gzip 流式解压
        stream = stream.pipeThrough(new DecompressionStream('gzip'))
      }

      const reader = stream.pipeThrough(new TextDecoderStream()).getReader()

      let buffer = ''
      let count = 0
      let batch: OpenDictEntry[] = []
      const BATCH_SIZE = 2000
      // 官方约 84,212 词条，以此为进度基准
      const ESTIMATED_TOTAL = 85000

      while (true) {
        if (aborted) {
          throw new Error('用户取消下载')
        }

        const { value, done } = await reader.read()
        if (done) break

        buffer += value
        const lines = buffer.split('\n')
        // 最后一段可能不完整，保留在 buffer 中
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
            // 忽略格式错误的行
          }

          if (batch.length >= BATCH_SIZE) {
            await saveBatchEntries(batch)
            batch = []

            const progress = Math.min(95, Math.round(15 + (count / ESTIMATED_TOTAL) * 80))
            self.postMessage({
              type: 'progress',
              percent: progress,
              processedCount: count,
              statusText: `已写入 ${count.toLocaleString()} 条词目...`,
            })
          }
        }
      }

      // 处理最后剩余的 buffer 行
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

      self.postMessage({
        type: 'done',
        count,
        percent: 100,
        statusText: `离线词库安装完成，共导入 ${count.toLocaleString()} 条词目！`,
      })
    } catch (err: any) {
      if (aborted) {
        await saveDictMeta({
          status: 'uninstalled',
          entryCount: 0,
          updatedAt: Date.now(),
        })
        self.postMessage({ type: 'aborted' })
      } else {
        const errorMsg = err?.message || String(err)
        await saveDictMeta({
          status: 'error',
          entryCount: 0,
          updatedAt: Date.now(),
          errorMessage: errorMsg,
        })
        self.postMessage({ type: 'error', message: errorMsg })
      }
    } finally {
      self.removeEventListener('message', handleAbort)
    }
  }
}
