# Wires the 3 new components into AdminDashboard.tsx
# Safe: each edit is idempotent (checks marker before applying)

$ErrorActionPreference = "Stop"
$file = "C:\vantro\components\admin\AdminDashboard.tsx"

if (-not (Test-Path $file)) {
  Write-Host "ERROR: $file not found" -ForegroundColor Red
  exit 1
}

# Backup
$backup = "$file.bak-import-wire"
Copy-Item $file $backup -Force
Write-Host "Backup: $backup" -ForegroundColor Cyan

$content = Get-Content $file -Raw

# ─── Edit 1: Add imports at the top (idempotent) ────────────
if ($content -notmatch "import SitesTab from") {
  # Find the last import line and add after it
  $importLines = @(
    "import SitesTab from `"./SitesTab`""
    "import CsvImportModal from `"./CsvImportModal`""
    "import PayrollExportModal from `"./PayrollExportModal`""
  )
  $newImports = $importLines -join "`n"

  # Insert after the existing PaywallOverlay import (last known import in this file)
  if ($content -match "import PaywallOverlay from '@/components/billing/PaywallOverlay'") {
    $content = $content -replace "(import PaywallOverlay from '@/components/billing/PaywallOverlay'[^`n]*`n)", "`$1$newImports`n"
    Write-Host "Edit 1: imports added" -ForegroundColor Green
  } else {
    Write-Host "Edit 1: SKIPPED - PaywallOverlay anchor not found, you'll need to add imports manually" -ForegroundColor Yellow
  }
} else {
  Write-Host "Edit 1: imports already present" -ForegroundColor Gray
}

# ─── Edit 2: Add 'sites' tab to setupTabs ─────────────────
if ($content -notmatch '\{\s*id:\s*"sites"') {
  $oldNav = '{ id: "team", label: "Team" },'
  $newNav = "{ id: `"team`", label: `"Team`" },`n    { id: `"sites`", label: `"Sites`" },"
  if ($content.Contains($oldNav)) {
    $content = $content.Replace($oldNav, $newNav)
    Write-Host "Edit 2: Sites added to setupTabs" -ForegroundColor Green
  } else {
    Write-Host "Edit 2: SKIPPED - team nav anchor not found" -ForegroundColor Yellow
  }
} else {
  Write-Host "Edit 2: Sites tab already in nav" -ForegroundColor Gray
}

# ─── Edit 3: Render <SitesTab /> when activeTab === "sites" ──
if ($content -notmatch 'activeTab === "sites"') {
  $oldRender = '{activeTab === "audit" && <AuditTab jobs={jobs} />}'
  $newRender = '{activeTab === "sites" && <SitesTab />}' + "`n        " + $oldRender
  if ($content.Contains($oldRender)) {
    $content = $content.Replace($oldRender, $newRender)
    Write-Host "Edit 3: SitesTab render added" -ForegroundColor Green
  } else {
    Write-Host "Edit 3: SKIPPED - audit tab render anchor not found" -ForegroundColor Yellow
  }
} else {
  Write-Host "Edit 3: SitesTab render already present" -ForegroundColor Gray
}

# ─── Edit 4: Replace PayrollTab with PayrollTab + Export button wrapper ──
# We swap a simple `<PayrollTab teamMembers={...} />` for a wrapper div that has
# an Export button above it that opens the PayrollExportModal.
# Since PayrollTab doesn't currently take an export trigger prop, we render the
# button + modal in a sibling div that lives in AdminDashboard.
if ($content -notmatch "PayrollExportModal") {
  $oldPayroll = '{activeTab === "payroll" && <PayrollTab teamMembers={teamMembers} />}'
  $newPayroll = @'
{activeTab === "payroll" && (
          <div>
            <div className="flex justify-end mb-4">
              <button onClick={() => setShowPayrollExport(true)} className="px-4 py-2 bg-teal-500 hover:bg-teal-600 text-white rounded-xl text-sm font-semibold">Export to CSV</button>
            </div>
            <PayrollTab teamMembers={teamMembers} />
            <PayrollExportModal open={showPayrollExport} onClose={() => setShowPayrollExport(false)} />
          </div>
        )}
'@
  if ($content.Contains($oldPayroll)) {
    $content = $content.Replace($oldPayroll, $newPayroll)
    Write-Host "Edit 4: Payroll Export button + modal added" -ForegroundColor Green
  } else {
    Write-Host "Edit 4: SKIPPED - PayrollTab anchor not found" -ForegroundColor Yellow
  }
} else {
  Write-Host "Edit 4: PayrollExportModal already present" -ForegroundColor Gray
}

