const fs = require("fs")
let c = fs.readFileSync("components/admin/PayrollTab.tsx", "utf8")

// Add editing state
c = c.replace(
  "  const [expandedId, setExpandedId] = useState<string|null>(null)",
  `  const [expandedId, setExpandedId] = useState<string|null>(null)
  const [editingSignin, setEditingSignin] = useState<string|null>(null)
  const [editSigninTime, setEditSigninTime] = useState("")
  const [editSignoutTime, setEditSignoutTime] = useState("")
  const [editSaving, setEditSaving] = useState(false)`
)

// Add edit function
c = c.replace(
  "  function getInstallerSignins",
  `  async function saveSigninEdit(signinId: string) {
    setEditSaving(true)
    await fetch("/api/payroll/edit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signinId, signed_in_at: editSigninTime, signed_out_at: editSignoutTime || null })
    })
    setEditingSignin(null)
    setEditSaving(false)
    fetchPayroll()
  }

  function getInstallerSignins`
)

// Add edit button and form to each signin record in expanded view
c = c.replace(
  `                  <div className="bg-gray-50 rounded-xl p-4">
                    <div className="text-sm font-semibold mb-3">By day</div>
                    {Object.keys(byDay).length === 0 ? <div className={"text-sm " + sub}>No data</div>
                    : Object.entries(byDay).map(([day, hrs]) => (
                      <div key={day} className="flex justify-between py-1.5 border-b border-gray-100 last:border-0">
                        <span className="text-sm text-gray-600">{day}</span>
                        <span className="text-sm font-semibold">{(hrs as number).toFixed(1)}h</span>
                      </div>
                    ))}
                  </div>`,
  `                  <div className="bg-gray-50 rounded-xl p-4">
                    <div className="text-sm font-semibold mb-3">Sessions</div>
                    {ms.length === 0 ? <div className={"text-sm " + sub}>No sessions</div>
                    : ms.map((s: any) => (
                      <div key={s.id} className="py-2 border-b border-gray-100 last:border-0">
                        {editingSignin === s.id ? (
                          <div className="space-y-2">
                            <div className="flex gap-2 items-center">
                              <span className="text-xs text-gray-500 w-16">Sign in</span>
                              <input type="datetime-local" value={editSigninTime} onChange={e => setEditSigninTime(e.target.value)} className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:border-teal-400"/>
                            </div>
                            <div className="flex gap-2 items-center">
                              <span className="text-xs text-gray-500 w-16">Sign out</span>
                              <input type="datetime-local" value={editSignoutTime} onChange={e => setEditSignoutTime(e.target.value)} className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:border-teal-400"/>
                            </div>
                            <div className="flex gap-2">
                              <button onClick={() => saveSigninEdit(s.id)} disabled={editSaving} className="text-xs bg-teal-400 text-white rounded-lg px-3 py-1 font-medium">{editSaving ? "Saving..." : "Save"}</button>
                              <button onClick={() => setEditingSignin(null)} className="text-xs bg-gray-100 text-gray-600 rounded-lg px-3 py-1">Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex justify-between items-center">
                            <div>
                              <div className="text-xs text-gray-600">{new Date(s.signed_in_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
                              <div className="text-xs text-gray-400">{s.signed_out_at ? "Out: " + new Date(s.signed_out_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "Not signed out"}</div>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-semibold">{s.signed_out_at ? ((new Date(s.signed_out_at).getTime() - new Date(s.signed_in_at).getTime()) / 3600000).toFixed(1) + "h" : "-"}</span>
                              <button onClick={() => { setEditingSignin(s.id); setEditSigninTime(s.signed_in_at.slice(0,16)); setEditSignoutTime(s.signed_out_at ? s.signed_out_at.slice(0,16) : "") }} className="text-xs text-gray-400 hover:text-teal-600 border border-gray-200 rounded-lg px-2 py-0.5">Edit</button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>`
)

fs.writeFileSync("components/admin/PayrollTab.tsx", c, "utf8")
console.log("Done - " + (c.includes("saveSigninEdit") ? "SUCCESS" : "FAILED"))
