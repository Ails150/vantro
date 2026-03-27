const fs = require("fs")
let c = fs.readFileSync("components/admin/PayrollTab.tsx", "utf8")
const lines = c.split("\n")
const seen = new Set()
const fixed = lines.filter(line => {
  const match = line.match(/const \[(\w+),/)
  if (match) {
    if (seen.has(match[1])) return false
    seen.add(match[1])
  }
  return true
})
fs.writeFileSync("components/admin/PayrollTab.tsx", fixed.join("\n"), "utf8")
console.log("Done")
