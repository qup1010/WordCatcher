import { PREVIEW_SAMPLE } from '@/lib/ai'
import type { WordEntry } from '@/lib/types'

/**
 * 「测试 AI」成功后展示的词条卡预览。
 *
 * 用真实生成的结果而不是写死的假数据：这一屏同时回答了三个问题——
 * 接口通不通、这个模型的释义质量如何、划词之后到底会看到什么。
 * 光给一句"连接正常"，用户还是得自己去网页上划一次才知道配对没配对。
 */
export function SamplePreview({ entry }: { entry: WordEntry }) {
  const { selection, sentence } = PREVIEW_SAMPLE
  const at = sentence.indexOf(selection)

  return (
    <div className="sample">
      <div className="sample-src">
        {at < 0 ? sentence : (
          <>
            {sentence.slice(0, at)}
            <mark>{selection}</mark>
            {sentence.slice(at + selection.length)}
          </>
        )}
      </div>

      <div>
        <span className="sample-word">{entry.word}</span>
        {entry.reading && <span className="sample-reading"> /{entry.reading}/</span>}
        {entry.partOfSpeech && <span className="sample-pos"> {entry.partOfSpeech}</span>}
      </div>

      <div>{entry.definition}</div>
      {entry.contextTranslation && (
        <div className="sample-trans">{entry.contextTranslation}</div>
      )}
    </div>
  )
}
