"use client"

import { useState } from "react"
import {
  VERTICAL_OPTIONS,
  VERTICAL_QUESTION,
  toVertical,
  type Vertical,
} from "@/lib/vertical"

type Props = {
  number: number
  vertical: Vertical
  onChange: (vertical: Vertical) => void
}

/**
 * Step one of the setup wizard. Five options, plain language, and the choice
 * is written to companies.vertical the moment it is made rather than on a
 * Continue button: every later step, template and default reads from it, so
 * the wizard must never be a step ahead of the stored value.
 *
 * There is always a valid answer here (install is the column default), so this
 * step never locks the steps below it. Picking again is one click.
 */
export default function VerticalStep({ number, vertical, onChange }: Props) {
  const [saving, setSaving] = useState<Vertical | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function select(next: Vertical) {
    if (next === vertical || saving) return
    setSaving(next)
    setError(null)
    const res = await fetch("/api/admin/setup/vertical", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vertical: next }),
    }).catch(() => null)

    if (!res?.ok) {
      const j = await res?.json().catch(() => ({}))
      setError(j?.error || "Could not save that. Try again.")
      setSaving(null)
      return
    }
    // Only move the UI once the write landed, so what is on screen and what is
    // in the column can never disagree.
    onChange(toVertical(next))
    setSaving(null)
  }

  return (
    <div className="rounded-2xl border border-teal-400 bg-white p-5 shadow-md">
      <div className="flex items-start gap-4">
        <div className="w-9 h-9 rounded-full bg-teal-500 text-white flex items-center justify-center flex-shrink-0 font-semibold text-sm">
          {number}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-gray-900">{VERTICAL_QUESTION}</h3>
          <p className="text-sm text-gray-600 mt-0.5">
            This sets the wording and the tabs across the whole app. You can change it later in settings.
          </p>

          <div className="mt-4 space-y-2">
            {VERTICAL_OPTIONS.map(option => {
              const isSelected = option.value === vertical
              const isSaving = saving === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => select(option.value)}
                  disabled={saving !== null}
                  aria-pressed={isSelected}
                  className={
                    "w-full text-left rounded-xl border px-4 py-3 flex items-center gap-3 transition-colors disabled:opacity-60 " +
                    (isSelected
                      ? "border-teal-400 bg-teal-50"
                      : "border-gray-200 hover:border-gray-300 hover:bg-gray-50")
                  }
                >
                  <span
                    className={
                      "w-4 h-4 rounded-full border-2 flex-shrink-0 " +
                      (isSelected ? "border-teal-500 bg-teal-500" : "border-gray-300")
                    }
                  />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium text-gray-900">{option.label}</span>
                    <span className="block text-xs text-gray-500 mt-0.5">{option.sublabel}</span>
                  </span>
                  {isSaving && <span className="text-xs text-gray-500 flex-shrink-0">Saving...</span>}
                </button>
              )
            })}
          </div>

          {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
        </div>
      </div>
    </div>
  )
}
