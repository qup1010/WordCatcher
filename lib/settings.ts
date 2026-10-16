import { storage } from '#imports'
import {
  type AiProfile,
  DEFAULT_AI_PROFILE,
  DEFAULT_SETTINGS,
  type Settings,
  aiProfileSchema,
  settingsSchema,
} from './types'

const SETTINGS_KEY = 'local:settings' as const

/**
 * ai 段单独处理：既支持新的多配置结构，也兼容旧版的单配置
 * （{ baseURL, apiKey, model } 直接挂在 ai 下），旧数据自动迁移成第一套配置。
 */
function normalizeAi(raw: unknown): Settings['ai'] {
  if (!raw || typeof raw !== 'object') return DEFAULT_SETTINGS.ai
  const r = raw as Record<string, unknown>

  if (Array.isArray(r.profiles)) {
    const profiles = r.profiles
      .map((p) => {
        const obj = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>
        return aiProfileSchema.safeParse({
          ...DEFAULT_AI_PROFILE,
          ...obj,
          id: obj.id ?? obj.Id ?? DEFAULT_AI_PROFILE.id,
          name: obj.name ?? obj.Name ?? DEFAULT_AI_PROFILE.name,
          baseURL: obj.baseURL ?? obj.BaseUrl ?? DEFAULT_AI_PROFILE.baseURL,
          apiKey: obj.apiKey ?? obj.ApiKey ?? DEFAULT_AI_PROFILE.apiKey,
          model: obj.model ?? obj.Model ?? DEFAULT_AI_PROFILE.model,
        })
      })
      .filter(p => p.success)
      .map(p => p.data)
    if (profiles.length === 0) return DEFAULT_SETTINGS.ai

    const activeId = profiles.some(p => p.id === r.activeId)
      ? (r.activeId as string)
      : profiles[0].id
    return { profiles, activeId }
  }

  // 旧版单配置迁移
  if ('baseURL' in r || 'apiKey' in r || 'model' in r) {
    const legacy = aiProfileSchema.safeParse({ ...DEFAULT_AI_PROFILE, ...r, id: 'default', name: '默认' })
    if (legacy.success) return { profiles: [legacy.data], activeId: 'default' }
  }

  return DEFAULT_SETTINGS.ai
}

/**
 * 逐段合并而不是整体覆盖，这样以后给 schema 加字段时，
 * 老用户已存的配置不会因为缺字段而被整个丢弃。
 */
export function normalizeSettings(raw: unknown): Settings {
  if (!raw || typeof raw !== 'object') return DEFAULT_SETTINGS

  const r = raw as Record<string, unknown>
  const section = <K extends 'anki' | 'desktopBridge' | 'tts' | 'mt' | 'dict'>(key: K) => ({
    ...(DEFAULT_SETTINGS[key] as object),
    ...((r[key] as object | undefined) ?? {}),
  })

  // 兼容从 Windows 桌面端导出的 PascalCase 配置字段
  const desktopAnki = (r.Anki && typeof r.Anki === 'object' ? r.Anki : null) as Record<string, unknown> | null
  const ankiSection = {
    ...section('anki'),
    ...(desktopAnki
      ? {
          ...(typeof desktopAnki.Enabled === 'boolean' ? { enabled: desktopAnki.Enabled } : {}),
          url: desktopAnki.Url ?? DEFAULT_SETTINGS.anki.url,
          deckName: desktopAnki.DeckName ?? DEFAULT_SETTINGS.anki.deckName,
          noteTypeName: desktopAnki.NoteTypeName ?? DEFAULT_SETTINGS.anki.noteTypeName,
          clozeContext: desktopAnki.ClozeContext ?? DEFAULT_SETTINGS.anki.clozeContext,
          ttsLang: desktopAnki.TtsLang ?? DEFAULT_SETTINGS.anki.ttsLang,
        }
      : {}),
  }

  const aiSource = r.ai ?? (Array.isArray(r.TranslationProfiles)
    ? {
        profiles: r.TranslationProfiles,
        activeId: r.ActiveTranslationProfileId ?? 'default',
      }
    : undefined)

  const merged = {
    ai: normalizeAi(aiSource),
    dict: section('dict'),
    anki: ankiSection,
    desktopBridge: section('desktopBridge'),
    tts: section('tts'),
    mt: section('mt'),
    explainLanguage: r.explainLanguage ?? r.ExplainLanguage ?? DEFAULT_SETTINGS.explainLanguage,
    triggerMode: r.triggerMode ?? DEFAULT_SETTINGS.triggerMode,
    doubleClickLookup: typeof r.doubleClickLookup === 'boolean' ? r.doubleClickLookup : DEFAULT_SETTINGS.doubleClickLookup,
    modifierKey: ['none', 'alt', 'ctrl', 'shift', 'meta'].includes(r.modifierKey as string)
      ? r.modifierKey
      : DEFAULT_SETTINGS.modifierKey,
    blacklist: Array.isArray(r.blacklist) ? r.blacklist : DEFAULT_SETTINGS.blacklist,
  }

  const parsed = settingsSchema.safeParse(merged)
  return parsed.success ? parsed.data : DEFAULT_SETTINGS
}

/** 当前生效的 AI 配置；activeId 失效时退回第一套 */
export function activeAiProfile(s: Settings): AiProfile {
  return s.ai.profiles.find(p => p.id === s.ai.activeId) ?? s.ai.profiles[0]
}

export async function getSettings(): Promise<Settings> {
  return normalizeSettings(await storage.getItem<unknown>(SETTINGS_KEY))
}

export async function saveSettings(next: Settings): Promise<void> {
  await storage.setItem(SETTINGS_KEY, settingsSchema.parse(next))
}

export function watchSettings(cb: (s: Settings) => void): () => void {
  return storage.watch<unknown>(SETTINGS_KEY, raw => cb(normalizeSettings(raw)))
}

/** 配置是否已经够用了——缺 key 时 UI 要引导用户去配置页 */
export function isAiConfigured(s: Settings): boolean {
  const p = activeAiProfile(s)
  return p.apiKey.trim().length > 0 && p.model.trim().length > 0
}
