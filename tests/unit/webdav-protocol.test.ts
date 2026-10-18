import { readFileSync } from 'node:fs'
import { beforeEach, expect, it, vi } from 'vitest'
import { __resetStorage } from '../helpers/wxt-imports-stub'
import { effectiveCard, exportSyncLearning, markLearningSync, mergeLearningRecords, readLearning, readTombstones, saveLearning, updateLearning } from '../../lib/learning'
import { DEFAULT_SETTINGS } from '../../lib/types'
import { syncLearningWithWebDav, testWebDavConnection } from '../../lib/webdav'

const fixture = () => JSON.parse(readFileSync('tests/fixtures/webdav-v3.json', 'utf8'))
const config = { ...DEFAULT_SETTINGS.webdav, enabled: true, url: 'https://dav.example.test/dav' }
function advanceVector(record: { versionVector: Record<string, number> }, device = 'fixture-device') {
  record.versionVector[device] = (record.versionVector[device] ?? 0) + 1
}
beforeEach(() => { __resetStorage(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('preserves shared protocol identities, cleared translations and deletion across a round trip', async () => {
  expect((await mergeLearningRecords(JSON.stringify(fixture()))).added).toBe(2)
  const records = await readLearning()
  expect(records).toHaveLength(2)
  expect(effectiveCard(records.find(r => r.id === 'context-two')!).entry.contextTranslation).toBe('')
  expect((await readTombstones())[0].id).toBe('context-deleted')
  const payload = await exportSyncLearning()
  expect(JSON.parse(payload).records).toHaveLength(3)
  expect(await mergeLearningRecords(payload)).toMatchObject({ added: 0, updated: 0, removed: 0, needsPush: false })
})

it('updates the requested identity when two records have the same context', async () => {
  await mergeLearningRecords(JSON.stringify(fixture()))
  const second = (await readLearning()).find(r => r.id === 'context-two')!
  await saveLearning({ ...effectiveCard(second), updateExisting: true, edits: { definition: '只改第二条' } })
  const records = await readLearning()
  expect(records.find(r => r.id === 'context-two')!.edits!.definition).toBe('只改第二条')
  expect(records.find(r => r.id === 'context-one')!.edits!.definition).toBe('自定义河岸释义')
})

it('keeps both sides unchanged when same-revision edits conflict', async () => {
  await mergeLearningRecords(JSON.stringify(fixture()))
  const remote = fixture()
  remote.records[0].edits.definition = '远端独立编辑'
  remote.records[0].updatedAt++
  await expect(mergeLearningRecords(JSON.stringify(remote))).rejects.toThrow('相同因果版本')
  expect((await readLearning()).find(r => r.id === 'context-one')!.edits!.definition).toBe('自定义河岸释义')
})

it('rejects reusing one identity for another context', async () => {
  await mergeLearningRecords(JSON.stringify(fixture()))
  const remote = fixture()
  remote.records[0].card.sentence = 'A different context.'
  remote.records[0].revision++
  await expect(mergeLearningRecords(JSON.stringify(remote))).rejects.toThrow('不同语境')
})

it('rejects different edits made offline from the same ancestor', async () => {
  await mergeLearningRecords(JSON.stringify(fixture()))
  const remote = fixture()
  await updateLearning('context-one', { definition: '本地离线修改' })
  remote.records[0].edits.definition = '远端离线修改'
  remote.records[0].versionVector['remote-device'] = 1
  await expect(mergeLearningRecords(JSON.stringify(remote))).rejects.toThrow('并发修改')
  expect((await readLearning()).find(record => record.id === 'context-one')!.edits!.definition).toBe('本地离线修改')
})

it('merges identical concurrent snapshots by taking the component-wise maximum', async () => {
  await mergeLearningRecords(JSON.stringify(fixture()))
  const localBefore = (await readLearning()).find(record => record.id === 'context-one')!
  await updateLearning(localBefore.id, localBefore.edits!)
  const local = (await readLearning()).find(record => record.id === 'context-one')!
  const remote = fixture()
  remote.records[0].versionVector['remote-device'] = 1
  const merged = await mergeLearningRecords(JSON.stringify(remote))
  expect(merged.needsPush).toBe(true)
  const exported = JSON.parse(await exportSyncLearning()).records.find((record: { id: string }) => record.id === 'context-one')
  expect(exported.versionVector).toEqual({ ...local.versionVector, 'remote-device': 1 })
})

it('rejects malformed or duplicate remote records before applying any writes', async () => {
  const remote = fixture()
  remote.records.push({})
  await expect(mergeLearningRecords(JSON.stringify(remote))).rejects.toThrow('不完整')
  expect(await readLearning()).toHaveLength(0)
  const duplicate = fixture()
  duplicate.records.push(duplicate.records[0])
  await expect(mergeLearningRecords(JSON.stringify(duplicate))).rejects.toThrow('重复')
})

it('retains more than 2000 tombstones to protect devices that stayed offline', async () => {
  const remote = fixture()
  const tombstone = remote.records[2]
  remote.records = Array.from({ length: 2001 }, (_, i) => ({ ...tombstone, id: 'deleted-' + i }))
  await mergeLearningRecords(JSON.stringify(remote))
  expect(await readTombstones()).toHaveLength(2001)
  expect(JSON.parse(await exportSyncLearning()).records).toHaveLength(2001)
})

it('does not publish local Anki sync status to other devices', async () => {
  await mergeLearningRecords(JSON.stringify(fixture()))
  await markLearningSync('context-one')
  expect((await readLearning()).find(r => r.id === 'context-one')!.syncedAt).toBeDefined()
  const record = JSON.parse(await exportSyncLearning()).records.find((r: { id: string }) => r.id === 'context-one')
  expect(record).not.toHaveProperty('syncedAt')
  expect(record).not.toHaveProperty('syncError')
})

it.each([null, 'W/"weak"'])('does not overwrite an existing file without strong ETag: %s', async etag => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ format: 'word-catcher-learning', version: 3, records: [] }), { headers: etag ? { ETag: etag } : {} }))
  vi.stubGlobal('fetch', fetchMock)
  await expect(syncLearningWithWebDav(config, true)).rejects.toThrow('ETag')
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

