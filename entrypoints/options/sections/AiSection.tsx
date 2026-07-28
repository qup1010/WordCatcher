import { Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { sendMessage } from '@/lib/messaging'
import { activeAiProfile } from '@/lib/settings'
import type { AiProfile, WordEntry } from '@/lib/types'
import { Combobox } from '../components/Combobox'
import { SamplePreview } from '../components/SamplePreview'
import { Section } from '../components/Section'
import { EXPLAIN_LANGUAGES, PROVIDER_PRESETS } from '../presets'
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
      intro="用于 AI 详解。兼容 OpenAI 接口的服务均可，点击标签切换配置。"
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

      <label className="field">
        <span>服务商预设</span>
        <select
          value=""
          onChange={(e) => {
            const p = PROVIDER_PRESETS.find(x => x.label === e.target.value)
            if (!p) return
            patchProfile({ baseURL: p.baseURL, model: p.model })
            setModels([])
            setModelsStatus({ kind: 'idle' })
          }}
        >
          <option value="">选择后自动填入地址和模型…</option>
          {PROVIDER_PRESETS.map(p => <option key={p.label} value={p.label}>{p.label}</option>)}
        </select>
      </label>

      <label className="field">
        <span>Base URL</span>
        <input
          value={active.baseURL}
          placeholder="https://api.openai.com/v1"
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
          {test.kind === 'busy' ? '正在生成示例词条…' : '测试 AI 并预览效果'}
        </button>
      </div>

      {test.kind === 'ok' && (
        <div className="result">
          <p className="ok">配置可用。这是它对示例句的实际输出：</p>
          <SamplePreview entry={test.sample} />
        </div>
      )}

      {test.kind === 'no-structured' && (
        <div className="result">
          <p className="warn">
            端点能连上，但这个模型吐不出结构化输出，AI 详解会一直报错。换个大一点的模型即可。
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
