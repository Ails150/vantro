const fs = require("fs")
let content = fs.readFileSync("components/admin/AdminDashboard.tsx", "utf8")
content = content.replace(
  /const \[activeTab, setActiveTab\] = useState\([\s\S]*?\}\)/,
  'const [activeTab, setActiveTab] = useState(defaultTab)'
)
fs.writeFileSync("components/admin/AdminDashboard.tsx", content, "utf8")
console.log("Done")
