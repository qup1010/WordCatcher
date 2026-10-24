import { Eye, EyeOff, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { sendMessage } from '@/lib/messaging'
import { activeAiProfile } from '@/lib/settings'
import type { AiProfile, WordEntry } from '@/lib/types'
import { Combobox } from '../components/Combobox'
import { SamplePreview } from '../components/SamplePreview'
import { Section } from '../components/Section'
import {
  matchProviderPreset,
  PROVIDER_PRESETS,
  type ProviderPreset,
} from '../presets'
import type { SectionProps, Status } from './types'

/** 测试结果：要么给出一张真实的词条卡，要么说清楚卡在哪一环 */
type TestResult =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'ok', sample: WordEntry }
  /** 端点通、模型也答得出话，但吐不出结构化输出——AI 详解会用不了 */
  | { kind: 'no-structured', reply: string, detail: string }
  | { kind: 'err', text: string }

const PRESET_DEFAULT_MODELS = new Set(PROVIDER_PRESETS.map(p => p.model))

export function AiSection({ s, onChange }: SectionProps) {
  const [test, setTest] = useState<TestResult>({ kind: 'idle' })
  const [models, setModels] = useState<string[]>([])
  const [modelsStatus, setModelsStatus] = useState<Status>({ kind: 'idle' })
  const [modelOpen, setModelOpen] = useState(false)
  const [showKey, setShowKey] = useState(false)

  const active = activeAiProfile(s)
  const matchedPreset = matchProviderPreset(active.baseURL)
  const currentConfig = useRef('')
  currentConfig.current = JSON.stringify(s.ai)

  const resetFeedback = () => {
    setModels([])
    setModelsStatus({ kind: 'idle' })
    setModelOpen(false)
    setTest({ kind: 'idle' })
  }

  const patchProfile = (part: Partial<AiProfile>) => {
    setTest({ kind: 'idle' })
    setModelsStatus({ kind: 'idle' })
    if ('baseURL' in part || 'apiKey' in part) setModels([])
    onChange({
      ...s,
      ai: {
        ...s.ai,
        profiles: s.ai.profiles.map(p => (p.id === s.ai.activeId ? { ...p, ...part } : p)),
      },
    })
  }

  /**
   * 点服务商预设：填入对应的 Base URL，且当模型为空或仍处于其他预设默认模型时，
   * 自动同步填入该服务商的推荐模型，避免切换服务商后因残留 gpt-4o-mini 导致测试报错。
   */
  const applyProviderPreset = (preset: ProviderPreset | null) => {
    if (preset) {
      if (matchedPreset?.baseURL === preset.baseURL) return
      const curModel = active.model.trim()
      const shouldAutoFillModel = !curModel || PRESET_DEFAULT_MODELS.has(curModel)
      const shouldAutoFillName = active.name === '默认' || PROVIDER_PRESETS.some(p => p.label === active.name)
      patchProfile({
        baseURL: preset.baseURL,
        ...(shouldAutoFillModel ? { model: preset.model } : {}),
        ...(shouldAutoFillName ? { name: preset.label } : {}),
      })
    } else {
      if (!matchedPreset) return
      patchProfile({ baseURL: '' })
    }
    setModels([])
    setModelsStatus({ kind: 'idle' })
  }

  const switchProfile = (id: string) => {
    resetFeedback()
    onChange({ ...s, ai: { ...s.ai, activeId: id } })
  }

  const addProfile = () => {
    resetFeedback()
    const id = crypto.randomUUID()
    onChange({
      ...s,
      ai: {
        profiles: [
          ...s.ai.profiles,
          { ...active, id, name: `配置 ${s.ai.profiles.length + 1}` },
        ],
        activeId: id,
      },
    })
  }

  const removeProfile = () => {
    if (s.ai.profiles.length <= 1) return
    resetFeedback()
    const rest = s.ai.profiles.filter(p => p.id !== s.ai.activeId)
    onChange({ ...s, ai: { profiles: rest, activeId: rest[0].id } })
  }

  const onFetchModels = async () => {
    const requestedConfig = currentConfig.current
    setModelsStatus({ kind: 'busy' })
    const res = await sendMessage({ type: 'list-models', payload: { settings: s } })
    if (requestedConfig !== currentConfig.current) return
    if (res.ok) {
      setModels(res.data.models)
      setModelsStatus({ kind: 'ok', text: res.data.models.length > 0
        ? `已获取 ${res.data.models.length} 个模型，请选择要使用的模型。`
        : '服务未提供模型列表，请手动填写模型名称。' })
      setModelOpen(true)
    } else {
      setModelsStatus({ kind: 'err', text: res.error })
    }
  }

  const onTest = async () => {
    const requestedConfig = currentConfig.current
    setTest({ kind: 'busy' })
    const res = await sendMessage({ type: 'test-ai', payload: { settings: s } })
    if (requestedConfig !== currentConfig.current) return
    if (!res.ok) {
      setTest({ kind: 'err', text: res.error })
      return
    }

    const { sample, reply, structuredError } = res.data
    setTest(sample
      ? { kind: 'ok', sample }
      : { kind: 'no-structured', reply: reply ?? '', detail: structuredError ?? '' })
  }

  return (
    <Section
      id="sec-ai"
      index={2}
      title="AI 详解"
      intro="用 AI 结合原句解释词义和用法。填写服务地址、API Key 和模型后，可先测试示例释义。"
    >
      <div className="profiles">
        {s.ai.profiles.map(p => (
          <button
            key={p.id}
            type="button"
            className={`profile-chip ${p.id === s.ai.activeId ? 'profile-on' : ''}`}
            onClick={() => switchProfile(p.id)}
          >
            {p.name}
          </button>
        ))}
        <button
          type="button"
          className="profile-chip profile-add"
          title="复制当前配置，新增一套 AI 配置"
          onClick={addProfile}
        >
          <Plus size={13} />
        </button>
      </div>

      <label className="field">
        <span>配置名称</span>
        <input value={active.name} onChange={e => patchProfile({ name: e.target.value })} />
        {s.ai.profiles.length > 1 && (
          <button
            type="button"
            className="btn btn-icon btn-danger"
            title="删除当前配置，保存后生效"
            onClick={removeProfile}
          >
            <Trash2 size={14} />
          </button>
        )}
      </label>

      <div className="field field-top">
        <span>服务商预设</span>
        <div className="provider-chips" role="radiogroup" aria-label="服务商预设">
          <button
            type="button"
            role="radio"
            aria-checked={!matchedPreset}
            className={`provider-chip ${!matchedPreset ? 'provider-on' : ''}`}
            title="手动填写接口地址"
            onClick={() => applyProviderPreset(null)}
          >
            自定义
          </button>
          {PROVIDER_PRESETS.map(p => {
            const on = matchedPreset?.baseURL === p.baseURL
            return (
              <button
                key={p.label}
                type="button"
                role="radio"
                aria-checked={on}
                className={`provider-chip ${on ? 'provider-on' : ''}`}
                title={p.title ? `${p.title}（默认模型：${p.model}）` : `默认模型：${p.model}`}
                onClick={() => applyProviderPreset(p)}
              >
                {p.label}
              </button>
            )
          })}
        </div>
      </div>
      <p className="hint">
        选择预设后，请核对接口地址和模型名称，再填写自己的 API Key。
        {matchedPreset?.hint ? ` ${matchedPreset.hint}` : ''}
      </p>

      <label className="field">
        <span>接口地址</span>
        <input
          value={active.baseURL}
          placeholder="https://api.openai.com/v1"
          onChange={e => patchProfile({ baseURL: e.target.value })}
        />
      </label>
      <p className="hint">填写服务商提供的 Base URL（接口基础地址），通常包含 <code>/v1</code>；不要填写完整的 <code>/chat/completions</code> 地址。</p>

      <div className="field">
        <span>API Key</span>
        <input
          type={showKey ? 'text' : 'password'}
          aria-label="API Key"
          value={active.apiKey}
          placeholder="sk-…"
          onChange={e => patchProfile({ apiKey: e.target.value })}
        />
        <button
          type="button"
          className="btn btn-icon"
          title={showKey ? '隐藏 API Key' : '显示 API Key'}
          aria-label={showKey ? '隐藏 API Key' : '显示 API Key'}
          onClick={() => setShowKey(v => !v)}
        >
          {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
      <p className="hint">API Key 以明文保存在当前浏览器本地，查询和测试时会发送给上方配置的 AI 服务。</p>

      <div className="field">
        <span>模型名称</span>
        <Combobox
          value={active.model}
          options={models}
          placeholder={matchedPreset?.model || 'gpt-4o-mini'}
          open={modelOpen}
          onOpenChange={setModelOpen}
          onChange={v => patchProfile({ model: v })}
        />
        <button
          type="button"
          className="btn btn-icon"
          title="从接口获取可用模型列表"
          disabled={modelsStatus.kind === 'busy'}
          onClick={() => void onFetchModels()}
        >
          <RefreshCw size={14} className={modelsStatus.kind === 'busy' ? 'spin' : ''} />
          <span>获取列表</span>
        </button>
      </div>
      {matchedPreset && active.model !== matchedPreset.model && (
        <p className="hint">
          预设的默认模型为 <code>{matchedPreset.model}</code>，
          <button
            type="button"
            className="save-retry"
            style={{ marginLeft: 4 }}
            onClick={() => patchProfile({ model: matchedPreset.model })}
          >
            使用默认模型
          </button>
        </p>
      )}
      {modelsStatus.kind === 'ok' && <p className="hint hint-ok">{modelsStatus.text}</p>}
      {modelsStatus.kind === 'err' && <p className="hint hint-err">{modelsStatus.text}</p>}

      <div className="row">
        <button className="btn" onClick={() => void onTest()} disabled={test.kind === 'busy'}>
          {test.kind === 'busy' ? '正在生成示例释义…' : '测试 AI 详解'}
        </button>
      </div>

      <p className="hint">测试使用当前填写的配置生成示例释义。确认效果后，点击「保存配置」用于查词。</p>

      {test.kind === 'ok' && (
        <div className="result">
          <p className="ok">测试成功，示例释义如下。</p>
          <SamplePreview entry={test.sample} />
        </div>
      )}

      {test.kind === 'no-structured' && (
        <div className="result">
          <p className="warn">
            服务已响应，但示例释义未能生成。请更换模型，或检查服务是否支持结构化输出后重试。
          </p>
          {test.reply && (
            <>
              <p className="hint">服务返回的普通对话内容：</p>
              <div className="reply">{test.reply}</div>
            </>
          )}
          <details>
            <summary>查看详细错误原因</summary>
            <div className="reply reply-quiet">{test.detail}</div>
          </details>
        </div>
      )}

      {test.kind === 'err' && (
        <div className="result">
          <p className="err">{test.text}</p>
        </div>
      )}
    </Section>
  )
}
