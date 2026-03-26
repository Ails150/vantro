const fs = require("fs")
let content = fs.readFileSync("components/admin/AdminDashboard.tsx", "utf8")

// Replace useState init to use localStorage
content = content.replace(
  "const [activeTab, setActiveTab] = useState(defaultTab)",
  `const [activeTab, setActiveTab] = useState(defaultTab)
  
  function switchTab(tab) {
    setActiveTab(tab)
    if (typeof window !== "undefined") localStorage.setItem("vantro_tab", tab)
  }`
)

// Replace setActiveTab( calls in tab buttons with switchTab(
content = content.replace(/onClick\(\) => setActiveTab\(tab\.id\)/g, "onClick={() => switchTab(tab.id)")

// Replace all reload calls - just refresh data, tab stays
content = content.replace(/window\.location\.href = [^;]+;/g, "router.refresh();")
content = content.replace(/router\.refresh\(\)/g, "router.refresh()")

fs.writeFileSync("components/admin/AdminDashboard.tsx", content, "utf8")
console.log("Done")
