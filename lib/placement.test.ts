import { describe, expect, it } from 'vitest'
import { GAP, PANEL_MAX_HEIGHT, PANEL_MIN_HEIGHT, place } from './placement'

const VIEWPORT = { width: 1280, height: 800 }
const PANEL = { width: 372, height: 300 }

/** 选区矩形：只关心左边界和上下沿 */
function rect(left: number, top: number, height = 20) {
  return { left, top, bottom: top + height }
}

describe('place', () => {
  it('默认贴在选区下方', () => {
    const p = place(rect(100, 200), PANEL, VIEWPORT)
    expect(p.left).toBe(100)
    expect(p.top).toBe(220 + GAP)
  })

  it('下方放不下时翻到选区上方', () => {
    // 选区在视口底部，下方只剩 30px
    const p = place(rect(100, 750), PANEL, VIEWPORT)
    expect(p.top).toBe(750 - PANEL.height - GAP)
  })

  it('贴着右边划词时把面板夹回视口内', () => {
    const p = place(rect(1200, 200), PANEL, VIEWPORT)
    expect(p.left).toBe(VIEWPORT.width - PANEL.width - GAP)
    expect(p.left + PANEL.width).toBeLessThanOrEqual(VIEWPORT.width)
  })

  it('贴着左边划词时不会跑到负数', () => {
    expect(place(rect(-40, 200), PANEL, VIEWPORT).left).toBe(GAP)
  })

  it('窄视口下宁可贴左边也不整块移出屏幕', () => {
    const p = place(rect(10, 200), PANEL, { width: 320, height: 800 })
    expect(p.left).toBe(GAP)
  })

  /**
   * 这条是 place 存在的意义：position:fixed 的面板一旦溢出视口，
   * 溢出的部分既滚不到也点不着——存卡按钮就在最底下。
   */
  it('上下都塞不下时把高度压进可用空间，而不是溢出视口', () => {
    const shortViewport = { width: 1280, height: 400 }
    const tall = { width: 372, height: 900 }
    const p = place(rect(100, 180), tall, shortViewport)

    expect(p.maxHeight).toBeLessThanOrEqual(shortViewport.height)
    expect(p.top + p.maxHeight).toBeLessThanOrEqual(shortViewport.height)
  })

  it('选区几乎占满视口时保底给到最小高度', () => {
    // 上下都只剩几像素，此时挤成一条缝毫无意义，宁可溢出一点
    const p = place(rect(100, 10, 380), PANEL, { width: 1280, height: 400 })
    expect(p.maxHeight).toBe(PANEL_MIN_HEIGHT)
  })

  it('空间充足时不超过面板高度上限', () => {
    expect(place(rect(100, 50), PANEL, VIEWPORT).maxHeight).toBe(PANEL_MAX_HEIGHT)
  })

  it('选区上下空间相当时优先放下方（阅读方向一致）', () => {
    const p = place(rect(100, 390, 20), { width: 372, height: 500 }, VIEWPORT)
    expect(p.top).toBeGreaterThan(390)
  })
})
