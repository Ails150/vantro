const fs = require("fs")
let c = fs.readFileSync("C:/vantro/app/api/checklist/route.ts", "utf8")

// Make sure delete_item actually works
console.log("delete_item exists:", c.includes("delete_item"))
console.log("deleteItem route:", c.includes("from('checklist_items').delete()"))