# ─── Edit 5: Add showPayrollExport + showJobsImport state ──
if ($content -notmatch "showPayrollExport") {
  $oldState = 'const [showAddJob, setShowAddJob] = useState(false)'
  $newState = $oldState + "`n  const [showPayrollExport, setShowPayrollExport] = useState(false)`n  const [showJobsImport, setShowJobsImport] = useState(false)"
  if ($content.Contains($oldState)) {
    $content = $content.Replace($oldState, $newState)
    Write-Host "Edit 5: state hooks added" -ForegroundColor Green
  } else {
    Write-Host "Edit 5: SKIPPED - showAddJob anchor not found" -ForegroundColor Yellow
  }
} else {
  Write-Host "Edit 5: state hooks already present" -ForegroundColor Gray
}

# ─── Edit 6: Add 'Import CSV' button next to '+ Add job' + render JobsImportModal ──
if ($content -notmatch "showJobsImport") {
  Write-Host "Edit 6: SKIPPED - showJobsImport state didn't get added in Edit 5" -ForegroundColor Yellow
} elseif ($content -notmatch 'CsvImportModal[\s\S]{0,200}vantro-jobs-template\.csv') {
  $oldButton = '<div className="flex justify-end"><button onClick={() => { setShowAddJob(true); setFormError("") }} className={btn}>+ Add job</button></div>'
  $newButton = @'
<div className="flex justify-end gap-3">
              <button onClick={() => setShowJobsImport(true)} className="px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:border-teal-300">Import CSV</button>
              <button onClick={() => { setShowAddJob(true); setFormError("") }} className={btn}>+ Add job</button>
              <CsvImportModal
                open={showJobsImport}
                onClose={() => setShowJobsImport(false)}
                onSuccess={() => router.refresh()}
                title="Import jobs from CSV"
                endpoint="/api/admin/jobs/bulk-import"
                fields={[
                  { key: "name", label: "Name", required: true, example: "14 The Parade" },
                  { key: "address", label: "Address", required: true, example: "14 The Parade" },
                  { key: "postcode", label: "Postcode", example: "WD17 1AB" },
                  { key: "foreman_email", label: "Foreman email", example: "" },
                  { key: "gps_radius", label: "GPS radius (m)", example: "150" },
                  { key: "start_date", label: "Start date", example: "2026-05-01" },
                  { key: "end_date", label: "End date", example: "2026-05-15" },
                ]}
                templateFilename="vantro-jobs-template.csv"
                maxRows={200}
              />
            </div>
'@
  if ($content.Contains($oldButton)) {
    $content = $content.Replace($oldButton, $newButton)
    Write-Host "Edit 6: Jobs Import CSV button + modal added" -ForegroundColor Green
  } else {
    Write-Host "Edit 6: SKIPPED - + Add job anchor not found" -ForegroundColor Yellow
  }
} else {
  Write-Host "Edit 6: Jobs CsvImportModal already present" -ForegroundColor Gray
}

# Write back
[System.IO.File]::WriteAllText($file, $content)

Write-Host ""
Write-Host "All wiring done. Verify:" -ForegroundColor Cyan
Write-Host "  Get-Content $file | Select-String -Pattern 'SitesTab|PayrollExportModal|showJobsImport' | Select-Object -First 10" -ForegroundColor Gray
