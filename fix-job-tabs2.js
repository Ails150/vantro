const fs = require("fs")
let c = fs.readFileSync("components/admin/AdminDashboard.tsx", "utf8")

c = c.replace(
  'const [assigningJobId, setAssigningJobId] = useState(null)',
  'const [assigningJobId, setAssigningJobId] = useState(null)\n  const [jobFilter, setJobFilter] = useState("active")'
)

c = c.replace(
  '<div className={cardHeader}><span className="font-semibold">All jobs</span></div>',
  `<div className="px-6 pt-5 pb-3 flex gap-2 flex-wrap border-b border-gray-100">
                {["all","active","on_hold","completed","cancelled"].map((f: any) => (
                  <button key={f} onClick={() => setJobFilter(f)}
                    className={"px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors " + (jobFilter === f ? "bg-teal-400 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200")}>
                    {f === "all" ? "All" : f === "on_hold" ? "On hold" : f.charAt(0).toUpperCase() + f.slice(1)}
                    <span className="ml-1 opacity-70">{f === "all" ? jobs.length : jobs.filter((j: any) => j.status === f).length}</span>
                  </button>
                ))}
              </div>`
)

c = c.replace(
  '{jobs.length === 0 ? <div className={"px-6 py-16 text-center " + sub}>No jobs yet</div>\n              : jobs.map((j: any) => {',
  '{jobs.filter((j: any) => jobFilter === "all" || j.status === jobFilter).length === 0 ? <div className={"px-6 py-16 text-center " + sub}>No jobs</div>\n              : jobs.filter((j: any) => jobFilter === "all" || j.status === jobFilter).map((j: any) => {'
)

fs.writeFileSync("components/admin/AdminDashboard.tsx", c, "utf8")
console.log("Done - " + (c.includes("jobFilter") ? "SUCCESS" : "FAILED"))
