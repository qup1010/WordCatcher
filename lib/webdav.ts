import { storage } from '#imports'
import { exportSyncLearning, mergeLearningRecords, readLearning } from './learning'
import { timeout } from './net'
import type { Settings, WebDavSyncState } from './types'

const SYNC_STATE_KEY = 'local:webdav_sync_state' as const
const WEBDAV_TIMEOUT_MS = 15000
const DEFAULT_REMOTE_PATH = 'WordCatcher/vocabulary-sync.json'

export class WebDavError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WebDavError'
  }
}

let syncChain: Promise<unknown> = Promise.resolve()

function serializeSync<T>(task: () => Promise<T>): Promise<T> {
  const next = syncChain.then(task, task)
  syncChain = next.catch(() => {})
  return next
}

export function buildBasicAuth(username: string, password: string): string {
  const raw = `${username}:${password}`
  const bytes = new TextEncoder().encode(raw)
  let binary = ''
  for (const b of bytes) {
    binary += String.fromCharCode(b)
  }
  return `Basic ${btoa(binary)}`
}

export interface ResolvedWebDavTarget {
  baseUrl: string
  fileUrl: string
  directoryUrls: string[]
}

export function resolveWebDavTarget(rawBaseUrl: string, rawRemotePath?: string): ResolvedWebDavTarget {
  const trimmedBase = rawBaseUrl.trim().replace(/\/+$/, '')
  if (!trimmedBase) {
    throw new WebDavError('请先填写 WebDAV 服务器地址。')
  }

  let parsed: URL
  try {
    parsed = new URL(trimmedBase)
  } catch {
    throw new WebDavError('WebDAV 服务器地址格式无效，请使用 HTTPS 地址。')
  }
  if (parsed.protocol !== 'https:') {
    throw new WebDavError('WebDAV 服务器地址必须使用 HTTPS，以保护认证信息和同步数据。')
  }

  // 如果用户在 URL 里直接填了完整的 .json 文件路径
  if (trimmedBase.toLowerCase().endsWith('.json')) {
    const lastSlash = trimmedBase.lastIndexOf('/')
    const parent = lastSlash > parsed.origin.length ? trimmedBase.slice(0, lastSlash) : parsed.origin
    return {
      baseUrl: parent,
      fileUrl: trimmedBase,
      directoryUrls: parent !== parsed.origin ? [parent] : [],
    }
  }

  const cleanPath = (rawRemotePath?.trim() || DEFAULT_REMOTE_PATH).replace(/^\/+/, '').replace(/\/+$/, '')
  const segments = cleanPath.split('/').filter(Boolean)
  if (segments.length === 0) {
    segments.push('WordCatcher', 'vocabulary-sync.json')
  }

  const encodedSegments = segments.map(seg => encodeURIComponent(seg))
  const directoryUrls: string[] = []
  let current = trimmedBase
  for (let i = 0; i < encodedSegments.length - 1; i++) {
    current = `${current}/${encodedSegments[i]}`
    directoryUrls.push(current)
  }

  return {
    baseUrl: trimmedBase,
    fileUrl: `${trimmedBase}/${encodedSegments.join('/')}`,
    directoryUrls,
  }
}

function buildHeaders(config: Settings['webdav'], extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...(extra ?? {}) }
  if (config.username.trim() || config.password) {
    headers.Authorization = buildBasicAuth(config.username.trim(), config.password)
  }
  return headers
}

