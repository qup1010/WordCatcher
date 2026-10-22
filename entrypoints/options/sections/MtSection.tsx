import { EXPLAIN_LANGUAGES } from '../presets'
import { Section } from '../components/Section'
import { Segmented } from '../components/controls'
import type { SectionProps } from './types'

export function MtSection({ s, onChange }: SectionProps) {
  return <Section id="sec-mt" index={0} title="查词与翻译" intro="单词优先查询离线词典；未命中的单词与句子使用所选在线快译。AI 由你主动调用。">
    <div className="field"><span>在线快译服务</span><Segmented value={s.mt.provider} options={[{value:'microsoft',label:'微软翻译'},{value:'google',label:'谷歌翻译'}]} onChange={provider => onChange({...s,mt:{...s.mt,provider}})} /></div>
    <label className="field"><span>目标语言</span><select value={s.explainLanguage} onChange={e => onChange({...s,explainLanguage:e.target.value})}>{EXPLAIN_LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}</select></label>
    <p className="hint">查词、翻译原句和 AI 详解使用相同的目标语言。在线快译失败时可重试或主动改用 AI。</p>
  </Section>
}
