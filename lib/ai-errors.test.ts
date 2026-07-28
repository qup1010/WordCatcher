import { describe, expect, it } from 'vitest'
import { buildSystemPrompt, friendlyMessage } from './ai'

describe('buildSystemPrompt', () => {
  it('必须包含 json 字样', () => {
    // DeepSeek 等服务在 response_format 为 json_object 时会校验提示词里有没有
    // json 这个词，没有就直接拒绝请求。删掉它只会在这些服务上炸，很难发现。
    expect(buildSystemPrompt('简体中文').toLowerCase()).toContain('json')
  })

  it('把释义语言带进提示词', () => {
    expect(buildSystemPrompt('日本語')).toContain('日本語')
  })
})

/**
 * 各家服务商的报错文案天差地别，用户看到原始英文报错基本不知道该改哪。
 * 这里锁住「什么错 → 让用户做什么」的映射。
 */
describe('friendlyMessage', () => {
  it('key 无效时指向设置页', () => {
    expect(friendlyMessage(new Error('401 Unauthorized'))).toContain('API key')
    expect(friendlyMessage(new Error('Invalid API key provided'))).toContain('API key')
  })

  it('余额不足时说的是额度而不是 key', () => {
    const msg = friendlyMessage(new Error('402 insufficient balance'))
    expect(msg).toContain('额度')
    expect(msg).not.toContain('API key')
  })

  it('限流时提示稍后重试', () => {
    expect(friendlyMessage(new Error('429 Too Many Requests'))).toContain('频繁')
  })

  it('模型不存在时指向模型名', () => {
    expect(friendlyMessage(new Error('404 model not found'))).toContain('模型名')
  })

  it('光是 404 而没提模型时，指向 Base URL 而不是模型名', () => {
    // 最常见的 404 其实是 Base URL 少写了 /v1，怪到模型头上会让人白折腾
    const msg = friendlyMessage(new Error('404 Not Found'))
    expect(msg).toContain('Base URL')
    expect(msg).not.toContain('模型名')
  })

  it('只是顺带提到 model 的错误不算模型名错误', () => {
    // 这个条件曾经写成 (404|not found|model) && model，等价于「只要含 model 就命中」，
    // 于是一切提到 model 的报错都被翻译成「模型名不对」
    const msg = friendlyMessage(new Error('This model\'s maximum context length is 8192 tokens'))
    expect(msg).not.toContain('模型名不对')
  })

  it('超时单独成一类，不和「连不上」混为一谈', () => {
    const msg = friendlyMessage(new DOMException('timeout', 'TimeoutError'))
    expect(msg).toContain('没有响应')
    expect(msg).not.toContain('Base URL')
  })

  it('网络不通时指向 Base URL', () => {
    expect(friendlyMessage(new Error('fetch failed'))).toContain('Base URL')
  })

  it('认不出来的错误原样透传，不吞掉线索', () => {
    expect(friendlyMessage(new Error('something very unusual'))).toBe('something very unusual')
  })

  it('非 Error 对象也能处理', () => {
    expect(friendlyMessage('plain string failure')).toBe('plain string failure')
  })
})
