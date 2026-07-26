import { createShadowRootUi, defineContentScript } from '#imports'
import ReactDOM from 'react-dom/client'
import App from './App'
import './style.css'

export default defineContentScript({
  matches: ['<all_urls>'],
  // 让 WXT 把 style.css 交给我们注入进 shadow root，而不是塞进页面
  cssInjectionMode: 'ui',

  async main(ctx) {
    const ui = await createShadowRootUi(ctx, {
      name: 'word-catcher-ui',
      position: 'inline',
      anchor: 'body',
      onMount: (container, _shadow, shadowHost) => {
        const root = ReactDOM.createRoot(container)
        root.render(<App shadowHost={shadowHost} />)
        return root
      },
      onRemove: (root) => root?.unmount(),
    })

    ui.mount()
  },
})
