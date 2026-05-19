"use client"

import { useEffect, useState } from "react"

interface UserRow {
  id: string
  name: string
  email: string
  role: string
  email_alert_prefs: { enabled: boolean; blockers: boolean; issues: boolean } | null
}

export function EmailAlertPrefs() {
  const [users, setUsers] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    const res = await fetch("/api/admin/email-prefs")
    const data = await res.json()
    setUsers(data.users || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function update(userId: string, patch: Partial<{ enabled: boolean; blockers: boolean; issues: boolean }>) {
    setSaving(userId)
    const current = users.find(u => u.id === userId)?.email_alert_prefs || { enabled: true, blockers: true, issues: true }
    const merged = { ...current, ...patch }

    // Optimistic update
    setUsers(us => us.map(u => u.id === userId ? { ...u, email_alert_prefs: merged } : u))

    const res = await fetch("/api/admin/email-prefs", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, prefs: merged })
    })

    if (!res.ok) {
      // Revert on failure
      await load()
    }
    setSaving(null)
  }

  if (loading) return <div className="p-4 text-sm text-gray-500">Loading email preferences...</div>

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
        <h3 className="text-sm font-semibold text-gray-900">Email alert preferences</h3>
        <p className="text-xs text-gray-500 mt-1">
          Choose who gets email when a blocker or issue is flagged from a diary entry.
          Rate-limited to one email per job per hour per person.
        </p>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-xs uppercase text-gray-500">
          <tr>
            <th className="text-left px-4 py-2">Name</th>
            <th className="text-left px-4 py-2">Role</th>
            <th className="text-center px-2 py-2">Emails on</th>
            <th className="text-center px-2 py-2">Blockers</th>
            <th className="text-center px-2 py-2">Issues</th>
          </tr>
        </thead>
        <tbody>
          {users.map(u => {
            const prefs = u.email_alert_prefs || { enabled: true, blockers: true, issues: true }
            const disabled = saving === u.id
            return (
              <tr key={u.id} className="border-t border-gray-100">
                <td className="px-4 py-2">
                  <div className="font-medium text-gray-900">{u.name}</div>
                  <div className="text-xs text-gray-500">{u.email}</div>
                </td>
                <td className="px-4 py-2 text-xs uppercase text-gray-500">{u.role}</td>
                <td className="text-center px-2 py-2">
                  <input
                    type="checkbox"
                    checked={prefs.enabled !== false}
                    disabled={disabled}
                    onChange={e => update(u.id, { enabled: e.target.checked })}
                  />
                </td>
                <td className="text-center px-2 py-2">
                  <input
                    type="checkbox"
                    checked={prefs.blockers !== false && prefs.enabled !== false}
                    disabled={disabled || prefs.enabled === false}
                    onChange={e => update(u.id, { blockers: e.target.checked })}
                  />
                </td>
                <td className="text-center px-2 py-2">
                  <input
                    type="checkbox"
                    checked={prefs.issues !== false && prefs.enabled !== false}
                    disabled={disabled || prefs.enabled === false}
                    onChange={e => update(u.id, { issues: e.target.checked })}
                  />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
