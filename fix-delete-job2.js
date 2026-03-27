const fs = require("fs")
let c = fs.readFileSync("components/admin/AdminDashboard.tsx", "utf8")

c = c.replace(
  `  async function deleteJob(jobId: string, jobName: string) {
    if (!window.confirm("Delete job: " + jobName + "? This cannot be undone.")) return
    await supabase.from("job_assignments").delete().eq("job_id", jobId)
    await supabase.from("jobs").delete().eq("id", jobId)
    window.location.href = "/admin?tab=jobs"
  }`,
  `  async function deleteJob(jobId: string, jobName: string) {
    if (!window.confirm("Delete job: " + jobName + "? This cannot be undone.")) return
    await supabase.from("job_assignments").delete().eq("job_id", jobId)
    await supabase.from("signins").delete().eq("job_id", jobId)
    await supabase.from("diary_entries").delete().eq("job_id", jobId)
    await supabase.from("qa_submissions").delete().eq("job_id", jobId)
    await supabase.from("qa_approvals").delete().eq("job_id", jobId)
    await supabase.from("defects").delete().eq("job_id", jobId)
    await supabase.from("alerts").delete().eq("job_id", jobId)
    await supabase.from("jobs").delete().eq("id", jobId)
    window.location.href = "/admin?tab=jobs"
  }`
)

fs.writeFileSync("components/admin/AdminDashboard.tsx", c, "utf8")
console.log("Done - " + (c.includes("signins") ? "SUCCESS" : "FAILED"))