async function ensureDirectories(target: ResolvedWebDavTarget, config: Settings['webdav']): Promise<void> {
  for (const dirUrl of target.directoryUrls) {
    try {
      const check = await fetch(`${dirUrl}/`, {
        method: 'PROPFIND',
        headers: buildHeaders(config, { Depth: '0' }),
        signal: timeout(WEBDAV_TIMEOUT_MS),
      })
      if (check.status === 401 || check.status === 403) {
        throw new WebDavError('WebDAV 认证失败（401/403），请检查用户名或应用密码是否正确。')
      }
      if (check.ok || check.status === 207) continue
    } catch (err) {
      if (err instanceof WebDavError) throw err
    }

    const mkcol = await fetch(`${dirUrl}/`, {
      method: 'MKCOL',
      headers: buildHeaders(config),
      signal: timeout(WEBDAV_TIMEOUT_MS),
    })
    if (mkcol.status === 401 || mkcol.status === 403) {
      throw new WebDavError('WebDAV 认证失败（401/403），请检查用户名或应用密码是否正确。')
    }
    // 201 Created, 405 Method Not Allowed (已存在), 301/200 均视为目录可用
    if (!mkcol.ok && mkcol.status !== 405 && mkcol.status !== 207) {
      // 某些服务端不要求尾斜杠
      const mkcolRetry = await fetch(dirUrl, {
        method: 'MKCOL',
        headers: buildHeaders(config),
        signal: timeout(WEBDAV_TIMEOUT_MS),
      })
      if (mkcolRetry.status === 401 || mkcolRetry.status === 403) {
        throw new WebDavError('WebDAV 认证失败（401/403），请检查用户名或应用密码是否正确。')
      }
      if (!mkcolRetry.ok && mkcolRetry.status !== 405) {
        throw new WebDavError(`创建 WebDAV 目录失败（HTTP ${mkcolRetry.status}）。`)
      }
    }
  }
}

export async function getWebDavSyncState(): Promise<WebDavSyncState> {
  const raw = await storage.getItem<unknown>(SYNC_STATE_KEY)
  return raw && typeof raw === 'object' ? (raw as WebDavSyncState) : {}
}

async function saveWebDavSyncState(state: WebDavSyncState): Promise<void> {
  await storage.setItem(SYNC_STATE_KEY, state)
}

/**
 * 测试 WebDAV 连接与目录读写权限。
 */
export async function testWebDavConnection(config: Settings['webdav']): Promise<{ exists: boolean, fileUrl: string }> {
  const target = resolveWebDavTarget(config.url, config.remotePath)

  try {
    const res = await fetch(target.fileUrl, {
      method: 'PROPFIND',
      headers: buildHeaders(config, { Depth: '0' }),
      signal: timeout(WEBDAV_TIMEOUT_MS),
    })

    if (res.status === 401 || res.status === 403) {
      throw new WebDavError('WebDAV 认证失败（401/403），请检查用户名或应用密码。')
    }
    if (res.ok || res.status === 207) {
      return { exists: true, fileUrl: target.fileUrl }
    }
    if (res.status === 404) {
      await ensureDirectories(target, config)
      return { exists: false, fileUrl: target.fileUrl }
    }
    // 部分服务器不支持对不存在的文件发 PROPFIND，尝试 GET
    const getRes = await fetch(target.fileUrl, {
      method: 'GET',
      headers: buildHeaders(config, { 'Cache-Control': 'no-cache' }),
      signal: timeout(WEBDAV_TIMEOUT_MS),
    })
    if (getRes.status === 401 || getRes.status === 403) {
      throw new WebDavError('WebDAV 认证失败（401/403），请检查用户名或应用密码。')
    }
    if (getRes.ok) {
      return { exists: true, fileUrl: target.fileUrl }
    }
    if (getRes.status === 404) {
      await ensureDirectories(target, config)
      return { exists: false, fileUrl: target.fileUrl }
    }
    throw new WebDavError(`WebDAV 服务器返回异常状态码：HTTP ${getRes.status}`)
  } catch (err) {
    if (err instanceof WebDavError) throw err
    throw new WebDavError(`无法连接 WebDAV 服务器：${err instanceof Error ? err.message : String(err)}`)
  }
}

export interface WebDavSyncResult {
  added: number
  updated: number
  removed: number
  total: number
  pushed: boolean
  syncedAt: number
}

/**
 * 执行一次完整的 Pull -> Merge -> Push 双向同步。
 */
