import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

/** 当前标签进入 Tab 顺序，方向键切换标签。 */
export function navigateTabs(event: ReactKeyboardEvent<HTMLElement>) {
  if (event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
  const index = tabs.indexOf(event.target as HTMLButtonElement)
  if (index < 0 || !tabs.length) return
  event.preventDefault()
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
    : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
  tabs[next].click()
  tabs[next].focus()
}

/** Shadow DOM 内的真实焦点位于 composedPath。 */
export function canUseLookupShortcut(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return false
  return !event.composedPath().some(target => target instanceof HTMLElement
    && (target.isContentEditable || target.matches('input, textarea, select, button, a[href], [role="button"], [role="tab"]')))
}
