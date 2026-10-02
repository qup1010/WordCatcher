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
      intro={<>划词后点击 <Zap size={13} className="inline-icon" /> 进行快速翻译，无需 AI 配置。长句和词典未收录的词使用在线服务。</>}
    >
      <div className="field">
        <span>首选翻译服务</span>
        <Segmented
          value={s.mt.provider}
          options={[
            { value: 'microsoft', label: '微软翻译' },
            { value: 'google', label: '谷歌翻译' },
          ]}
          onChange={provider => onChange({ ...s, mt: { ...s.mt, provider } })}
        />
      </div>
      <p className="hint">首选服务连接失败时，会自动尝试另一家翻译服务。</p>
    </Section>
  )
}
