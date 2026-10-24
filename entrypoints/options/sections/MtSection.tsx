import { EXPLAIN_LANGUAGES } from '../presets'
import { Section } from '../components/Section'
import { Segmented } from '../components/controls'
import type { SectionProps } from './types'

export function MtSection({ s, onChange }: SectionProps) {
  return <Section id="sec-mt" index={0} title="查词与翻译" intro="先查已安装的离线词典，未收录的单词和句子使用在线快译。在线快译无需配置 AI。">
    <div className="field"><span>在线快译服务</span><Segmented value={s.mt.provider} options={[{value:'microsoft',label:'微软翻译'},{value:'google',label:'谷歌翻译'}]} onChange={provider => onChange({...s,mt:{...s.mt,provider}})} /></div>
    <label className="field"><span>目标语言</span><select value={s.explainLanguage} onChange={e => onChange({...s,explainLanguage:e.target.value})}>{EXPLAIN_LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}</select></label>
    <p className="hint">在线快译、原句翻译和 AI 详解使用此语言；离线释义的语言由词典数据决定。</p>
  </Section>
}
