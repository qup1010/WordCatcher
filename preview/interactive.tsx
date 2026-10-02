import { createRoot } from 'react-dom/client'
const mode = new URLSearchParams(location.search).get('view') || 'sidepanel'
async function mount() {
  if (mode === 'popup') {
    await import('../entrypoints/popup/style.css')
    const { default: App } = await import('../entrypoints/popup/App')
    createRoot(document.getElementById('root')!).render(<App />)
  } else if (mode === 'options') {
    await import('../entrypoints/options/style.css')
    const { default: App } = await import('../entrypoints/options/App')
    createRoot(document.getElementById('root')!).render(<App />)
  } else if (mode === 'content') {
    const article = document.createElement('article')
    article.style.cssText = 'max-width:660px;margin:80px auto;padding:24px;font:20px/1.8 Georgia;color:#292d2b;'
    article.innerHTML = '<h1>Reading with Word Catcher</h1><p>The convenience of a familiar place can make a difficult day feel a little easier.</p><p>划选上方英文单词，体验快译、释义编辑和保存反馈。此页面仅使用示例数据。</p>'
    document.body.prepend(article)
    const host = document.createElement('div')
    document.body.append(host)
    const shadow = host.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = (await import('../entrypoints/content/style.css?inline')).default
    shadow.append(style)
    const target = document.createElement('div')
    shadow.append(target)
    const { default: App } = await import('../entrypoints/content/App')
    createRoot(target).render(<App shadowHost={host} />)
  } else {
    await import('../entrypoints/sidepanel/style.css')
    const { default: App } = await import('../entrypoints/sidepanel/App')
    createRoot(document.getElementById('root')!).render(<App />)
  }
}
void mount()
