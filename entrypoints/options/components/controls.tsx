/**
 * 设置页里替代原生控件的三个小组件。
 *
 * 原生 radio / checkbox 在各平台上的观感差异很大，而且没法和这套
 * 「暖纸 + 墨青」的视觉统一，所以自己实现，但保留 role / aria 让键盘和读屏可用。
 */

export interface StatusChipProps {
  ok: boolean
  okText: string
  badText: string
}

export function StatusChip({ ok, okText, badText }: StatusChipProps) {
  return <span className={`chip ${ok ? 'chip-ok' : 'chip-bad'}`}>{ok ? okText : badText}</span>
}

export interface SegmentedProps<T extends string> {
  value: T
  options: Array<{ value: T, label: string }>
  onChange: (v: T) => void
}

/** 分段选择控件（替代原生 radio） */
export function Segmented<T extends string>({ value, options, onChange }: SegmentedProps<T>) {
  return (
    <div className="seg" role="radiogroup">
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? 'seg-on' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export interface SwitchProps {
  checked: boolean
  onChange: (v: boolean) => void
}

/** 开关控件（替代原生 checkbox） */
export function Switch({ checked, onChange }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={`switch ${checked ? 'switch-on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-knob" />
    </button>
  )
}
