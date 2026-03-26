const fs = require("fs")
let content = fs.readFileSync("components/admin/AdminDashboard.tsx", "utf8")

// Replace all window.location.href reloads with router.refresh()
content = content.replace(/window\.location\.href = '\/admin\?tab=' \+ activeTab/g, "router.refresh()")

fs.writeFileSync("components/admin/AdminDashboard.tsx", content, "utf8")
console.log("Done - replaced all reloads with router.refresh()")
