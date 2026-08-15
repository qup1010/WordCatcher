import { Plus, RefreshCw, Trash2 } from 'lucide-react'
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

export function AiSection({ s, onChange, flush }: SectionProps) {
  const [test, setTest] = useState<TestResult>({ kind: 'idle' })
  const [models, setModels] = useState<string[]>([])
  const [modelsStatus, setModelsStatus] = useState<Status>({ kind: 'idle' })
  const [modelOpen, setModelOpen] = useState(false)

  const active = activeAiProfile(s)
  /** 按当前 Base URL 反推：匹配到预设就高亮它，否则高亮「自定义」 */
  const matchedPreset = matchProviderPreset(active.baseURL)

  /** 换了配置之后，上一套的模型列表和测试结果都不再作数 */
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

  /** 点预设：只写 baseURL，不动 model / apiKey / 名称 */
  const applyProviderPreset = (preset: ProviderPreset | null) => {
    if (preset) {
      if (matchedPreset?.baseURL === preset.baseURL) return
      patchProfile({ baseURL: preset.baseURL })
    } else {
      // 自定义：若当前是某预设地址，清空让用户自己填；已是自定义则不动
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
          // 以当前配置为模板起步，改名和 key 就能用
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
      setModelsStatus({ kind: 'ok', text: `已拉取 ${res.data.models.length} 个模型` })
      setModelOpen(true) // 拉完直接展开，省一次点击
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
      index={0}
      title="AI 接口"
      intro="结合具体句子语境理解生词、还原原形并翻译整句。支持任何兼容 OpenAI 格式的模型接口。"
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
          title="新建配置"
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
            title="删除这套配置"
            onClick={removeProfile}
          >
            <Trash2 size={14} />
          </button>
        )}
      </label>

      <div className="field field-top">
        <span>服务商</span>
        <div className="provider-chips" role="radiogroup" aria-label="服务商预设">
          <button
            type="button"
            role="radio"
            aria-checked={!matchedPreset}
            className={`provider-chip ${!matchedPreset ? 'provider-on' : ''}`}
            title="自己填写接口地址"
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
                title={p.title ?? p.label}
                onClick={() => applyProviderPreset(p)}
              >
                {p.label}
              </button>
            )
          })}
        </div>
      </div>
      <p className="hint">
        点预设只填入接口地址，模型请自行填写或拉取列表。
        {matchedPreset?.hint ? ` ${matchedPreset.hint}` : ''}
      </p>

      <label className="field">
        <span>Base URL</span>
        <input
          value={active.baseURL}
          placeholder="https://api.example.com/v1"
          onChange={e => patchProfile({ baseURL: e.target.value })}
        />
      </label>
      <p className="hint">以 /v1 这类版本路径结尾。</p>

      <label className="field">
        <span>API Key</span>
        <input
          type="password"
          value={active.apiKey}
          placeholder="sk-…"
          onChange={e => patchProfile({ apiKey: e.target.value })}
        />
      </label>
      <p className="hint">仅保存在本机浏览器里。</p>

      <div className="field">
        <span>模型</span>
        <Combobox
          value={active.model}
          options={models}
          placeholder="gpt-4o-mini"
          open={modelOpen}
          onOpenChange={setModelOpen}
          onChange={v => patchProfile({ model: v })}
        />
        <button
          type="button"
          className="btn btn-icon"
          title="从端点拉取模型列表"
          disabled={modelsStatus.kind === 'busy'}
          onClick={() => void onFetchModels()}
        >
          <RefreshCw size={14} className={modelsStatus.kind === 'busy' ? 'spin' : ''} />
          <span>拉取列表</span>
        </button>
      </div>
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
      <p className="hint">同时用于快速翻译的目标语言。</p>

      <div className="row">
        <button className="btn" onClick={() => void onTest()} disabled={test.kind === 'busy'}>
          {test.kind === 'busy' ? '正在生成示例释义…' : '测试连接并预览释义效果'}
        </button>
      </div>

      {test.kind === 'ok' && (
        <div className="result">
          <p className="ok">连接正常。以下是当前模型对示例句的实际输出效果：</p>
          <SamplePreview entry={test.sample} />
        </div>
      )}

      {test.kind === 'no-structured' && (
        <div className="result">
          <p className="warn">
            接口已连通，但当前模型无法返回结构化数据（JSON 格式），AI 语境释义将无法正常工作。建议更换能力更强或支持结构化输出的模型。
          </p>
          {test.reply && (
            <>
              <p className="hint">它对普通提问的回答是正常的：</p>
              <div className="reply">{test.reply}</div>
            </>
          )}
          <details>
            <summary>原始报错</summary>
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
