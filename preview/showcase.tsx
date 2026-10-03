import { createRoot } from 'react-dom/client'
import App from '../entrypoints/content/App'
import contentStyles from '../entrypoints/content/style.css?inline'

// 只在预览服务器中运行。#imports 由 preview/runtime.ts 提供，不访问真实配置或服务。
async function prepareShowcase() {
  const host = document.createElement('div')
  document.body.append(host)
  const shadow = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = contentStyles
  shadow.append(style)
  const target = document.createElement('div')
  shadow.append(target)
  createRoot(target).render(<App shadowHost={host} />)

  await document.fonts.ready
  await new Promise(resolve => setTimeout(resolve, 700))
  const word = document.getElementById('selected-word')!
  const range = document.createRange()
  range.setStart(word.firstChild!, 0)
  range.setEnd(word.firstChild!, word.textContent!.length)
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
  word.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))

  const started = Date.now()
  const check = window.setInterval(() => {
    const action = shadow.querySelector<HTMLButtonElement>('button[title="结合语境进行 AI 释义"]')
    if (action) action.click()
    const definition = shadow.querySelector('.wc-def')
    if (definition?.textContent?.includes('让生活更省事') && !shadow.querySelector('.wc-caret')) {
      window.clearInterval(check)
      Promise.all(Array.from(document.images).map(image => image.decode())).then(() => {
        window.setTimeout(() => { document.body.dataset.showcaseReady = 'true' }, 400)
      })
    } else if (Date.now() - started > 10000) {
      window.clearInterval(check)
      document.body.dataset.showcaseError = 'Preview did not finish rendering'
      console.error('Showcase preview did not finish rendering')
    }
  }, 150)
}
void prepareShowcase()
