import { beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetStorage } from '../helpers/wxt-imports-stub'
import { saveLearning, readLearning, updateLearning, exportSyncLearning } from '../../lib/learning'
import { DEFAULT_SETTINGS, type CapturedCard } from '../../lib/types'
import {
  buildBasicAuth, getWebDavSyncState, resolveWebDavConflict, webDavStatusLabel,
  resolveWebDavTarget,
  syncLearningWithWebDav,
  testWebDavConnection,
} from '../../lib/webdav'

const sampleCard = (sentence: string, definition: string): CapturedCard => ({
  entry: {
    word: 'bank',
    reading: 'bæŋk',
    partOfSpeech: 'n.',
    definition,
    contextTranslation: '译文',
  },
  selection: 'bank',
  sentence,
  sentenceOffset: sentence.indexOf('bank'),
  pageUrl: 'https://example.test',
  pageTitle: 'Example',
  createdAt: 1000,
})

beforeEach(() => {
  __resetStorage()
  vi.restoreAllMocks()
})

describe('webdav helpers and sync', () => {
  it('resolves base url and remote file path with parent directories', () => {
    const target = resolveWebDavTarget('https://dav.example.com/dav/', '/WordCatcher/sub/vocab.json')
    expect(target.fileUrl).toBe('https://dav.example.com/dav/WordCatcher/sub/vocab.json')
    expect(target.directoryUrls).toEqual([
      'https://dav.example.com/dav/WordCatcher',
      'https://dav.example.com/dav/WordCatcher/sub',
    ])
  })

  it('encodes UTF-8 basic auth credentials', () => {
    const header = buildBasicAuth('user@example.com', 'p@ss密码')
    expect(header.startsWith('Basic ')).toBe(true)
  })

  it('tests connection and creates directory when remote file is 404', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PROPFIND' && url.endsWith('.json')) {
        return new Response('', { status: 404 })
      }
      if (init?.method === 'PROPFIND' && url.endsWith('WordCatcher/')) {
        return new Response('', { status: 404 })
      }
      if (init?.method === 'MKCOL') {
        return new Response('', { status: 201 })
      }
      return new Response('', { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const res = await testWebDavConnection({
      ...DEFAULT_SETTINGS.webdav,
      enabled: true,
      url: 'https://dav.example.com/dav',
      username: 'u',
      password: 'p',
    })
    expect(res.exists).toBe(false)
    expect(res.fileUrl).toBe('https://dav.example.com/dav/WordCatcher/vocabulary-sync.json')
  })

  it('pulls remote records, merges with local, and pushes merged result back', async () => {
    await saveLearning(sampleCard('Local sentence with bank.', '本地河岸'))

    let uploadedBody = ''
    const remoteJson = JSON.stringify({
      format: 'word-catcher-learning',
      version: 3,
      exportedAt: new Date().toISOString(),
      records: [
        {
          id: 'remote-1',
          revision: 1,
          versionVector: { 'remote-device': 1 },
          savedAt: 2000,
          updatedAt: 2000,
          card: sampleCard('Remote sentence with bank.', '远端银行'),
        },
      ],
    })

    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (!init?.method || init.method === 'GET') {
        return new Response(remoteJson, { status: 200, headers: { ETag: '"version-1"' } })
      }
      if (init.method === 'PUT') {
        uploadedBody = String(init.body ?? '')
        return new Response(null, { status: 204 })
      }
      return new Response('', { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await syncLearningWithWebDav({
      ...DEFAULT_SETTINGS.webdav,
      enabled: true,
      url: 'https://dav.example.com/dav',
      username: 'u',
      password: 'p',
    })

    expect(result.added).toBe(1)
    expect(result.total).toBe(2)
    expect(result.pushed).toBe(true)
    expect((await readLearning())).toHaveLength(2)
    expect(JSON.parse(uploadedBody).records).toHaveLength(2)
  })
})

const config = { ...DEFAULT_SETTINGS.webdav, enabled: true, url: 'https://dav.example.test/dav' }
async function conflictingServer() {
  const local = await saveLearning(sampleCard('The bank is open.', '本地'))
  const document = JSON.parse(await exportSyncLearning())
  document.records[0].card.entry.definition = '云端'
  let remote = JSON.stringify(document)
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') { remote = String(init.body); return new Response(null, { status: 204 }) }
    return new Response(remote, { status: 200, headers: { ETag: '"one"' } })
  })
  vi.stubGlobal('fetch', fetchMock)
  await expect(syncLearningWithWebDav(config)).rejects.toThrow()
  const state = await getWebDavSyncState(config)
  expect(state.conflict).toBeDefined()
  return { local, state, fetchMock, changeRemote: () => { const next = JSON.parse(remote); next.records[0].edits = { note: 'new edit' }; remote = JSON.stringify(next) } }
}
it.each([true, false])('resolves a verified conflict and publishes a dominating vector (local=%s)', async keepLocal => {
  const { state } = await conflictingServer()
  await resolveWebDavConflict(config, state.conflict!.token, keepLocal)
  expect((await readLearning())[0].card.entry.definition).toBe(keepLocal ? '本地' : '云端')
  const after = await getWebDavSyncState(config)
  expect(after.conflict).toBeUndefined()
  expect(webDavStatusLabel(true, after)).toBe('已同步')
})
it('rejects a conflict choice after a new local edit without uploading', async () => {
  const { local, state, fetchMock } = await conflictingServer()
  await updateLearning(local.id, { definition: '本地', note: 'new local edit' })
  await expect(resolveWebDavConflict(config, state.conflict!.token, false)).rejects.toThrow('本地记录')
  expect((await readLearning())[0].edits?.note).toBe('new local edit')
  expect(fetchMock.mock.calls.some(([,init]) => init?.method === 'PUT')).toBe(false)
})
it('rejects a conflict choice after a remote edit without changing local content', async () => {
  const { state, changeRemote, fetchMock } = await conflictingServer()
  changeRemote()
  await expect(resolveWebDavConflict(config, state.conflict!.token, true)).rejects.toThrow('云端记录')
  expect((await readLearning())[0].card.entry.definition).toBe('本地')
  expect(fetchMock.mock.calls.some(([,init]) => init?.method === 'PUT')).toBe(false)
})
it('keeps edits made during upload pending and isolates status by sync target', async () => {
  const local = await saveLearning(sampleCard('The bank is open.', 'original'))
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'GET') return new Response('', { status: 404 })
    if (init?.method === 'PUT') await updateLearning(local.id, { definition: 'original', note: 'during upload' })
    return new Response(null, { status: 200 })
  }))
  await syncLearningWithWebDav(config)
  const state = await getWebDavSyncState(config)
  expect(state.hasPendingChanges).toBe(true)
  expect(webDavStatusLabel(true, state)).toBe('待同步')
  expect((await getWebDavSyncState({ ...config, url: 'https://other.test' })).lastSyncedAt).toBeUndefined()
})
