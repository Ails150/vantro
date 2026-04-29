# Vantro: collapsible sidebar
# - Toggle button (chevron) at top of sidebar
# - Collapsed = 64px wide, shows label initials with tooltip
# - State persisted in localStorage
# - Auto-collapse on mobile (<768px)

$ErrorActionPreference = "Stop"
$file = "C:\vantro\components\admin\AdminDashboard.tsx"

if (-not (Test-Path $file)) { Write-Host "ERROR: file not found" -ForegroundColor Red; exit 1 }

Copy-Item $file "$file.bak-sidebar" -Force
Write-Host "Backup: $file.bak-sidebar" -ForegroundColor Cyan

$content = Get-Content $file -Raw

# ─── Edit 1: state hooks ───
if ($content -notmatch "sidebarCollapsed") {
  $oldState = 'const [showAddJob, setShowAddJob] = useState(false)'
  $newState = @'
const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  useEffect(() => {
    try {
      const stored = localStorage.getItem("vantro_sidebar_collapsed")
      if (stored === "1") setSidebarCollapsed(true)
      if (window.innerWidth < 768) setSidebarCollapsed(true)
    } catch {}
  }, [])
  useEffect(() => {
    try { localStorage.setItem("vantro_sidebar_collapsed", sidebarCollapsed ? "1" : "0") } catch {}
  }, [sidebarCollapsed])
  useEffect(() => {
    function onResize() { if (window.innerWidth < 768) setSidebarCollapsed(true) }
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])
  function tabInitials(label: string): string {
    const parts = label.trim().split(/\s+/)
    if (parts.length === 1) return parts[0].slice(0, 2)
    return (parts[0][0] + parts[1][0]).toUpperCase()
  }
  const [showAddJob, setShowAddJob] = useState(false)
'@
  if ($content.Contains($oldState)) {
    $content = $content.Replace($oldState, $newState)
    Write-Host "Edit 1: state + helpers added" -ForegroundColor Green
  } else { Write-Host "Edit 1: anchor not found" -ForegroundColor Yellow }
} else { Write-Host "Edit 1: already present" -ForegroundColor Gray }

# ─── Edit 2: sidebar wrapper width ───
if ($content -notmatch "sidebar-collapsible-v1") {
  $old = '<div className="w-64 bg-white border-r border-gray-200 min-h-screen">'
  $new = '<div data-marker="sidebar-collapsible-v1" className={"bg-white border-r border-gray-200 min-h-screen transition-all duration-200 relative " + (sidebarCollapsed ? "w-16" : "w-64")}>'
  if ($content.Contains($old)) {
    $content = $content.Replace($old, $new)
    Write-Host "Edit 2: wrapper made collapsible" -ForegroundColor Green
  } else { Write-Host "Edit 2: anchor not found" -ForegroundColor Yellow }
} else { Write-Host "Edit 2: already present" -ForegroundColor Gray }

# ─── Edit 3: padding wrapper + toggle button injected ───
if ($content -notmatch "sidebar-toggle-btn") {
  $oldP = '<div className="p-6 space-y-6">'
  $newP = @'
<div className={"space-y-6 " + (sidebarCollapsed ? "px-2 pt-14" : "p-6 pt-14")}>
              <button
                data-marker="sidebar-toggle-btn"
                onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                className="absolute top-3 right-2 w-8 h-8 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 flex items-center justify-center text-gray-500 hover:text-gray-800 transition-colors z-20"
                aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                title={sidebarCollapsed ? "Expand" : "Collapse"}
              >
                <svg width="14" height="14" viewBox="0 0 20 20" fill="none" className={"transition-transform " + (sidebarCollapsed ? "rotate-180" : "")}>
                  <path d="M12 4l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
'@
  # Replace ONLY the first occurrence (sidebar one) — find unique context
  $idx = $content.IndexOf($oldP)
  if ($idx -ge 0) {
    $content = $content.Substring(0, $idx) + $newP + $content.Substring($idx + $oldP.Length)
    Write-Host "Edit 3: padding + toggle button added" -ForegroundColor Green
  } else { Write-Host "Edit 3: anchor not found" -ForegroundColor Yellow }
} else { Write-Host "Edit 3: already present" -ForegroundColor Gray }

# ─── Edit 4: Setup heading conditional ───
$oldSetup = '<h3 className="text-sm font-semibold text-gray-900 mb-3">Setup</h3>'
$newSetup = '{!sidebarCollapsed && <h3 className="text-sm font-semibold text-gray-900 mb-3">Setup</h3>}'
if ($content.Contains($oldSetup)) {
  $content = $content.Replace($oldSetup, $newSetup)
  Write-Host "Edit 4: Setup heading hidden when collapsed" -ForegroundColor Green
} else { Write-Host "Edit 4: already done or not found" -ForegroundColor Gray }

# ─── Edit 5: Operations heading conditional ───
$oldOps = '<h3 className="text-sm font-semibold text-gray-900 mb-3">Operations</h3>'
$newOps = '{!sidebarCollapsed && <h3 className="text-sm font-semibold text-gray-900 mb-3">Operations</h3>}'
if ($content.Contains($oldOps)) {
  $content = $content.Replace($oldOps, $newOps)
  Write-Host "Edit 5: Operations heading hidden when collapsed" -ForegroundColor Green
} else { Write-Host "Edit 5: already done or not found" -ForegroundColor Gray }

# ─── Edit 6: tab button label - show initials when collapsed (replace BOTH occurrences) ───
$oldLabel = '<span>{tab.label}</span>'
$newLabel = '<span title={sidebarCollapsed ? tab.label : undefined}>{sidebarCollapsed ? tabInitials(tab.label) : tab.label}</span>'
$labelCount = ([regex]::Matches($content, [regex]::Escape($oldLabel))).Count
if ($labelCount -gt 0) {
  $content = $content.Replace($oldLabel, $newLabel)
  Write-Host "Edit 6: $labelCount tab labels updated to show initials when collapsed" -ForegroundColor Green
} else { Write-Host "Edit 6: tab.label spans not found (already done?)" -ForegroundColor Gray }

# ─── Edit 7: hide badge text when collapsed (keep it as a small dot) ───
$oldBadge = '{tab.badge ? <span className="bg-teal-100 text-teal-700 text-xs font-bold px-2 py-0.5 rounded-full">{tab.badge}</span> : null}'
$newBadge = '{tab.badge ? <span className={sidebarCollapsed ? "absolute top-1 right-1 w-2 h-2 bg-teal-500 rounded-full" : "bg-teal-100 text-teal-700 text-xs font-bold px-2 py-0.5 rounded-full"}>{sidebarCollapsed ? "" : tab.badge}</span> : null}'
$badgeCount = ([regex]::Matches($content, [regex]::Escape($oldBadge))).Count
if ($badgeCount -gt 0) {
  $content = $content.Replace($oldBadge, $newBadge)
  Write-Host "Edit 7: $badgeCount badges updated to show dot when collapsed" -ForegroundColor Green
} else { Write-Host "Edit 7: badge spans not found" -ForegroundColor Gray }

[System.IO.File]::WriteAllText($file, $content)

Write-Host ""
Write-Host "Verification:" -ForegroundColor Cyan
Get-Content $file | Select-String -Pattern "sidebar-collapsible-v1|sidebar-toggle-btn|sidebarCollapsed.*tabInitials" | Select-Object -First 5 | ForEach-Object { Write-Host "  OK $_" -ForegroundColor Gray }
