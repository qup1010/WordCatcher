import { afterEach, describe, expect, it, vi } from 'vitest'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { canUseLookupShortcut, navigateTabs } from '../../lib/ui-keyboard'

afterEach(() => { document.body.replaceChildren() })
describe('lookup shortcuts', () => {
  it.each(['textarea', 'input', 'button', 'select', 'a'])('does not steal keyboard input from a shadow %s', tag => {
    const host = document.createElement('div')
    const shadow = host.attachShadow({ mode: 'open' })
    const control = document.createElement(tag)
    if (tag === 'a') control.setAttribute('href', '#')
    shadow.append(control); document.body.append(host)
    let allowed = true
    document.addEventListener('keydown', e => { allowed = canUseLookupShortcut(e) }, { once: true })
    control.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true }))
    expect(allowed).toBe(false)
  })
  it.each([{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }])('ignores modifiers and composition %o', options => {
    expect(canUseLookupShortcut(new KeyboardEvent('keydown', { key: 'p', ...options }))).toBe(false)
  })
  it('allows normal shortcuts on the reading surface', () => {
    expect(canUseLookupShortcut(new KeyboardEvent('keydown', { key: 'Enter' }))).toBe(true)
  })
})
describe('tab keyboard navigation', () => {
  it('wraps arrow navigation and supports Home/End with focus', () => {
    const list = document.createElement('div')
    list.innerHTML = '<button role="tab">first</button><button role="tab">second</button>'
    document.body.append(list)
    const tabs = list.querySelectorAll('button')
    const clicked = vi.fn(); tabs[1].onclick = clicked
    function press(key: string, target: HTMLElement) {
      const preventDefault = vi.fn()
      navigateTabs({ key, currentTarget: list, target, nativeEvent: {}, preventDefault } as unknown as ReactKeyboardEvent<HTMLElement>)
      expect(preventDefault).toHaveBeenCalled()
    }
    press('ArrowLeft', tabs[0]); expect(document.activeElement).toBe(tabs[1]); expect(clicked).toHaveBeenCalledOnce()
    press('Home', tabs[1]); expect(document.activeElement).toBe(tabs[0])
    press('End', tabs[0]); expect(document.activeElement).toBe(tabs[1])
  })
})
