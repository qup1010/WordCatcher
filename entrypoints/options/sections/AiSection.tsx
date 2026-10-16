import { Eye, EyeOff, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { sendMessage } from '@/lib/messaging'
import { activeAiProfile } from '@/lib/settings'
import type { AiProfile, WordEntry } from '@/lib/types'
import { Combobox } from '../components/Combobox'
import { SamplePreview } from '../components/SamplePreview'
import { Section } from '../components/Section'
import {
  EXPLAIN_LANGUAGES,
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

export function AiSection({ s, onChange, flush }: SectionProps) {
  const [test, setTest] = useState<TestResult>({ kind: 'idle' })
  const [models, setModels] = useState<string[]>([])
  const [modelsStatus, setModelsStatus] = useState<Status>({ kind: 'idle' })
  const [modelOpen, setModelOpen] = useState(false)
  const [showKey, setShowKey] = useState(false)

  const active = activeAiProfile(s)
  const matchedPreset = matchProviderPreset(active.baseURL)

  const resetFeedback = () => {
    setModels([])
    setModelsStatus({ kind: 'idle' })
    setModelOpen(false)
    setTest({ kind: 'idle' })
  }

  const patchProfile = (part: Partial<AiProfile>) =>
    onChange({
      ...s,
      ai: {
        ...s.ai,
        profiles: s.ai.profiles.map(p => (p.id === s.ai.activeId ? { ...p, ...part } : p)),
      },
    })

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
    setModelsStatus({ kind: 'busy' })
    await flush()
    const res = await sendMessage({ type: 'list-models' })
    if (res.ok) {
      setModels(res.data.models)
      setModelsStatus({ kind: 'ok', text: `已获取 ${res.data.models.length} 个可用模型` })
      setModelOpen(true)
    } else {
      setModelsStatus({ kind: 'err', text: res.error })
    }
  }

  const onTest = async () => {
    setTest({ kind: 'busy' })
    await flush()

    const res = await sendMessage({ type: 'test-ai' })
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
      index={3}
      title="AI 语境详解"
      intro="结合原句语境解析词义、固定搭配与用法，并翻译整句。支持所有兼容 OpenAI 协议的服务商。"
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
          title="新增一套 AI 配置"
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
            title="删除当前配置"
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
                title={p.title ? `${p.title}（推荐模型：${p.model}）` : `推荐模型：${p.model}`}
                onClick={() => applyProviderPreset(p)}
              >
                {p.label}
              </button>
            )
          })}
        </div>
      </div>
      <p className="hint">
        选择预设将自动填入接口地址与推荐模型。
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
      <p className="hint">通常以 <code>/v1</code> 或 <code>/v4</code> 等版本路径结尾。</p>

      <div className="field">
        <span>API Key</span>
        <input
          type={showKey ? 'text' : 'password'}
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
      <p className="hint">密钥仅保存在当前浏览器本地存储中，不会上传至第三方服务器。</p>

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
          当前服务商推荐使用 <code>{matchedPreset.model}</code>，
          <button
            type="button"
            className="save-retry"
            style={{ marginLeft: 4 }}
            onClick={() => patchProfile({ model: matchedPreset.model })}
          >
            点击填入
          </button>
        </p>
      )}
      {modelsStatus.kind === 'ok' && <p className="hint hint-ok">{modelsStatus.text}</p>}
      {modelsStatus.kind === 'err' && <p className="hint hint-err">{modelsStatus.text}</p>}

      <label className="field">
        <span>释义语言</span>
        <select
          value={s.explainLanguage}
          onChange={e => onChange({ ...s, explainLanguage: e.target.value })}
        >
          {EXPLAIN_LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
      </label>
      <p className="hint">同时用于 AI 语境详解与快速翻译的目标语言。</p>

      <div className="row">
        <button className="btn" onClick={() => void onTest()} disabled={test.kind === 'busy'}>
          {test.kind === 'busy' ? '正在生成示例释义…' : '测试连接并预览释义效果'}
        </button>
      </div>

      {test.kind === 'ok' && (
        <div className="result">
          <p className="ok">连接成功。以下是当前模型对示例语境的实际解析效果：</p>
          <SamplePreview entry={test.sample} />
        </div>
      )}

      {test.kind === 'no-structured' && (
        <div className="result">
          <p className="warn">
            接口已连通，但当前模型未能返回结构化 JSON 数据，AI 语境详解将无法正常工作。请更换支持结构化输出的模型。
          </p>
          {test.reply && (
            <>
              <p className="hint">模型对普通对话的回复：</p>
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
