/**
 * Open Dictionary 官方契约结构定义 (distribution_entry_v5 兼容)
 */

export interface DictExample {
  text: string
  translation?: string
}

export interface DictMeaning {
  sense_id: string
  /** 义项优先级：core(核心) / common(常用) / rare(生僻) */
  priority: 'core' | 'common' | 'rare' | string
  short_gloss: string
  learner_explanation?: string
  examples?: DictExample[]
}

export interface DictPosGroup {
  pos: string
  summary?: string
  meanings: DictMeaning[]
}

export interface DictPronunciations {
  us?: string
  uk?: string
  ipa?: string
}

export interface OpenDictEntry {
  headword: string
  memory_hook?: string
  pos_groups: DictPosGroup[]
  pronunciations?: DictPronunciations
  forms?: string[]
}

export type DictInstallStatus = 'uninstalled' | 'downloading' | 'ready' | 'error'

export interface DictMeta {
  status: DictInstallStatus
  entryCount: number
  updatedAt: number
  version?: string
  sizeBytes?: number
  errorMessage?: string
}

export interface QuickDictCoreGroup {
  pos: string
  meanings: string[]
}

export interface QuickDictResult {
  headword: string
  reading: string
  memoryHook?: string
  primaryPos?: string
  coreMeanings: string[]
  coreGroups: QuickDictCoreGroup[]
  allPosGroups: DictPosGroup[]
}
