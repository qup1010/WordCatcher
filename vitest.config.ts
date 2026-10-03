import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      // WXT 的虚拟模块在测试环境下不存在，换成桩件
      '#imports': fileURLToPath(new URL('./tests/helpers/wxt-imports-stub.ts', import.meta.url)),
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.ts'],
    coverage: {
      include: ['lib/**/*.ts'],
      exclude: ['lib/messaging.ts'],
    },
  },
})
