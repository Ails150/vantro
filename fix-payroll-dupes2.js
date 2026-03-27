const fs = require("fs")
let c = fs.readFileSync("components/admin/PayrollTab.tsx", "utf8")

// Remove duplicate saveSigninEdit function - keep first occurrence
const fnName = "async function saveSigninEdit"
const first = c.indexOf(fnName)
const second = c.indexOf(fnName, first + 1)

if (second > -1) {
  // Find the end of the second function (closing brace)
  let depth = 0
  let i = second
  let started = false
  while (i < c.length) {
    if (c[i] === '{') { depth++; started = true }
    if (c[i] === '}') { depth-- }
    if (started && depth === 0) { i++; break }
    i++
  }
  c = c.slice(0, second) + c.slice(i)
  console.log("Removed duplicate saveSigninEdit")
} else {
  console.log("No duplicate found")
}

fs.writeFileSync("components/admin/PayrollTab.tsx", c, "utf8")
