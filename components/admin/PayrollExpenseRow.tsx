"use client"

import { useEffect, useState } from "react"

interface Expense {
  id: string
  amount: number
  vat_amount: number | null
  category: string
  note: string | null
  receipt_signed_url: string | null
  receipt_mime: string
  status: "submitted" | "approved" | "rejected" | "queried" | "paid"
  submitted_at: string
  reviewed_at: string | null
  review_note: string | null
  paid_at: string | null
  job_id: string | null
  user_id: string
  user_name: string
  job_name: string | null
}

interface PayrollExpenseRowProps {
  userId: string
  userName: string
  weekStart: string  // YYYY-MM-DD
}

const CATEGORY_LABELS: Record<string, string> = {
  fuel: "Fuel",
  materials: "Materials",
  food: "Food",
  parking: "Parking",
  tools: "Tools",
  other: "Other",
}

const STATUS_COLOURS: Record<string, string> = {
  submitted: "#9ca3af",
  approved: "#10b981",
  rejected: "#dc2626",
  queried: "#d97706",
  paid: "#3b82f6",
}

export function PayrollExpenseRow({ userId, userName, weekStart }: PayrollExpenseRowProps) {
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [expanded, setExpanded] = useState(false)
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState<string | null>(null)
  const [viewingReceipt, setViewingReceipt] = useState<Expense | null>(null)

  async function load() {
    setLoading(true)
    const res = await fetch(`/api/admin/expenses?weekStart=${weekStart}`)
    const data = await res.json()
    setExpenses((data.expenses || []).filter((e: Expense) => e.user_id === userId))
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [userId, weekStart])

  async function updateStatus(expenseId: string, status: string, reviewNote?: string) {
    setActing(expenseId)
    const res = await fetch("/api/admin/expenses", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expenseId, status, reviewNote }),
    })
    if (res.ok) await load()
    setActing(null)
  }

  const total = expenses.reduce((sum, e) => sum + Number(e.amount), 0)
  const count = expenses.length

  if (loading) {
    return <div className="text-xs text-gray-400 mt-1">Loading expenses…</div>
  }
  if (count === 0) {
    return <div className="text-xs text-gray-400 mt-1">No expenses this week</div>
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="flex items-center gap-2 text-sm text-gray-700 hover:text-gray-900 cursor-pointer"
      >
        <span className="font-medium">Expenses:</span>
        <span className="font-semibold">£{total.toFixed(2)}</span>
        <span className="text-gray-500">({count} receipt{count !== 1 ? "s" : ""})</span>
        <span className="text-gray-400">{expanded ? "▾" : "▸"}</span>
      </button>

      {expanded && (
        <div className="mt-2 ml-4 border-l-2 border-gray-200 pl-4 space-y-2">
          {expenses.map(expense => (
            <div key={expense.id} className="bg-gray-50 rounded-lg p-3 flex items-start gap-3">
              {/* Receipt thumbnail */}
              {expense.receipt_signed_url ? (
                expense.receipt_mime === "application/pdf" ? (
                  <a
                    href={expense.receipt_signed_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-16 h-16 bg-gray-200 rounded flex items-center justify-center text-xs font-medium text-gray-700"
                  >
                    PDF
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={() => setViewingReceipt(expense)}
                    className="w-16 h-16 rounded overflow-hidden bg-gray-200 flex-shrink-0"
                  >
                    <img
                      src={expense.receipt_signed_url}
                      alt="Receipt"
                      className="w-full h-full object-cover"
                    />
                  </button>
                )
              ) : (
                <div className="w-16 h-16 bg-gray-200 rounded flex items-center justify-center text-xs text-gray-500">
                  No image
                </div>
              )}

              {/* Details */}
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="font-semibold text-gray-900">£{Number(expense.amount).toFixed(2)}</span>
                  <span className="text-xs text-gray-600">{CATEGORY_LABELS[expense.category] || expense.category}</span>
                  <span
                    className="text-xs px-2 py-0.5 rounded-full text-white"
                    style={{ background: STATUS_COLOURS[expense.status] || "#9ca3af" }}
                  >
                    {expense.status}
                  </span>
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {new Date(expense.submitted_at).toLocaleDateString("en-GB", {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                  })}
                  {expense.job_name && <span> · {expense.job_name}</span>}
                </div>
                {expense.note && (
                  <div className="text-xs text-gray-700 mt-1 italic">"{expense.note}"</div>
                )}
                {expense.review_note && (
                  <div className="text-xs text-gray-700 mt-1">
                    <span className="text-gray-500">Note:</span> {expense.review_note}
                  </div>
                )}

                {/* Action buttons - only on submitted/queried */}
                {(expense.status === "submitted" || expense.status === "queried") && (
                  <div className="flex gap-1 mt-2">
                    <button
                      type="button"
                      onClick={() => updateStatus(expense.id, "approved")}
                      disabled={acting === expense.id}
                      className="text-xs px-2 py-1 bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const note = prompt("Why are you rejecting this?")
                        if (note) updateStatus(expense.id, "rejected", note)
                      }}
                      disabled={acting === expense.id}
                      className="text-xs px-2 py-1 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
                    >
                      Reject
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const note = prompt("What's your question?")
                        if (note) updateStatus(expense.id, "queried", note)
                      }}
                      disabled={acting === expense.id}
                      className="text-xs px-2 py-1 bg-amber-500 text-white rounded hover:bg-amber-600 disabled:opacity-50"
                    >
                      Query
                    </button>
                  </div>
                )}

                {expense.status === "approved" && (
                  <div className="flex gap-1 mt-2">
                    <button
                      type="button"
                      onClick={() => updateStatus(expense.id, "paid")}
                      disabled={acting === expense.id}
                      className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                    >
                      Mark Paid
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Full-size receipt viewer modal */}
      {viewingReceipt && viewingReceipt.receipt_signed_url && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={() => setViewingReceipt(null)}
        >
          <img
            src={viewingReceipt.receipt_signed_url}
            alt="Receipt"
            className="max-w-full max-h-full rounded-lg"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  )
}
