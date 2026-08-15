import { ExternalLink } from 'lucide-react'
import { useState } from 'react'
import { sendMessage } from '@/lib/messaging'
import type { Settings } from '@/lib/types'
import { HelpTip } from '../components/HelpTip'
import { Section } from '../components/Section'
import { Switch } from '../components/controls'
import type { SectionProps, Status } from './types'

interface AnkiSectionProps extends SectionProps {
  /** 探测结果要回传给侧边栏的状态徽章 */
  onAliveChange: (alive: boolean) => void
}

export function AnkiSection({ s, onChange, flush, onAliveChange }: AnkiSectionProps) {
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

  const patchAnki = (part: Partial<Settings['anki']>) =>
    onChange({ ...s, anki: { ...s.anki, ...part } })

  const onTest = async () => {
    setStatus({ kind: 'busy' })
    await flush()

    const res = await sendMessage({ type: 'check-anki' })
    if (!res || !res.ok) {
      onAliveChange(false)
      setStatus({ kind: 'err', text: res?.error ?? '扩展后台无响应，试试重新加载扩展。' })
      return
    }
    onAliveChange(true)

    // 连上了就顺手把模板刷成最新的；失败时把真实原因展示出来，方便排查坏模板
    const sync = await sendMessage({ type: 'sync-anki-templates' })
    if (sync?.ok) {
      setStatus({
        kind: 'ok',
        text: `连接正常（AnkiConnect v${res.data.version}），四模式卡片模板已同步。`,
      })
      return
    }

    setStatus({
      kind: 'err',
      text: sync?.error
        ? `Anki 已连接（v${res.data.version}），但模板同步失败：${sync.error}`
        : `Anki 已连接（v${res.data.version}），但模板同步无响应。请重新加载扩展后再试。`,
    })
  }

  return (
    <Section
      id="sec-anki"
      index={3}
      title="Anki 单词本"
      intro={(
        <>
          划词一键制卡并同步至本地 Anki。需安装
          <a href="https://apps.ankiweb.net/" target="_blank" rel="noreferrer"> Anki 桌面版</a>
          与 AnkiConnect 插件（插件代码 <code>2055492159</code>
          <HelpTip title="如何安装 AnkiConnect 插件？">
            <ol>
              <li>打开 Anki 桌面版客户端；</li>
              <li>点击菜单栏「工具」→「附加组件」→「获取附加组件」；</li>
              <li>填入代码 <strong>2055492159</strong> 并确定安装；</li>
              <li>重启 Anki 客户端并保持在后台运行。</li>
            </ol>
            <div className="help-tip-links">
              <a href="https://foosoft.net/projects/anki-connect/" target="_blank" rel="noreferrer">
                <span>AnkiConnect 官方项目主页</span>
                <ExternalLink size={11} />
              </a>
              <a href="https://git.sr.ht/~foosoft/anki-connect" target="_blank" rel="noreferrer">
                <span>源码仓库 (~foosoft/anki-connect)</span>
                <ExternalLink size={11} />
              </a>
            </div>
          </HelpTip>
          ），使用时保持 Anki 在后台运行。
        </>
      )}
    >
      <label className="field">
        <span>AnkiConnect 地址</span>
        <input value={s.anki.url} onChange={e => patchAnki({ url: e.target.value })} />
      </label>

      <label className="field">
        <span>目标牌组</span>
        <input value={s.anki.deckName} onChange={e => patchAnki({ deckName: e.target.value })} />
      </label>
      <p className="hint">
        不存在时会自动创建。卡片会自动生成 4 种子牌组独立复习：
        语境挖空 (Context)、看词识义 (Recognition)、看义写词 (Production)、听音辨义 (Listening)。
      </p>

      <label className="field">
        <span>笔记类型</span>
        <input
          value={s.anki.noteTypeName}
          onChange={e => patchAnki({ noteTypeName: e.target.value })}
        />
      </label>
      <p className="hint">默认「Word Catcher」，首次同步或建卡时会自动配置卡片字段与排版样式。</p>

      <div className="field">
        <span>原句挖空</span>
        <div className="field-inline">
          <Switch
            checked={s.anki.clozeContext}
            onChange={clozeContext => patchAnki({ clozeContext })}
          />
          <span className="field-inline-label">卡片正面隐去原句中的目标词</span>
        </div>
      </div>

      <div className="row">
        <button className="btn" onClick={() => void onTest()} disabled={status.kind === 'busy'}>
          {status.kind === 'busy' ? '检测中…' : '测试连接并同步卡片模板'}
        </button>
      </div>

      {status.kind === 'ok' && <p className="ok">{status.text}</p>}
      {status.kind === 'err' && (
        <div className="err">
          <p>{status.text}</p>
          <details>
            <summary>排查步骤</summary>
            <ol>
              <li>确认 Anki 桌面版正在运行（不是手机版或网页版）。</li>
              <li>
                「工具 → 附加组件」里确认有 AnkiConnect；没有则用代码
                <code>2055492159</code> 安装并重启。
              </li>
              <li>
                仍失败：选中 AnkiConnect →「配置」，在 <code>webCorsOriginList</code> 里
                加一项 <code>"*"</code>，重启 Anki。
              </li>
            </ol>
          </details>
        </div>
      )}
    </Section>
  )
}
