$dashboard = Get-Content "C:\vantro\components\admin\AdminDashboard.tsx" -Raw
$old = '  async function removeMember(userId: string, authUserId: string) {
    if (!window.confirm("Remove this installer from your team? This cannot be undone.")) return
    await supabase.from("users").delete().eq("id", userId)
    if (authUserId) {
      await fetch("/api/team/remove", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ authUserId, userId }) })
        router.refresh()
      router.refresh()
    }
    router.refresh()
  }'
$new = '  async function removeMember(userId: string, authUserId: string) {
    if (!window.confirm("Remove this installer from your team? This cannot be undone.")) return
    const res = await fetch("/api/team/remove", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ authUserId, userId }) })
    if (res.ok) window.location.reload()
  }'
$dashboard.Replace($old, $new) | Set-Content "C:\vantro\components\admin\AdminDashboard.tsx" -Encoding UTF8