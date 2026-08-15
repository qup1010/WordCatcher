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
        「先显示操作胶囊」按需点击；「直接快速翻译」划词即查离线词典/机翻（0 延迟零消耗）；「直接 AI 释义」每次划选均调用大模型。
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
      <p className="hint">决定试听与 Anki 卡片朗读的发音。</p>

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
