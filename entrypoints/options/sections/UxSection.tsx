import { Plus, Volume2, X } from 'lucide-react'
import { useState } from 'react'
import { isTtsSupported, speak } from '@/lib/tts'
import type { Settings } from '@/lib/types'
import { Section } from '../components/Section'
import { Segmented, Switch } from '../components/controls'
import { LANGUAGE_PRESETS } from '../presets'
import type { SectionProps } from './types'

const COMMON_BLACKLIST_DOMAINS = [
  'github.com',
  'docs.google.com',
  'notion.so',
  'feishu.cn',
  'overleaf.com',
]

export function UxSection({ s, onChange }: SectionProps) {
  const [domainInput, setDomainInput] = useState('')

  const patchTts = (part: Partial<Settings['tts']>) =>
    onChange({ ...s, tts: { ...s.tts, ...part } })

  const currentLang = LANGUAGE_PRESETS.find(l => l.ttsLang === s.tts.lang)
  const blacklist = s.blacklist || []

  const addDomains = (raw: string) => {
    const items = raw
      .split(/[\s,;\n]+/)
      .map(x => x.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
      .filter(Boolean)
    if (items.length === 0) return
    const next = Array.from(new Set([...blacklist, ...items]))
    onChange({ ...s, blacklist: next })
    setDomainInput('')
  }

  const removeDomain = (domain: string) => {
    onChange({ ...s, blacklist: blacklist.filter(d => d !== domain) })
  }

  const onPreviewTts = () => {
    if (!isTtsSupported()) return
    const sample = s.tts.lang.startsWith('ja')
      ? '言葉を文脈の中で覚える。'
      : s.tts.lang.startsWith('ko')
        ? '문맥 속에서 단어를 기억합니다.'
        : 'Capture words in their natural context.'
    speak(sample, {
      lang: s.tts.lang,
      rate: s.tts.rate,
      autoDetect: false,
    })
  }

  return (
    <Section
      id="sec-ux"
      index={0}
      title="划词与朗读"
      intro="设置网页划选文本时的触发行为、防误触规则与发音语速。"
    >
      <div className="field">
        <span>触发方式</span>
        <Segmented
          value={s.triggerMode === 'auto' ? 'ai' : s.triggerMode}
          options={[
            { value: 'icon', label: '先显示操作胶囊' },
            { value: 'quick', label: '直接快速翻译' },
            { value: 'ai', label: '直接 AI 释义' },
          ]}
          onChange={triggerMode => onChange({ ...s, triggerMode })}
        />
      </div>
      <p className="hint">
        「操作胶囊」可按需选择快译或 AI 详解；「直接快速翻译」优先查询本地离线词典；「直接 AI 释义」每次划选直接生成语境解析。
      </p>

      <div className="field">
        <span>辅助按键</span>
        <Segmented
          value={s.modifierKey || 'none'}
          options={[
            { value: 'none', label: '直接划选' },
            { value: 'alt', label: '按住 Alt' },
            { value: 'ctrl', label: '按住 Ctrl' },
            { value: 'shift', label: '按住 Shift' },
          ]}
          onChange={modifierKey => onChange({ ...s, modifierKey: modifierKey as Settings['modifierKey'] })}
        />
      </div>
      <p className="hint">
        设置辅助键后，需在划选文本的同时按住该键才会唤起查词面板，防止日常阅读复制时误触。
      </p>

      <div className="field">
        <span>双击查词</span>
        <div className="field-inline">
          <Switch
            checked={s.doubleClickLookup}
            onChange={doubleClickLookup => onChange({ ...s, doubleClickLookup })}
          />
          <span className="field-inline-label">
            双击单词时跳过操作胶囊，直接展开快速翻译
          </span>
        </div>
      </div>

      <div className="field field-top">
        <span>禁用网站</span>
        <div className="domain-manager">
          {blacklist.length > 0 && (
            <div className="domain-chips">
              {blacklist.map(domain => (
                <span key={domain} className="domain-chip">
                  <span>{domain}</span>
                  <button
                    type="button"
                    className="domain-chip-remove"
                    title={`移除 ${domain}`}
                    aria-label={`移除禁用域名 ${domain}`}
                    onClick={() => removeDomain(domain)}
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="domain-input-row">
            <input
              type="text"
              value={domainInput}
              placeholder="输入域名（如 github.com），回车添加"
              onChange={e => setDomainInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  addDomains(domainInput)
                }
              }}
            />
            <button
              type="button"
              className="btn btn-icon"
              disabled={!domainInput.trim()}
              onClick={() => addDomains(domainInput)}
            >
              <Plus size={14} />
              <span>添加</span>
            </button>
          </div>

          <div className="domain-presets">
            <span className="domain-presets-label">常用排除：</span>
            {COMMON_BLACKLIST_DOMAINS.filter(d => !blacklist.includes(d)).map(domain => (
              <button
                key={domain}
                type="button"
                className="provider-chip"
                onClick={() => addDomains(domain)}
              >
                + {domain}
              </button>
            ))}
          </div>
        </div>
      </div>
      <p className="hint">
        在以上域名下不触发划词弹窗，避免干扰代码编写或在线文档协作。
      </p>

      <label className="field">
        <span>默认学习语言</span>
        <select
          value={currentLang?.label ?? ''}
          onChange={(e) => {
            const l = LANGUAGE_PRESETS.find(x => x.label === e.target.value)
            if (!l) return
            onChange({
              ...s,
              tts: { ...s.tts, lang: l.ttsLang },
              anki: { ...s.anki, ttsLang: l.ankiTtsLang },
            })
          }}
        >
          {!currentLang && <option value="">自定义（{s.tts.lang}）</option>}
          {LANGUAGE_PRESETS.map(l => <option key={l.label} value={l.label}>{l.label}</option>)}
        </select>
      </label>

      <div className="field">
        <span>语种识别</span>
        <div className="field-inline">
          <Switch
            checked={s.tts.autoDetect ?? true}
            onChange={autoDetect => patchTts({ autoDetect })}
          />
          <span className="field-inline-label">
            朗读时自动识别文本语种（如日语、韩语、法语、德语）
          </span>
        </div>
      </div>

      <div className="field">
        <span>朗读按钮</span>
        <div className="field-inline">
          <Switch checked={s.tts.enabled} onChange={enabled => patchTts({ enabled })} />
          <span className="field-inline-label">
            在查词面板中显示朗读按钮（<Volume2 size={13} className="inline-icon" />，快捷键 <code>P</code>）
          </span>
        </div>
      </div>

      <div className="field">
        <span>朗读语速</span>
        <input
          type="range"
          min={0.5}
          max={1.5}
          step={0.1}
          value={s.tts.rate}
          onChange={e => patchTts({ rate: Number(e.target.value) })}
        />
        <span className="value">{s.tts.rate.toFixed(1)}×</span>
        {isTtsSupported() && (
          <button
            type="button"
            className="btn btn-icon"
            onClick={onPreviewTts}
            title="试听当前语言和语速"
          >
            <Volume2 size={14} />
            <span>试听发音</span>
          </button>
        )}
      </div>
    </Section>
  )
}
