const fs = require("fs")
let c = fs.readFileSync("components/admin/AdminDashboard.tsx", "utf8")

// Add deleteJob function after updateJobStatus
c = c.replace(
  "  async function addMember()",
  `  async function deleteJob(jobId: string, jobName: string) {
    if (!window.confirm("Delete job: " + jobName + "? This cannot be undone.")) return
    await supabase.from("job_assignments").delete().eq("job_id", jobId)
    await supabase.from("jobs").delete().eq("id", jobId)
    window.location.href = "/admin?tab=jobs"
  }

  async function addMember()`
)

// Add delete button next to Edit button in job row
c = c.replace(
  '<button onClick={() => setEditingJobId(editingJobId === j.id ? null : j.id); setEditJobName(j.name); setEditJobAddress(j.address); setEditJobTemplateId(j.checklist_template_id || ""); setFormError("") }} className="text-sm border border-gray-200 text-gray-600 hover:border-teal-300 hover:text-teal-600 rounded-xl px-4 py-2 transition-colors flex-shrink-0">\n                        {editingJobId === j.id ? "Cancel" : "Edit"}\n                      </button>',
  `<button onClick={() => { setEditingJobId(editingJobId === j.id ? null : j.id); setEditJobName(j.name); setEditJobAddress(j.address); setEditJobTemplateId(j.checklist_template_id || ""); setFormError("") }} className="text-sm border border-gray-200 text-gray-600 hover:border-teal-300 hover:text-teal-600 rounded-xl px-4 py-2 transition-colors flex-shrink-0">
                        {editingJobId === j.id ? "Cancel" : "Edit"}
                      </button>
                      <button onClick={() => deleteJob(j.id, j.name)} className="text-sm border border-red-200 text-red-500 hover:bg-red-50 rounded-xl px-4 py-2 transition-colors flex-shrink-0">Delete</button>`
)

fs.writeFileSync("components/admin/AdminDashboard.tsx", c, "utf8")
console.log("Done - " + (c.includes("deleteJob") ? "SUCCESS" : "FAILED"))
