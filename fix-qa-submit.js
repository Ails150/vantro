const fs = require("fs")
let c = fs.readFileSync("C:/vantro/app/installer/jobs/page.tsx", "utf8")

// Add QA submission function
c = c.replace(
  "  function signOut() {",
  `  async function submitQAForApproval() {
    const token = localStorage.getItem('vantro_installer_token')
    const res = await fetch('/api/qa/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ jobId: activeJob.id })
    })
    if (res.ok) {
      alert('QA submitted for foreman approval!')
      loadQA(activeJob)
    }
  }

  function signOut() {`
)

// Add progress bar and submit button after checklist items
c = c.replace(
  `              </div>
            )}`
  + "\n            )}",
  `              </div>
              <div className="mt-4 pt-4 border-t border-white/10">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm text-[#8fa3b8]">
                    {qaSubmissions.filter((s: any) => s.state !== 'pending').length}/{qaItems.length} items complete
                  </span>
                  <span className="text-xs text-[#4d6478]">
                    {qaItems.filter((i: any) => i.is_mandatory && !qaSubmissions.find((s: any) => s.checklist_item_id === i.id && s.state !== 'pending')).length} mandatory remaining
                  </span>
                </div>
                <div className="w-full h-1.5 bg-white/10 rounded-full mb-4">
                  <div className="h-full bg-[#00d4a0] rounded-full transition-all" style={{width: qaItems.length > 0 ? (qaSubmissions.filter((s: any) => s.state !== 'pending').length / qaItems.length * 100) + '%' : '0%'}}/>
                </div>
                <button
                  onClick={submitQAForApproval}
                  disabled={qaItems.filter((i: any) => i.is_mandatory).some((i: any) => !qaSubmissions.find((s: any) => s.checklist_item_id === i.id && s.state !== 'pending'))}
                  className="w-full bg-[#00d4a0] disabled:opacity-40 disabled:cursor-not-allowed text-[#0f1923] font-bold rounded-xl py-3.5 text-sm">
                  Submit QA for approval
                </button>
                {qaItems.filter((i: any) => i.is_mandatory).some((i: any) => !qaSubmissions.find((s: any) => s.checklist_item_id === i.id && s.state !== 'pending')) && (
                  <p className="text-xs text-[#4d6478] text-center mt-2">Complete all mandatory items to submit</p>
                )}
              </div>
            </div>
            )}`
+ "\n            )}"
)

fs.writeFileSync("C:/vantro/app/installer/jobs/page.tsx", c, "utf8")
console.log("Done - " + (c.includes("submitQAForApproval") ? "SUCCESS" : "FAILED"))
