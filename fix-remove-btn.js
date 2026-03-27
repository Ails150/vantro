const fs = require("fs")
let c = fs.readFileSync("components/admin/AdminDashboard.tsx", "utf8")

// Fix the deleteItem call - wrap in arrow function to prevent event object being passed
c = c.replace(
  'onClick={deleteItem(item.id)}',
  'onClick={() => deleteItem(item.id)}'
)

fs.writeFileSync("components/admin/AdminDashboard.tsx", c, "utf8")
console.log("Done - " + (c.includes("onClick={() => deleteItem") ? "SUCCESS" : "FAILED"))
