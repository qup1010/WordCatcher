import type { QuickDictResult, DictExample } from '../open-dict/types'
import { formatPosLabel } from '../open-dict/db'

function Examples({ items }: { items: DictExample[] }) {
  return <>{items.map((example, index) => <blockquote className="dict-view-example" key={index}>
    <div>{example.text}</div>{example.translation && <div className="dict-view-translation">{example.translation}</div>}
  </blockquote>)}</>
}

export function DictionaryView({ result }: { result: QuickDictResult }) {
  const count = result.allPosGroups.reduce((sum, group) => sum + group.meanings.length, 0)
  return <div className="dict-view">
    <div className="dict-view-summary">{result.coreGroups.map((group, index) => <div className="dict-view-group" key={index}>
      <span className="dict-view-pos">{group.pos}{group.properName && ' · 专名'}</span><div className="dict-view-meanings">{group.meanings.join('；')}</div>
    </div>)}</div>
    {count > 0 && <details className="dict-view-details"><summary>完整释义（{count}）</summary>
      {result.allPosGroups.map((group, index) => <section key={index}>
        <h4>{formatPosLabel(group.pos)}{(group.proper_name || ['name', 'name.', 'proper noun', 'surname'].includes(group.pos.toLowerCase())) && ' · 专名'}</h4>
        {group.meanings.map((meaning, i) => {
          const heading = meaning.short_gloss?.trim() ? meaning.short_gloss : meaning.learner_explanation || ''
          const explanation = meaning.learner_explanation?.trim() !== heading.trim() ? meaning.learner_explanation : undefined
          const priority = meaning.priority?.trim().toLowerCase()
          const examples = meaning.examples || []
          return <div className="dict-view-sense" key={meaning.sense_id || i}>
            <div className="dict-view-heading"><strong>{i + 1}. {heading}</strong><span>{priority === 'core' ? '核心' : priority === 'rare' ? '少见' : '常用'}</span></div>
            {explanation && <p>{explanation}</p>}
            <Examples items={examples.slice(0, 1)} />
            {examples.length > 1 && <details className="dict-view-more"><summary>更多例句（{examples.length - 1}）</summary><Examples items={examples.slice(1)} /></details>}
            {meaning.usage_note && <p className="dict-view-translation">用法提示：{meaning.usage_note}</p>}
          </div>
        })}
      </section>)}
    </details>}
  </div>
}
