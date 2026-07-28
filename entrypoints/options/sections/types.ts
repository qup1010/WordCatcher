import type { Settings } from '@/lib/types'

/**
 * 所有分区共用的接口。
 *
 * 分区拿到完整的 settings 和一个「换成这份新的」回调，各自负责生成不可变的新对象。
 * 不传细粒度的 setter：分区之间本来就互不相关，多一个字段就多一个 prop 的话，
 * 拆文件带来的收益会被 prop 传递的噪音吃掉。
 */
export interface SectionProps {
  s: Settings
  onChange: (next: Settings) => void
  /** 发测试请求前先把页面上正在填的值落盘，否则 background 读到的还是旧配置 */
  flush: () => Promise<void>
}

export type Status =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'ok', text: string }
  | { kind: 'err', text: string }
