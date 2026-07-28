/**
 * 网络请求的超时约定。
 *
 * 每一处 fetch 都必须带 signal：没有超时的话，对端吊着不返回时
 * Promise 永远不 settle，UI 会一直停在「保存中…」，用户只能刷新页面。
 * 浏览器自己的 TCP 超时是分钟级的，指望不上。
 */

export const TIMEOUT = {
  /** 本地 AnkiConnect，正常是毫秒级；超过这个数基本就是 Anki 卡在某个模态框上了 */
  anki: 8_000,
  /** 机器翻译，定位就是「即时」，慢了不如直接报错让用户走 AI */
  mt: 10_000,
  /** 拉模型列表这类元信息请求 */
  aiMeta: 20_000,
  /** AI 生成：慢模型 + 长句子确实可能要几十秒，给宽一点 */
  aiGenerate: 60_000,
} as const

export function timeout(ms: number): AbortSignal {
  return AbortSignal.timeout(ms)
}

/**
 * 是不是超时/中断导致的失败。
 *
 * 刻意用鸭子类型而不是 `instanceof Error`：`AbortSignal.timeout` 抛的是
 * DOMException，它在浏览器里继承 Error，在 jsdom 里却不继承——用 instanceof
 * 判会导致「测试通过但线上行为不同」或者反过来。只看 name 和 message 更稳。
 *
 * 各层库（比如 AI SDK）可能把原始错误重新包一层，name 就丢了，所以文案也认一下。
 */
export function isTimeout(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false

  const { name, message } = err as { name?: unknown, message?: unknown }
  if (name === 'TimeoutError' || name === 'AbortError') return true
  return typeof message === 'string' && /\b(timed? ?out|aborted)\b/i.test(message)
}
