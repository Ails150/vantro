const fs = require("fs")

// Update admin page to fetch QA approvals
let page = fs.readFileSync("app/admin/page.tsx", "utf8")
page = page.replace(
  "const { data: pendingQA } = await supabase.from('qa_submissions').select('*, jobs(name), users(name, initials)').eq('company_id', companyId).eq('state', 'submitted').order('submitted_at', { ascending: false })",
  "const { data: pendingQA } = await supabase.from('qa_approvals').select('*, jobs(name, address), users(name, initials)').eq('company_id', companyId).eq('status', 'pending').order('submitted_at', { ascending: false })"
)
fs.writeFileSync("app/admin/page.tsx", page, "utf8")

// Update Approvals tab in dashboard
let dash = fs.readFileSync("components/admin/AdminDashboard.tsx", "utf8")

dash = dash.replace(
  `        {activeTab === "approvals" && (
          <div className={card}>
            <div className={cardHeader}><span className="font-semibold">QA approval queue</span></div>
            {pendingQA.length === 0 ? <div className={"px-6 py-16 text-center " + sub}>Nothing waiting for approval</div>
            : pendingQA.map((qa: any) => (
              <div key={qa.id} className="px-6 py-5 border-b border-gray-50 last:border-0">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-3 mb-1">
                      <div className="w-8 h-8 rounded-full bg-teal-50 flex items-center justify-center text-sm font-bold text-teal-600">{qa.users?.initials || "?"}</div>
                      <span className="font-semibold">{qa.users?.name}</span>
                      <span className={"text-sm " + sub}>on {qa.jobs?.name}</span>
                    </div>
                    {qa.notes && <div className={"text-sm " + sub}>Note: {qa.notes}</div>}
                  </div>
                  <div className="flex gap-3">
                    <button onClick={() => approveQA(qa.id)} className="bg-teal-50 hover:bg-teal-100 text-teal-700 border border-teal-200 rounded-xl px-4 py-2 text-sm font-semibold">Approve</button>
                    <button onClick={() => { const note = window.prompt("Rejection reason:"); if (note) rejectQA(qa.id, note) }} className="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 rounded-xl px-4 py-2 text-sm font-semibold">Reject</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}`,
  `        {activeTab === "approvals" && (
          <ApprovalsTab pendingQA={pendingQA} onRefresh={() => router.refresh()} />
        )}`
)

fs.writeFileSync("components/admin/AdminDashboard.tsx", dash, "utf8")
console.log("Done - " + (dash.includes("ApprovalsTab") ? "SUCCESS" : "FAILED"))