it('sends If-Match and stops after a competing writer changes the remote file', async () => {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'GET') return new Response(JSON.stringify({ format: 'word-catcher-learning', version: 3, records: [] }), { headers: { ETag: '"version-1"' } })
    expect(new Headers(init?.headers).get('If-Match')).toBe('"version-1"')
    return new Response('', { status: 412 })
  })
  vi.stubGlobal('fetch', fetchMock)
  await expect(syncLearningWithWebDav(config, true)).rejects.toThrow('其他设备')
  expect(fetchMock).toHaveBeenCalledTimes(2)
})

it('uses create-only writes when the remote file does not exist', async () => {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'GET') return new Response('', { status: 404 })
    if (init?.method === 'PUT') {
      expect(new Headers(init.headers).get('If-None-Match')).toBe('*')
      return new Response('', { status: 201 })
    }
    return new Response('', { status: 207 })
  })
  vi.stubGlobal('fetch', fetchMock)
  expect((await syncLearningWithWebDav(config)).pushed).toBe(true)
})

it('does not replace an empty remote file with the local snapshot', async () => {
  const fetchMock = vi.fn(async () => new Response(''))
  vi.stubGlobal('fetch', fetchMock)
  await expect(syncLearningWithWebDav(config, true)).rejects.toThrow('为空')
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

it('reports failed remote directory creation', async () => {
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => new Response('', { status: init?.method === 'MKCOL' ? 500 : 404 })))
  await expect(testWebDavConnection(config)).rejects.toThrow('500')
})

it('restores a newer revision within the same millisecond and rejects the stale deletion', async () => {
  const remote = fixture()
  await mergeLearningRecords(JSON.stringify(remote))
  const stale = JSON.stringify(remote)
  const record = remote.records[2]
  record.updatedAt = record.deletedAt
  delete record.deletedAt
  record.revision++
  advanceVector(record)
  await mergeLearningRecords(JSON.stringify(remote))
  await mergeLearningRecords(stale)
  expect(await readLearning()).toHaveLength(3)
  expect(await readTombstones()).toHaveLength(0)
})
