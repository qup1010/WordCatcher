import { Zap } from 'lucide-react'
import { Section } from '../components/Section'
import { Segmented } from '../components/controls'
import type { SectionProps } from './types'

export function MtSection({ s, onChange }: SectionProps) {
  return (
    <Section
      id="sec-mt"
      index={1}
      title="快速翻译"
      intro={<>划词后点 <Zap size={13} className="inline-icon" /> 使用，不消耗 AI 额度。所选服务失败时自动切换另一家。</>}
    >
      <div className="field">
        <span>翻译服务</span>
        <Segmented
          value={s.mt.provider}
          options={[
            { value: 'microsoft', label: '微软翻译' },
            { value: 'google', label: '谷歌翻译' },
          ]}
          onChange={provider => onChange({ ...s, mt: { ...s.mt, provider } })}
        />
      </div>
      <p className="hint">谷歌翻译在部分网络环境下无法连接。</p>
    </Section>
  )
}
