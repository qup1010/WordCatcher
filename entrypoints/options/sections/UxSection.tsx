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
      index={5}
      title="操作与显示"
      intro="选择划词后显示什么、在哪些网站启用，以及如何朗读。"
    >
      <div className="field">
        <span>触发方式</span>
        <Segmented
          value={s.triggerMode}
          options={[
            { value: 'icon', label: '先显示查词按钮' },
            { value: 'quick', label: '直接查词' },
          ]}
          onChange={triggerMode => onChange({ ...s, triggerMode })}
        />
      </div>
      <p className="hint">
        「先显示查词按钮」让你选择快译或 AI 详解；「直接查词」会在划选后立即查询。
      </p>

      <div className="field">
        <span>划词辅助键</span>
        <Segmented
          value={s.modifierKey || 'none'}
          options={[
            { value: 'none', label: '无需按键' },
            { value: 'alt', label: '按住 Alt' },
            { value: 'ctrl', label: '按住 Ctrl' },
            { value: 'shift', label: '按住 Shift' },
          ]}
          onChange={modifierKey => onChange({ ...s, modifierKey: modifierKey as Settings['modifierKey'] })}
        />
      </div>
      <p className="hint">
        选定辅助键后，需按住该键划选文字才会出现查词面板。
      </p>

      <div className="field">
        <span>双击查词</span>
        <div className="field-inline">
          <Switch
            checked={s.doubleClickLookup}
            onChange={doubleClickLookup => onChange({ ...s, doubleClickLookup })}
          />
          <span className="field-inline-label">
            双击单词后直接查词，也会优先使用离线词典
          </span>
        </div>
      </div>

      <div className="field field-top">
        <span>不启用划词的网站</span>
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
                    aria-label={`恢复在 ${domain} 上划词`}
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
              placeholder="例如 github.com，按 Enter 添加"
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
            <span className="domain-presets-label">快速添加：</span>
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
        这些网站上不显示划词面板，仍可点击浏览器工具栏中的扩展图标手动查词。
      </p>

      <label className="field">
        <span>默认朗读语言</span>
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

      <p className="hint">未识别出语种时使用此语言。也会修改 Anki 卡片的发音语言，这部分需点击「保存配置」。</p>

      <div className="field">
        <span>自动识别朗读语言</span>
        <div className="field-inline">
          <Switch
            checked={s.tts.autoDetect ?? true}
            onChange={autoDetect => patchTts({ autoDetect })}
          />
          <span className="field-inline-label">
            根据文本选择朗读语言；关闭时使用上方默认语言
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
            <span>试听</span>
          </button>
        )}
      </div>
    </Section>
  )
}
