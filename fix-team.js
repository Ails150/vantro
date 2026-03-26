const fs = require("fs")
let c = fs.readFileSync("components/admin/AdminDashboard.tsx", "utf8")

// Add team action functions after addMember
c = c.replace(
  "  async function toggleAssignment",
  `  async function removeMember(userId: string, authUserId: string) {
    if (!window.confirm("Remove this installer from your team? This cannot be undone.")) return
    await supabase.from("users").delete().eq("id", userId)
    if (authUserId) {
      await fetch("/api/team/remove", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ authUserId }) })
    }
    router.refresh()
  }

  async function resendInvite(email: string, name: string) {
    const res = await fetch("/api/invite", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, name }) })
    if (res.ok) { alert("Invite sent to " + email) }
    else { const d = await res.json(); alert("Failed: " + d.error) }
  }

  async function resetPin(userId: string) {
    if (!window.confirm("Reset this installer PIN? They will need to set a new one.")) return
    await supabase.from("users").update({ pin_hash: null }).eq("id", userId)
    alert("PIN reset. They will need to set a new PIN on next login.")
  }

  async function toggleActive(userId: string, current: boolean) {
    await supabase.from("users").update({ is_active: !current }).eq("id", userId)
    router.refresh()
  }

  async function toggleAssignment`
)

// Replace team member list with management UI
c = c.replace(
  `              : teamMembers.map((m: any) => (
                <div key={m.id} className="flex items-center gap-4 px-6 py-5 border-b border-gray-50 last:border-0">
                  <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center font-bold flex-shrink-0">{m.initials}</div>
                  <div className="flex-1"><div className="font-semibold">{m.name}</div><div className={"text-sm " + sub + " mt-0.5"}>{m.email || "No email"}</div></div>
                  <span className="text-sm bg-gray-100 text-gray-600 px-3 py-1 rounded-full capitalize font-medium">{m.role}</span>
                </div>
              ))}`,
  `              : teamMembers.map((m: any) => (
                <div key={m.id} className="border-b border-gray-50 last:border-0">
                  <div className="flex items-center gap-4 px-6 py-5">
                    <div className={"w-10 h-10 rounded-full flex items-center justify-center font-bold flex-shrink-0 " + (m.is_active === false ? "bg-gray-100 text-gray-400" : "bg-gray-100 text-gray-900")}>{m.initials}</div>
                    <div className="flex-1">
                      <div className={"font-semibold " + (m.is_active === false ? "text-gray-400" : "")}>{m.name}</div>
                      <div className={"text-sm mt-0.5 " + sub}>{m.email || "No email"}</div>
                      {m.is_active === false && <span className="text-xs text-amber-500">Suspended</span>}
                      {!m.pin_hash && m.role === "installer" && <span className="text-xs text-red-400 ml-2">PIN not set</span>}
                    </div>
                    <span className="text-sm bg-gray-100 text-gray-600 px-3 py-1 rounded-full capitalize font-medium flex-shrink-0">{m.role}</span>
                    {m.role === "installer" && (
                      <div className="flex gap-2">
                        <button onClick={() => resendInvite(m.email, m.name)} className="text-xs border border-gray-200 text-gray-600 hover:border-teal-300 hover:text-teal-600 rounded-lg px-3 py-1.5 transition-colors">Resend invite</button>
                        <button onClick={() => resetPin(m.id)} className="text-xs border border-gray-200 text-gray-600 hover:border-amber-300 hover:text-amber-600 rounded-lg px-3 py-1.5 transition-colors">Reset PIN</button>
                        <button onClick={() => toggleActive(m.id, m.is_active !== false)} className={"text-xs border rounded-lg px-3 py-1.5 transition-colors " + (m.is_active === false ? "border-teal-200 text-teal-600 hover:bg-teal-50" : "border-gray-200 text-gray-600 hover:border-amber-300 hover:text-amber-600")}>{m.is_active === false ? "Reactivate" : "Suspend"}</button>
                        <button onClick={() => removeMember(m.id, m.auth_user_id)} className="text-xs border border-red-200 text-red-500 hover:bg-red-50 rounded-lg px-3 py-1.5 transition-colors">Remove</button>
                      </div>
                    )}
                  </div>
                </div>
              ))}`
)

fs.writeFileSync("components/admin/AdminDashboard.tsx", c, "utf8")
console.log("Done")
