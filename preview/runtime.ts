import { contextKey, saveLearning, readLearning, updateLearning, exportLearning, markLearningSync } from '../lib/learning'
import { formatQuickDictResult } from '../lib/open-dict/db'
/** 仅供预览：服务全部使用内存示例数据，禁止触达真实账号、Anki 或设置。 */
import { DEFAULT_SETTINGS, type HistoryItem } from '../lib/types'
const scenario = new URLSearchParams(location.search).get('scenario')
const settings = structuredClone(DEFAULT_SETTINGS)
settings.ai.profiles[0].apiKey = 'preview-only'
let store: Record<string, unknown> = { 'local:settings': settings }
const watchers = new Map<string, Set<(value: unknown) => void>>()
let history: HistoryItem[] = [
  { id: 'demo-1', word: 'convenience', definition: '方便；便利。也指让生活更省事的物品或设施。', sentence: 'The convenience of a familiar place can make a difficult day feel a little easier.', reading: 'kənˈviːniəns', timestamp: Date.now() - 120000, savedToAnki: false, source: 'dict' },
  { id: 'demo-2', word: 'a blessing in disguise', definition: '因祸得福；起初看似不幸，后来却带来益处。', sentence: '', reading: '', timestamp: Date.now() - 3600000, savedToAnki: true, source: 'ai' },
]
let failedSave = false
export const storage = {
  async getItem(key: string) { if (scenario === 'load-error') throw new Error('示例：读取失败'); return store[key] ?? null },
  async setItem(key: string, value: unknown) {
    if (scenario === 'save-error' && !failedSave) { failedSave = true; throw new Error('示例：保存失败') }
    store[key] = value; watchers.get(key)?.forEach(cb => cb(value))
  },
  async removeItem(key: string) { delete store[key] },
  watch(key: string, cb: (value: unknown) => void) { const set = watchers.get(key) ?? new Set(); set.add(cb); watchers.set(key, set); return () => { set.delete(cb) } },
}
const baseEntry = { inputKind: 'word' as const, expression: 'convenience', keyExplanation: '这里指熟悉环境带来的便利，不是具体的便利设施。', usageNote: '常见搭配：for convenience、at your convenience。', example: 'We chose it for convenience.', exampleTranslation: '我们选择它是为了方便。', generation: { model: 'preview-only', promptVersion: 'learning-v1', generatedAt: new Date().toISOString() }, word: 'convenience', reading: 'kənˈviːniəns', partOfSpeech: 'n.', definition: '方便；便利；让生活更省事的物品或设施。', contextTranslation: '熟悉的地方带来的便利，能让艰难的一天稍微轻松一点。', memoryHook: '想象一条少绕路的路：路更省事是便利，帮助你省事的东西是便利设施。' }
const entry = scenario === 'sentence' ? { ...baseEntry, inputKind: 'sentence' as const, word: 'The convenience of a familiar place can make a difficult day feel a little easier.', definition: '熟悉的地方带来的便利，能让艰难的一天稍微轻松一点。', reading: '', partOfSpeech: '', expression: '', keyExplanation: '', usageNote: '', example: '', exampleTranslation: '', memoryHook: '' } : baseEntry
if (scenario === 'learning') history.unshift({
  id: 'learning-preview', word: entry.word, selection: 'convenience', sentenceOffset: 4,
  entry, definition: entry.definition, sentence: 'The convenience of a familiar place can make a difficult day feel a little easier.',
  timestamp: Date.now(), source: 'ai', pageUrl: 'https://example.test/article', pageTitle: 'Preview article',
})
const listeners = new Set<(value: unknown) => void>()
export const browser = {
  runtime: {
    getManifest: () => ({ version: '0.1.4' }),
    openOptionsPage: () => { location.href = '/preview/interactive.html?view=options' },
    onMessage: { addListener(cb: (v: unknown) => void) { listeners.add(cb) }, removeListener(cb: (v: unknown) => void) { listeners.delete(cb) } },
    async sendMessage(req: { type: string, payload?: any }) {
      const ok = (data: unknown) => ({ ok: true, data })
      if (req.type === 'history-list') return scenario === 'history-error' ? { ok: false, error: '示例：历史记录读取失败' } : ok(history)
      if (req.type === 'history-clear') { history = []; return ok([]) }
      if (req.type === 'history-remove') { history = history.filter(h => h.id !== req.payload.id); return ok(history) }
      if (req.type === 'check-anki') return scenario === 'offline' ? { ok: false, error: 'Anki 未连接' } : ok({ version: 6 })
      if (req.type === 'dict-status') return ok({ status: 'ready', entryCount: 120345, updatedAt: Date.now() })
      if (req.type === 'pending-count') return ok({ count: scenario === 'offline' ? 3 : 0 })
      if (req.type === 'pending-list') return ok({ cards: [] })
      if (req.type === 'cache-stats') return ok({ size: 8 })
      if (req.type === 'save-card') { const record = await saveLearning(req.payload); return ok({ noteId: null, queued: scenario === 'offline', pending: 3, recordId: record.id }) }
      if (req.type === 'library-list') return ok(await readLearning())
      if (req.type === 'library-export') return ok(await exportLearning())
      if (req.type === 'library-update') return ok(await updateLearning(req.payload.id, req.payload.edits))
      if (req.type === 'library-sync') { await markLearningSync(req.payload.id); return ok({ noteId: 1, queued: false }) }
      if (req.type === 'check-duplicate') return ok({ exists: req.payload.context
        ? (await readLearning()).some(record => contextKey(record.card) === contextKey(req.payload.context))
        : false })
      if (req.type === 'quick-translate') {
        await new Promise(resolve => setTimeout(resolve, 500))
        if (scenario === 'dictionary') return ok({ mode: 'dict', dict: formatQuickDictResult({
          headword: 'convenience', pronunciations: { us: 'kənˈviːniəns' }, memory_hook: entry.memoryHook,
          pos_groups: [
            { pos: 'name', meanings: [{ sense_id: 'name', priority: 'rare', short_gloss: '专名用法' }] },
            { pos: 'noun', meanings: [
              { sense_id: 'core1', priority: 'core', short_gloss: '方便；便利', learner_explanation: '指某件事省去麻烦，让生活或办事更容易。', examples: [
                { text: 'We chose it for convenience.', translation: '我们选择它是为了方便。' },
                { text: 'The shop is open for your convenience.', translation: '商店营业是为了方便您。' },
              ], usage_note: '常见搭配：for convenience、at your convenience。' },
              { sense_id: 'core2', priority: 'common', short_gloss: '便利设施', learner_explanation: '帮助人们节省时间或精力的设施。' },
              { sense_id: 'rare', priority: 'rare', short_gloss: '公共厕所（英式用法）' },
            ] },
          ],
        }) })
        return ok({ mode: 'mt', translation: entry.definition, provider: 'microsoft', sourceLang: 'en' })
      }
      if (req.type === 'open-sidepanel') { location.href = '/preview/interactive.html?view=sidepanel'; return ok(null) }
      return { ok: false, error: '此交互预览仅展示界面；该操作需要在真实插件中验证。' }
    },
    connect() {
      const onMessage = new Set<(m: unknown) => void>()
      const onDisconnect = new Set<() => void>()
      let timer: ReturnType<typeof setTimeout> | undefined
      return {
        onMessage: { addListener(cb: (m: unknown) => void) { onMessage.add(cb) } },
        onDisconnect: { addListener(cb: () => void) { onDisconnect.add(cb) } },
        postMessage() {
          timer = setTimeout(() => {
            onMessage.forEach(cb => cb({ type: 'partial', entry: { ...entry, definition: '方便；便利；' } }))
            timer = setTimeout(() => onMessage.forEach(cb => cb({ type: 'done', entry })), 1200)
          }, 300)
        },
        disconnect() { clearTimeout(timer) },
      }
    },
  },
}
