const fs = require("fs")
let content = fs.readFileSync("components/admin/AdminDashboard.tsx", "utf8")

// Fix the broken useState - replace everything from const [activeTab to the next const
content = content.replace(
  /const \[activeTab, setActiveTab\] = useState\([\s\S]*?\)\s*const \[showAddJob/,
  `const [activeTab, setActiveTab] = useState(() => {
    if (typeof window !== "undefined") {
      return new URLSearchParams(window.location.search).get("tab") || "overview"
    }
    return "overview"
  })
  const [showAddJob`
)

// Fix reload calls
content = content.replace(/window\.location\.reload\(\)/g, "window.location.href = '/admin?tab=' + activeTab")

fs.writeFileSync("components/admin/AdminDashboard.tsx", content, "utf8")
console.log("Done")
