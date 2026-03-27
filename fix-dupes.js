const fs = require("fs")
let c = fs.readFileSync("components/admin/AdminDashboard.tsx", "utf8")

// Remove duplicate jobFilter declaration (keep first)
const jobFilterCount = (c.match(/const \[jobFilter, setJobFilter\]/g) || []).length
if (jobFilterCount > 1) {
  let found = false
  c = c.replace(/  const \[jobFilter, setJobFilter\] = useState\("active"\)\n/g, (match) => {
    if (!found) { found = true; return match }
    return ''
  })
}

// Remove duplicate editJobStatus declaration (keep first)
const statusCount = (c.match(/const \[editJobStatus, setEditJobStatus\]/g) || []).length
if (statusCount > 1) {
  let found = false
  c = c.replace(/  const \[editJobStatus, setEditJobStatus\] = useState\(""\)\n/g, (match) => {
    if (!found) { found = true; return match }
    return ''
  })
}

fs.writeFileSync("components/admin/AdminDashboard.tsx", c, "utf8")
console.log("Done")
