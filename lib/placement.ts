/**
 * 浮层定位：给一个选区矩形，算出面板该放在哪、最高能有多高。
 *
 * 抽成纯函数是为了能测——这里的边界条件（贴着视口右边划词、
 * 在页面最底部划词、矮视口 + 长句子）全都很容易在真实页面上踩到，
 * 但手动复现一次要翻半天页面。
 */

/** 面板与选区、与视口边缘的间距 */
export const GAP = 8
/** 面板最高多少，超过就自己滚 */
export const PANEL_MAX_HEIGHT = 460
/** 视口太矮时也得给面板留出这么多，否则挤成一条缝还不如让它溢出 */
export const PANEL_MIN_HEIGHT = 160

/** place() 只需要矩形的这几条边，测试里不必伪造完整 DOMRect */
export interface AnchorRect {
  left: number
  top: number
  bottom: number
}

export interface Viewport {
  width: number
  height: number
}

export interface Placement {
  left: number
  top: number
  /** 交给面板的高度上限：视口装不下时让它内部滚，而不是溢出到看不见的地方 */
  maxHeight: number
}

/** 面板放在选区下方，放不下就翻到上方；左右都夹在视口内 */
export function place(
  rect: AnchorRect,
  size: { width: number, height: number },
  viewport: Viewport,
): Placement {
  let left = rect.left
  if (left + size.width > viewport.width - GAP) left = viewport.width - size.width - GAP
  if (left < GAP) left = GAP

  // 各留一个 GAP 给视口边缘，算出来的就是面板真正能用的高度
  const below = viewport.height - rect.bottom - GAP * 2
  const above = rect.top - GAP * 2
  const goesBelow = size.height <= below || below >= above

  const top = goesBelow
    ? rect.bottom + GAP
    : Math.max(GAP, rect.top - size.height - GAP)

  // 上下都塞不下时（长句子 + 矮视口）必须夹住：position:fixed 溢出视口的部分
  // 既滚不到也点不着，用户会以为面板坏了
  const room = Math.max(goesBelow ? below : above, PANEL_MIN_HEIGHT)

  return { left, top, maxHeight: Math.min(PANEL_MAX_HEIGHT, room) }
}
