import { defineConfig } from 'wxt'

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Word Catcher',
    description: '划词 → AI 结合上下文解释 → 一键存入 Anki',
    permissions: ['storage'],
    action: { default_title: 'Word Catcher' },
    // AI 接口域名由用户自行配置，AnkiConnect 在 127.0.0.1，
    // 因此需要宽泛的主机权限。background 拥有此权限后发请求不受 CORS 限制，
    // 这样多数情况下无需再去改 AnkiConnect 的 webCorsOriginList。
    host_permissions: ['<all_urls>'],
  },
})
