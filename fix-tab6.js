const fs = require("fs")
let content = fs.readFileSync("components/admin/AdminDashboard.tsx", "utf8")
content = content.replace(
  "const [activeTab, setActiveTab] = useState(defaultTab)",
  'const [activeTab, setActiveTab] = useState(() => { try { return localStorage.getItem("vantro_tab") || defaultTab } catch { return defaultTab } })'
)
fs.writeFileSync("components/admin/AdminDashboard.tsx", content, "utf8")
console.log("Done")
