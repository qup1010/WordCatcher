import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { Output, generateText } from 'ai'
import { activeAiProfile } from './settings'
import { type Settings, type WordEntry, wordEntrySchema } from './types'

export function buildSystemPrompt(explainLanguage: string): string {
  return `你是一个为语言学习者服务的词典助手。用户正在网页上阅读，划选了一个词或短语，你要**结合它所在的这句话**给出解释。

要求：
- definition 只解释这个词在**当前这句话语境下**的含义，不要罗列词典里的所有义项。这是你和普通词典最大的区别，务必做到。
- word 要还原成词典原形：动词还原时态与人称、名词还原单数、比较级还原原级。如果划选的是固定搭配或短语，就保留短语整体。
- reading 用国际音标（IPA），不要带首尾斜杠。如果是日语则用假名，中文用拼音。无法确定时返回空字符串。
- partOfSpeech 用简写，例如 n. / v. / adj. / adv. / prep. / phr.
- contextTranslation 是整句话的完整翻译，不是只翻译划选的词。
- definition 和 contextTranslation 都用${explainLanguage}书写。其余字段保持原语言。

以 JSON 对象返回上述字段。`
  // 末句的 "JSON" 是必需的：DeepSeek 等服务在 response_format 为 json_object 时，
  // 会强制要求提示词里出现 json 字样，否则直接拒绝请求。
}

export class AiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AiError'
  }
}

/** 把各家服务商五花八门的报错翻译成用户能照着做的一句话 */
export function friendlyMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)

  if (/401|unauthorized|invalid.*api.?key/i.test(raw)) {
    return 'API key 无效或已过期，请到设置页检查。'
  }
  if (/402|quota|insufficient|balance/i.test(raw)) {
    return '账户额度不足，请检查你的 API 余额。'
  }
  if (/404|not found|model/i.test(raw) && /model/i.test(raw)) {
    return '模型名不对，或该 key 没有这个模型的权限。请到设置页检查模型名。'
  }
  if (/429|rate.?limit/i.test(raw)) {
    return '请求太频繁，被限流了，稍等一下再试。'
  }
  if (/fetch|network|ENOTFOUND|ECONNREFUSED/i.test(raw)) {
    return '连不上 AI 接口，请检查 Base URL 和网络。'
  }
  return raw
}

/** 从 OpenAI 兼容端点拉取可用模型列表（GET /models） */
export async function listModels(settings: Settings): Promise<string[]> {
  const profile = activeAiProfile(settings)
  // 粘贴时很容易带上首尾空白，用之前统一清掉
  const base = profile.baseURL.trim().replace(/\/+$/, '')
  const headers: Record<string, string> = {}
  if (profile.apiKey.trim()) headers.Authorization = `Bearer ${profile.apiKey.trim()}`

  let res: Response
  try {
    res = await fetch(`${base}/models`, { headers })
  } catch {
    throw new AiError('连不上 AI 接口，请检查 Base URL 和网络。')
  }
  if (!res.ok) throw new AiError(friendlyMessage(new Error(`HTTP ${res.status}`)))

  const data = (await res.json()) as { data?: Array<{ id?: string }> }
  const ids = (data.data ?? [])
    .map(m => m.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)

  if (ids.length === 0) {
    throw new AiError('端点没有返回模型列表，请手动填写模型名。')
  }
  return [...new Set(ids)].sort()
}

function buildProvider(settings: Settings) {
  const profile = activeAiProfile(settings)
  return createOpenAICompatible({
    name: 'word-catcher',
    baseURL: profile.baseURL.trim().replace(/\/+$/, ''),
    apiKey: profile.apiKey.trim(),
  })
}

/**
 * 连通性测试：只验证能连上、key 有效、模型存在。
 *
 * 刻意不走结构化输出——那是划词功能才需要的能力，
 * 有些端点或小模型不支持，会让一个其实可用的配置测出失败。
 */
export async function testConnection(settings: Settings): Promise<string> {
  const profile = activeAiProfile(settings)

  try {
    const { text } = await generateText({
      model: buildProvider(settings)(profile.model.trim()),
      // 用一个最小的翻译任务当探针：既验证连通，又能顺带看出模型能不能用
      prompt: `把英文单词 "devastated" 翻译成${settings.explainLanguage}，只回答译文本身。`,
      maxOutputTokens: 64,
    })
    return text.trim()
  } catch (err) {
    throw new AiError(friendlyMessage(err))
  }
}

export async function generateEntry(params: {
  selection: string
  sentence: string
  settings: Settings
}): Promise<WordEntry> {
  const { selection, sentence, settings } = params
  const profile = activeAiProfile(settings)

  try {
    const { output } = await generateText({
      model: buildProvider(settings)(profile.model.trim()),
      output: Output.object({ schema: wordEntrySchema }),
      system: buildSystemPrompt(settings.explainLanguage),
      prompt: `句子：${sentence}\n\n划选的词：${selection}`,
      temperature: 0.2,
    })
    return output
  } catch (err) {
    throw new AiError(friendlyMessage(err))
  }
}
