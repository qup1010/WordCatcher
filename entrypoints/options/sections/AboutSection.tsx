import { ExternalLink, MessageSquare, ShieldCheck, Sparkles } from 'lucide-react'
import { Section } from '../components/Section'
import type { SectionProps } from './types'

function GithubIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
      />
    </svg>
  )
}

export function AboutSection(_props: SectionProps) {
  return (
    <Section
      id="sec-about"
      index={6}
      title="关于本插件"
      intro={<>Word Catcher 是一个开源的网页划词查词与 Anki 快速联动扩展。</>}
    >
      <div className="about-card" style={{
        padding: '16px 18px',
        background: 'var(--card)',
        border: '1px solid var(--hairline)',
        borderRadius: 'var(--r-lg)',
        boxShadow: 'var(--shadow-card)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--font-serif)', color: 'var(--ink)' }}>
              Word Catcher <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--teal)', fontFamily: 'var(--font-sans)', background: 'var(--teal-wash)', padding: '2px 8px', borderRadius: 'var(--r-sm)', border: '1px solid var(--hairline)', marginLeft: 6 }}>v0.1.1</span>
            </div>
            <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.6 }}>
              聚焦真实阅读流：提供即时机翻、本地离线词库与 AI 语境释义，并支持一键将生词、例句及记忆线索同步至本地 Anki 单词本。
            </p>
          </div>
        </div>

        <div style={{
          marginTop: 14,
          paddingTop: 12,
          borderTop: '1px solid var(--hairline)',
          display: 'flex',
          gap: 12,
          flexWrap: 'wrap',
        }}>
          <a
            href="https://github.com/qup1010/WordCatcher"
            target="_blank"
            rel="noreferrer"
            className="btn btn-primary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}
          >
            <GithubIcon size={15} />
            <span>GitHub 仓库主页</span>
            <ExternalLink size={12} style={{ opacity: 0.7 }} />
          </a>

          <a
            href="https://github.com/qup1010/WordCatcher/releases"
            target="_blank"
            rel="noreferrer"
            className="btn btn-ghost"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}
          >
            <Sparkles size={14} />
            <span>版本发布 (Releases)</span>
            <ExternalLink size={12} style={{ opacity: 0.7 }} />
          </a>

          <a
            href="https://github.com/qup1010/WordCatcher/issues"
            target="_blank"
            rel="noreferrer"
            className="btn btn-ghost"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}
          >
            <MessageSquare size={14} />
            <span>反馈建议与 Issue</span>
            <ExternalLink size={12} style={{ opacity: 0.7 }} />
          </a>
        </div>
      </div>

      <div style={{
        marginTop: 16,
        padding: '12px 16px',
        background: 'var(--sunken)',
        borderRadius: 'var(--r-md)',
        border: '1px solid var(--hairline)',
        fontSize: 12.5,
        color: 'var(--ink-soft)',
        lineHeight: 1.7,
      }}>
        <div style={{ fontWeight: 600, color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <ShieldCheck size={14} color="var(--teal)" />
          <span>开源许可与致谢 (Licenses & Acknowledgments)</span>
        </div>
        <div>
          本扩展基于 <strong>MIT License</strong> 开源。特别鸣谢以下开源项目提供的支持：
        </div>
        <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
          <li>
            <a href="https://github.com/ahpxex/open-dictionary" target="_blank" rel="noreferrer" style={{ color: 'var(--teal)', textDecoration: 'none' }}>
              <strong>Open Dictionary</strong>
            </a> (@ahpxex)：提供开源离线词典数据源（CC BY-SA 4.0 许可）。
          </li>
          <li>
            <a href="https://git.sr.ht/~foosoft/anki-connect" target="_blank" rel="noreferrer" style={{ color: 'var(--teal)', textDecoration: 'none' }}>
              <strong>Anki-Connect</strong>
            </a> (@FooSoft)：提供与本地 Anki 桌面端通信的 API 桥梁。
          </li>
        </ul>
      </div>
    </Section>
  )
}
