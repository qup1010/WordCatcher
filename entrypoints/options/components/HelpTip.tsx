import { HelpCircle, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

export interface HelpTipProps {
  title?: string
  children?: React.ReactNode
}

/**
 * 轻量悬浮帮助气泡 —— 不占用表单空间，支持鼠标悬停桥接与点击固定常驻
 */
export function HelpTip({ title, children }: HelpTipProps) {
  const [open, setOpen] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rootRef = useRef<HTMLSpanElement>(null)

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const handleMouseEnter = () => {
    clearTimer()
    setOpen(true)
  }

  const handleMouseLeave = () => {
    clearTimer()
    // 延时 200ms 关闭，给鼠标移入浮窗预留充足时间
    timerRef.current = setTimeout(() => {
      setOpen(false)
    }, 200)
  }

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        clearTimer()
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', onDocClick)
    return () => {
      document.removeEventListener('pointerdown', onDocClick)
      clearTimer()
    }
  }, [open])

  return (
    <span
      className="help-tip-root"
      ref={rootRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button
        type="button"
        className={`help-tip-btn ${open ? 'help-tip-btn-active' : ''}`}
        aria-label="查看安装说明"
        aria-expanded={open}
        onClick={(e) => {
          e.preventDefault()
          clearTimer()
          setOpen(v => !v)
        }}
      >
        <HelpCircle size={13} />
      </button>

      {open && (
        <div
          className="help-tip-pop"
          role="tooltip"
          onMouseEnter={clearTimer}
          onMouseLeave={handleMouseLeave}
        >
          <div className="help-tip-header">
            {title && <span className="help-tip-title">{title}</span>}
            <button
              type="button"
              className="help-tip-close"
              title="关闭"
              onClick={(e) => {
                e.stopPropagation()
                clearTimer()
                setOpen(false)
              }}
            >
              <X size={13} />
            </button>
          </div>
          <div className="help-tip-body">{children}</div>
        </div>
      )}
    </span>
  )
}
