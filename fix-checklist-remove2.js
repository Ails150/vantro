const fs = require("fs")
let c = fs.readFileSync("components/admin/AdminDashboard.tsx", "utf8")

c = c.replace(
  `  async function deleteItem(itemId: string) {
    if (!window.confirm("Remove this item?")) return
    await fetch("/api/checklist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete_item", itemId }) })
    window.location.href = "/admin?tab=checklists"
  }`,
  `  async function deleteItem(itemId: string) {
    if (!window.confirm("Remove this item?")) return
    const res = await fetch("/api/checklist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete_item", itemId }) })
    if (res.ok) {
      window.location.href = "/admin?tab=checklists"
    } else {
      const d = await res.json()
      alert("Failed to remove: " + d.error)
    }
  }`
)

fs.writeFileSync("components/admin/AdminDashboard.tsx", c, "utf8")
console.log("Done")
