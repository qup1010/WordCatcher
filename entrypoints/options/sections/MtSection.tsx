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
      intro={<>划词后点击 <Zap size={13} className="inline-icon" /> 触发即时翻译，免配置且不消耗 AI 额度。长句或离线词典未收录词将自动调用此处的在线服务。</>}
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
      <p className="hint">微软翻译在国内网络环境更稳定；首选服务网络异常时会自动平滑切换至另一家。</p>
    </Section>
  )
}
