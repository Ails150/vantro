const fs = require("fs")
let content = fs.readFileSync("components/admin/AdminDashboard.tsx", "utf8")

// Fix reload calls to preserve tab
content = content.replace(/window\.location\.reload\(\)/g, "window.location.href = '/admin?tab=' + activeTab")

// Fix tab setter to also update URL
content = content.replace(
  /const \[activeTab, setActiveTab\] = useState\([^)]+\)/,
  `const [activeTab, setActiveTab] = useState(() => {
    if (typeof window !== "undefined") {
      return new URLSearchParams(window.location.search).get("tab") || "overview"
    }
    return "overview"
  })`
)

fs.writeFileSync("components/admin/AdminDashboard.tsx", content, "utf8")
console.log("Done")
