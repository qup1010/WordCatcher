import { Volume2 } from 'lucide-react'
import type { Settings } from '@/lib/types'
import { Section } from '../components/Section'
import { Segmented, Switch } from '../components/controls'
import { LANGUAGE_PRESETS } from '../presets'
import type { SectionProps } from './types'

export function UxSection({ s, onChange }: SectionProps) {
  const patchTts = (part: Partial<Settings['tts']>) =>
    onChange({ ...s, tts: { ...s.tts, ...part } })

  const currentLang = LANGUAGE_PRESETS.find(l => l.ttsLang === s.tts.lang)

  return (
    <Section id="sec-ux" index={4} title="划词与朗读">
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
        操作胶囊让你选择快译或 AI；直接快译优先查词典；直接 AI 会在每次划选时请求模型。
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
        「直接划选」选中文本即触发；设置辅助键后，需在划选的同时按住该键才会唤起，防止日常阅读复制时误触。
      </p>

      <div className="field">
        <span>双击查词</span>
        <div className="field-inline">
          <Switch
            checked={s.doubleClickLookup}
            onChange={doubleClickLookup => onChange({ ...s, doubleClickLookup })}
          />
          <span className="field-inline-label">
            双击单词直接展开快速翻译
          </span>
        </div>
      </div>
      <p className="hint">
        开启后，双击网页中的单词跳过操作胶囊，直接展开离线词典或在线机翻。
      </p>

      <label className="field">
        <span>禁用域名</span>
        <textarea
          rows={3}
          placeholder="每行一个域名，例如 github.com 或 docs.google.com"
          value={(s.blacklist || []).join('\n')}
          onChange={e => onChange({
            ...s,
            blacklist: e.target.value
              .split('\n')
              .map(x => x.trim().toLowerCase())
              .filter(Boolean),
          })}
        />
      </label>
      <p className="hint">
        在这些网站上完全禁用划词弹窗，避免干扰代码编辑或在线文档协作。
      </p>

      <label className="field">
        <span>学习语言</span>
        <select
          value={currentLang?.label ?? ''}
          onChange={(e) => {
            const l = LANGUAGE_PRESETS.find(x => x.label === e.target.value)
            if (!l) return
            // 两处发音一起改：插件内试听用 BCP-47，Anki 的 {{tts}} 用下划线格式
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
      <p className="hint">用于查词试听和 Anki 卡片的默认朗读语言。</p>

      <div className="field">
        <span>语种识别</span>
        <div className="field-inline">
          <Switch
            checked={s.tts.autoDetect ?? true}
            onChange={autoDetect => patchTts({ autoDetect })}
          />
          <span className="field-inline-label">
            划词试听时智能识别语种（如日语、韩语、德语等）
          </span>
        </div>
      </div>
      <p className="hint">开启后若划选文本明显属于其它语种，自动使用对应语种音色朗读，避免用英语发音混读。</p>

      <div className="field">
        <span>试听按钮</span>
        <div className="field-inline">
          <Switch checked={s.tts.enabled} onChange={enabled => patchTts({ enabled })} />
          <span className="field-inline-label">
            在面板中显示（<Volume2 size={13} className="inline-icon" />）
          </span>
        </div>
      </div>

      <label className="field">
        <span>语速</span>
        <input
          type="range"
          min={0.5}
          max={1.5}
          step={0.1}
          value={s.tts.rate}
          onChange={e => patchTts({ rate: Number(e.target.value) })}
        />
        <span className="value">{s.tts.rate.toFixed(1)}×</span>
      </label>
    </Section>
  )
}