export function syncLearningWithWebDav(config: Settings['webdav'], forcePush = false): Promise<WebDavSyncResult> {
  return serializeSync(async () => {
    const target = resolveWebDavTarget(config.url, config.remotePath)

    try {
      const getRes = await fetch(target.fileUrl, {
        method: 'GET',
        headers: buildHeaders(config, { 'Cache-Control': 'no-cache' }),
        signal: timeout(WEBDAV_TIMEOUT_MS),
      })

      if (getRes.status === 401 || getRes.status === 403) {
        throw new WebDavError('WebDAV 认证失败（401/403），请检查用户名或应用密码。')
      }

      let added = 0
      let updated = 0
      let removed = 0
      let total = 0
      let shouldPush = forcePush
      let remoteEtag: string | null = null
      let remoteMissing = false

      if (getRes.ok) {
        remoteEtag = getRes.headers.get('ETag')
        const remoteText = await getRes.text()
        if (remoteText.trim().length > 0) {
          const merged = await mergeLearningRecords(remoteText)
          added = merged.added
          updated = merged.updated
          removed = merged.removed
          total = merged.total
          shouldPush = shouldPush || merged.needsPush || added > 0 || updated > 0 || removed > 0
        } else {
          throw new WebDavError('远端同步文件为空，已停止同步以保留远端数据。')
        }
      } else if (getRes.status === 404) {
        remoteMissing = true
        await ensureDirectories(target, config)
        total = (await readLearning()).length
        shouldPush = true
      } else {
        throw new WebDavError(`拉取远端单词本失败（HTTP ${getRes.status}）。`)
      }

      let pushed = false
      if (shouldPush) {
        if (!remoteMissing && (!remoteEtag || remoteEtag.startsWith('W/') || !remoteEtag.startsWith('"'))) {
          throw new WebDavError('WebDAV 服务器未提供强 ETag，无法安全合并写入，请检查服务器配置。')
        }
        const writeHeaders = buildHeaders(config, {
          'Content-Type': 'application/json; charset=utf-8',
          ...(remoteMissing ? { 'If-None-Match': '*' } : { 'If-Match': remoteEtag! }),
        })
        const payload = await exportSyncLearning()
        const putRes = await fetch(target.fileUrl, {
          method: 'PUT',
          headers: writeHeaders,
          body: payload,
          signal: timeout(WEBDAV_TIMEOUT_MS),
        })
        if (putRes.status === 412) {
          throw new WebDavError('远端词库已被其他设备更新，请重新同步以合并最新数据。')
        }
        if (putRes.status === 404 || putRes.status === 409) {
          await ensureDirectories(target, config)
          const retryPut = await fetch(target.fileUrl, {
            method: 'PUT',
            headers: writeHeaders,
            body: payload,
            signal: timeout(WEBDAV_TIMEOUT_MS),
          })
          if (retryPut.status === 412) {
            throw new WebDavError('远端词库已被其他设备更新，请重新同步以合并最新数据。')
          }
          if (!retryPut.ok) {
            throw new WebDavError(`上传单词本至 WebDAV 失败（HTTP ${retryPut.status}）。`)
          }
        } else if (putRes.status === 401 || putRes.status === 403) {
          throw new WebDavError('WebDAV 写入权限不足或认证失败（401/403）。')
        } else if (!putRes.ok) {
          throw new WebDavError(`上传单词本至 WebDAV 失败（HTTP ${putRes.status}）。`)
        }
        pushed = true
      }

      const syncedAt = Date.now()
      await saveWebDavSyncState({
        lastSyncedAt: syncedAt,
        lastError: undefined,
        added,
        updated,
        removed,
        total,
      })

      return { added, updated, removed, total, pushed, syncedAt }
    } catch (err) {
      const msg = err instanceof WebDavError ? err.message : (err instanceof Error ? err.message : String(err))
      const prev = await getWebDavSyncState()
      await saveWebDavSyncState({
        ...prev,
        lastError: msg,
      })
      if (err instanceof WebDavError) throw err
      throw new WebDavError(`WebDAV 同步失败：${msg}`)
    }
  })
}
