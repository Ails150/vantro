const fs = require("fs")
let c = fs.readFileSync("components/admin/AdminDashboard.tsx", "utf8")

c = c.replace(
  '<button onClick={() => updateJob(j.id)} disabled={saving} className={btn}>{saving ? "Saving..." : "Save changes"}</button>\n                            <button onClick={() => setEditingJobId(null)} className={btnGhost}>Cancel</button>',
  '<button onClick={() => updateJob(j.id)} disabled={saving} className={btn}>{saving ? "Saving..." : "Save changes"}</button>\n                            <button onClick={() => setEditingJobId(null)} className={btnGhost}>Cancel</button>\n                            <button onClick={() => deleteJob(j.id, j.name)} className="bg-red-50 hover:bg-red-100 text-red-500 border border-red-200 rounded-xl px-5 py-2.5 text-sm transition-colors">Delete</button>'
)

fs.writeFileSync("components/admin/AdminDashboard.tsx", c, "utf8")
console.log("Done - " + (c.includes("deleteJob") ? "SUCCESS" : "FAILED"))
