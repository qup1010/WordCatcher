import { Check, ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

export interface ComboboxProps {
  value: string
  options: string[]
  placeholder?: string
  open: boolean
  onOpenChange: (v: boolean) => void
  onChange: (v: string) => void
}

/**
 * 可输入的下拉选择器。
 *
 * 原生 `<input list>` + `<datalist>` 在 Chrome 里没有可点的下拉箭头，
 * 只在输入内容恰好匹配时才偶尔弹出，实际上等于不可用，所以自己实现。
 */
export function Combobox({
  value,
  options,
  placeholder,
  open,
  onOpenChange,
  onChange,
}: ComboboxProps) {
  const [highlight, setHighlight] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const q = value.trim().toLowerCase()
  // 输入内容正好是某个选项时展示全部，方便直接换一个
  const shown = options.includes(value.trim())
    ? options
    : options.filter(o => o.toLowerCase().includes(q))

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onOpenChange(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open, onOpenChange])

  useEffect(() => {
    if (!open) return
    ;(listRef.current?.children[highlight] as HTMLElement | undefined)
      ?.scrollIntoView({ block: 'nearest' })
  }, [highlight, open])

  const commit = (v: string) => {
    onChange(v)
    onOpenChange(false)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) return onOpenChange(true)
      setHighlight(h => Math.min(h + 1, shown.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight(h => Math.max(h - 1, 0))
    } else if (e.key === 'Enter' && open && shown[highlight]) {
      e.preventDefault()
      commit(shown[highlight])
    } else if (e.key === 'Escape') {
      onOpenChange(false)
    }
  }

  return (
    <div className="combo" ref={rootRef}>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value)
          setHighlight(0)
          if (options.length) onOpenChange(true)
        }}
        onKeyDown={onKeyDown}
      />
      {options.length > 0 && (
        <button
          type="button"
          className="combo-toggle"
          tabIndex={-1}
          title={open ? '收起' : `展开 ${options.length} 个模型`}
          onClick={() => {
            onOpenChange(!open)
            setHighlight(0)
          }}
        >
          <ChevronDown size={14} className={open ? 'flip' : ''} />
        </button>
      )}
      {open && shown.length > 0 && (
        <ul className="combo-list" ref={listRef}>
          {shown.map((o, i) => (
            <li
              key={o}
              className={`combo-item ${i === highlight ? 'on' : ''}`}
              onMouseEnter={() => setHighlight(i)}
              // mousedown 而非 click：避免输入框先失焦导致列表被关掉
              onMouseDown={(e) => {
                e.preventDefault()
                commit(o)
              }}
            >
              <span>{o}</span>
              {o === value.trim() && <Check size={13} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
