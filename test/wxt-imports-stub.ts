/**
 * `#imports` 是 WXT 在构建时生成的虚拟模块，vitest 下不存在。
 * 这里提供最小桩件，好让依赖它的模块能在单测里被导入。
 */

let store: Record<string, unknown> = {}

export const storage = {
  async getItem<T>(key: string): Promise<T | null> {
    return (store[key] as T) ?? null
  },
  async setItem(key: string, value: unknown): Promise<void> {
    store[key] = value
  },
  watch() {
    return () => {}
  },
}

/** 仅供测试用：重置桩件里的存储 */
export function __resetStorage(next: Record<string, unknown> = {}) {
  store = next
}

export const browser = {
  runtime: {
    async sendMessage() { return { ok: false, error: 'stub' } },
    openOptionsPage() {},
    onMessage: { addListener() {} },
    onInstalled: { addListener() {} },
  },
}

export const defineBackground = (fn: unknown) => fn
export const defineContentScript = (config: unknown) => config
export const createShadowRootUi = async () => ({ mount() {}, remove() {} })
