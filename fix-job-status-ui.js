const fs = require("fs")
let c = fs.readFileSync("components/admin/AdminDashboard.tsx", "utf8")

c = c.replace(
  `<select value={j.status} onChange={e => updateJobStatus(j.id, e.target.value)}
                        className="text-sm border border-gray-200 rounded-xl px-3 py-1.5 focus:outline-none focus:border-teal-400 bg-white">
                        <option value="active">Active</option>
                        <option value="on_hold">On hold</option>
                        <option value="completed">Completed</option>
                        <option value="cancelled">Cancelled</option>
                      </select>`,
  `<select value={j.status} onChange={e => updateJobStatus(j.id, e.target.value)}
                        className={"text-sm border rounded-xl px-3 py-1.5 focus:outline-none font-medium " + (j.status === "active" ? "bg-teal-50 text-teal-600 border-teal-200" : j.status === "completed" ? "bg-green-50 text-green-600 border-green-200" : j.status === "on_hold" ? "bg-amber-50 text-amber-600 border-amber-200" : "bg-red-50 text-red-500 border-red-200")}>
                        <option value="active">Active</option>
                        <option value="on_hold">On hold</option>
                        <option value="completed">Completed</option>
                        <option value="cancelled">Cancelled</option>
                      </select>`
)

fs.writeFileSync("components/admin/AdminDashboard.tsx", c, "utf8")
console.log("Done")
