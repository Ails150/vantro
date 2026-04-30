"use client"

/**
 * TradeMultiSelect.tsx
 * Reusable chip-style multiselect for assigning trades to jobs or installers.
 *
 * Props:
 *   trades       Array of available trades (already filtered to enabled-only by caller)
 *   selected     Array of selected trade_keys
 *   onChange     Called with the new array of trade_keys
 *   disabled     Optional — locks the control
 *   label        Optional heading
 *   helperText   Optional helper line under the heading
 *
 * Caller is responsible for only rendering this when multi_trade_enabled is true.
 * Caller is responsible for filtering `trades` to enabled trades only.
 */

type TradeOption = {
  trade_key: string
  label: string
}

type Props = {
  trades: TradeOption[]
  selected: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
  label?: string
  helperText?: string
}

export default function TradeMultiSelect({
  trades,
  selected,
  onChange,
  disabled,
  label,
  helperText,
}: Props) {
  function toggle(trade_key: string) {
    if (disabled) return
    if (selected.includes(trade_key)) {
      onChange(selected.filter((k) => k !== trade_key))
    } else {
      onChange([...selected, trade_key])
    }
  }

  if (!trades || trades.length === 0) {
    return (
      <div className="text-xs text-gray-500">
        No trades enabled. Enable trades in <span className="font-medium">Setup → Trades</span>.
      </div>
    )
  }

  return (
    <div>
      {label && (
        <div className="text-sm font-medium text-gray-900 mb-1">{label}</div>
      )}
      {helperText && (
        <div className="text-xs text-gray-500 mb-2">{helperText}</div>
      )}
      <div className="flex flex-wrap gap-2">
        {trades.map((t) => {
          const on = selected.includes(t.trade_key)
          return (
            <button
              key={t.trade_key}
              type="button"
              disabled={disabled}
              onClick={() => toggle(t.trade_key)}
              className={
                "px-3 py-1.5 rounded-full border text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed " +
                (on
                  ? "bg-teal-50 border-teal-300 text-teal-800 hover:bg-teal-100"
                  : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50")
              }
            >
              {on && <span className="mr-1">✓</span>}
              {t.label}
            </button>
          )
        })}
      </div>
      {selected.length > 0 && (
        <div className="text-xs text-gray-500 mt-2">
          {selected.length} selected
        </div>
      )}
    </div>
  )
}
