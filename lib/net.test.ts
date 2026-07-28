import { describe, expect, it } from 'vitest'
import { TIMEOUT, isTimeout, timeout } from './net'

/** 造一个和 AbortSignal.timeout 实际抛出的一模一样的错误 */
function timeoutError(): Error {
  return new DOMException('The operation was aborted due to timeout', 'TimeoutError')
}

describe('timeout', () => {
  it('返回一个还没触发的 signal', () => {
    const signal = timeout(TIMEOUT.anki)
    expect(signal.aborted).toBe(false)
  })

  it('到点后 signal 变成 aborted', async () => {
    const signal = timeout(1)
    await new Promise(r => setTimeout(r, 20))
    expect(signal.aborted).toBe(true)
  })
})

/**
 * 超时和「连不上」要给用户完全不同的建议，判别错了就会把人引向错误的排查方向，
 * 所以这里把各种可能的错误形态都锁住。
 */
describe('isTimeout', () => {
  it('认得 AbortSignal.timeout 抛出的 TimeoutError', () => {
    expect(isTimeout(timeoutError())).toBe(true)
  })

  it('认得手动 abort 的 AbortError', () => {
    expect(isTimeout(new DOMException('aborted', 'AbortError'))).toBe(true)
  })

  it('认得被上层库重新包装后只剩文案的情况', () => {
    // AI SDK 会把底层错误重新抛一遍，name 就丢了，只能靠文案认
    expect(isTimeout(new Error('Request timed out'))).toBe(true)
    expect(isTimeout(new Error('The operation was aborted'))).toBe(true)
  })

  it('不把普通网络错误误判成超时', () => {
    expect(isTimeout(new Error('fetch failed'))).toBe(false)
    expect(isTimeout(new Error('ECONNREFUSED'))).toBe(false)
  })

  it('不被含 timeout 字样的无关文案骗到', () => {
    // 「设置里的超时时间」这类描述里也有 timeout，但它不是一次超时失败
    expect(isTimeout(new Error('invalid timeoutMs option'))).toBe(false)
  })

  it('非 Error 一律不算超时', () => {
    expect(isTimeout('timed out')).toBe(false)
    expect(isTimeout(null)).toBe(false)
  })
})
