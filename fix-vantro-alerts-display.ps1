Set-Location C:\vantro

# Fix 1: Update alerts query in admin page to include user info
$page = Get-Content "C:\vantro\app\admin\page.tsx" -Raw -Encoding UTF8
$page = $page.Replace(
  "const { data: alerts } = await supabase.from('alerts').select('*, jobs(name)').eq('company_id', companyId).eq('is_read', false).order('created_at', { ascending: false }).limit(10)",
  "const { data: alerts } = await supabase.from('alerts').select('*, jobs(name), users(name, initials)').eq('company_id', companyId).eq('is_read', false).order('created_at', { ascending: false }).limit(20)"
)
[System.IO.File]::WriteAllText("C:\vantro\app\admin\page.tsx", $page, [System.Text.UTF8Encoding]::new($false))
Write-Host "Admin page alerts query updated" -ForegroundColor Green

# Fix 2: Update alerts display in AdminDashboard to show full info
$dash = Get-Content "C:\vantro\components\admin\AdminDashboard.tsx" -Raw -Encoding UTF8

# Fix alerts tab display
$dash = $dash.Replace(
  '            : alerts.map((a: any) => (
              <div key={a.id} className="px-6 py-5 border-b border-gray-50 last:border-0">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className={"text-xs " + sub + " mb-1"}>{a.jobs?.name} - {new Date(a.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</div>
                    <div className="text-sm">{a.message}</div>
                  </div>
                  <button onClick={() => markAlertRead(a.id)} className={"text-sm " + sub + " hover:text-gray-900 border border-gray-200 rounded-lg px-3 py-1.5"}>Dismiss</button>
                </div>
              </div>
            ))}',
  '            : alerts.map((a: any) => (
              <div key={a.id} className={"px-6 py-5 border-b border-gray-50 last:border-0" + (a.alert_type === "blocker" ? " border-l-4 border-l-red-400" : a.alert_type === "issue" ? " border-l-4 border-l-amber-400" : "")}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      {a.alert_type === "blocker" && <span className="text-xs bg-red-50 text-red-600 border border-red-200 px-2 py-0.5 rounded-full font-bold">BLOCKER</span>}
                      {a.alert_type === "issue" && <span className="text-xs bg-amber-50 text-amber-600 border border-amber-200 px-2 py-0.5 rounded-full font-semibold">ISSUE</span>}
                      <span className={"text-xs font-semibold " + (a.alert_type === "blocker" ? "text-red-600" : "text-gray-700")}>{a.jobs?.name}</span>
                      {a.users?.name && <span className="text-xs text-gray-400">logged by {a.users.name}</span>}
                      <span className={"text-xs " + sub}>{new Date(a.created_at).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                    </div>
                    <div className="text-sm text-gray-700">{a.message}</div>
                  </div>
                  <button onClick={() => markAlertRead(a.id)} className={"text-sm " + sub + " hover:text-gray-900 border border-gray-200 rounded-lg px-3 py-1.5 flex-shrink-0"}>Dismiss</button>
                </div>
              </div>
            ))}'
)

# Also fix overview tab recent alerts to show same info
$dash = $dash.Replace(
  '              : alerts.slice(0, 5).map((a: any) => (
                <div key={a.id} className="px-6 py-4 border-b border-gray-50 last:border-0">
                  <div className={"text-xs " + sub + " mb-1"}>{a.jobs?.name}</div>
                  <div className="text-sm">{a.message}</div>
                </div>
              ))}',
  '              : alerts.slice(0, 5).map((a: any) => (
                <div key={a.id} className={"px-6 py-4 border-b border-gray-50 last:border-0" + (a.alert_type === "blocker" ? " border-l-4 border-l-red-400" : "")}>
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    {a.alert_type === "blocker" && <span className="text-xs bg-red-50 text-red-600 px-2 py-0.5 rounded-full font-bold border border-red-200">BLOCKER</span>}
                    {a.alert_type === "issue" && <span className="text-xs bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full border border-amber-200">ISSUE</span>}
                    <span className={"text-xs font-medium text-gray-700"}>{a.jobs?.name}</span>
                    <span className={"text-xs " + sub}>{new Date(a.created_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                  <div className="text-sm text-gray-600">{a.message}</div>
                </div>
              ))}'
)

[System.IO.File]::WriteAllText("C:\vantro\components\admin\AdminDashboard.tsx", $dash, [System.Text.UTF8Encoding]::new($false))
Write-Host "Alerts display updated" -ForegroundColor Green

git add app\admin\page.tsx components\admin\AdminDashboard.tsx
git commit -m "Fix alerts - show date, job, user name, alert type badge"
git push origin master
Write-Host "Pushed - Vercel will deploy" -ForegroundColor Cyan
