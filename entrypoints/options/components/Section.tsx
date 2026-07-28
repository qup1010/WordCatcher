import type { ReactNode } from 'react'

export interface SectionProps {
  id: string
  title: string
  /** 标题下的一句说明，放在卡片外面 */
  intro?: ReactNode
  /** 入场动画的错峰序号 */
  index: number
  children: ReactNode
}

/**
 * 分区外壳：标题 + 说明在外，表单装进卡片。
 *
 * 表单必须有自己的底色。四个分区平铺在同一张暖纸上时，往下滚是一片连续的米色，
 * 分区之间只靠一条下划线和 52px 间距区分，扫一眼分不清哪个字段属于哪块。
 */
export function Section({ id, title, intro, index, children }: SectionProps) {
  return (
    <section id={id} style={{ '--i': index } as React.CSSProperties}>
      <h2>{title}</h2>
      {intro && <p className="muted">{intro}</p>}
      <div className="card">{children}</div>
    </section>
  )
}
