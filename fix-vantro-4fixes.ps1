Set-Location C:\vantro

# ============================================================
# ADMINDASHBOARD.TSX
# ============================================================
$d = Get-Content "C:\vantro\components\admin\AdminDashboard.tsx" -Raw -Encoding UTF8

# FIX 4a: corrupt checkmark bytes -> checkmark
$corruptCheck = [System.Text.Encoding]::UTF8.GetString([byte[]](0xC3,0xA2,0xC5,0x93,0xE2,0x80,0x9C))
$d = $d.Replace($corruptCheck, [char]0x2713)

# FIX 4b: corrupt em-dash bytes -> em-dash
$corruptDash = [System.Text.Encoding]::UTF8.GetString([byte[]](0xC3,0xA2,0xE2,0x82,0xAC,0xE2,0x80,0x9D))
$d = $d.Replace($corruptDash, [char]0x2014)

# FIX 1: Mobile layout - header padding
$d = $d.Replace(
  'className="bg-white border-b border-gray-200 px-8 py-4 flex items-center justify-between shadow-sm"',
  'className="bg-white border-b border-gray-200 px-4 md:px-8 py-4 flex items-center justify-between shadow-sm"'
)

# FIX 1: KPI grid responsive
$d = $d.Replace(
  'className="grid grid-cols-4 gap-4 px-8 py-6"',
  'className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 px-4 md:px-8 py-4 md:py-6"'
)

# FIX 1: KPI card padding and font sizes
$d = $d.Replace(
  'className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
            <div className="text-gray-500 text-sm font-medium mb-2">{s.label}</div>
            <div className={"text-4xl font-bold " + s.color}>{s.value}</div>',
  'className="bg-white border border-gray-200 rounded-2xl p-4 md:p-6 shadow-sm">
            <div className="text-gray-500 text-xs md:text-sm font-medium mb-1 md:mb-2">{s.label}</div>
            <div className={"text-3xl md:text-4xl font-bold " + s.color}>{s.value}</div>'
)

# FIX 1: Tabs padding
$d = $d.Replace(
  'className="flex border-b border-gray-200 px-8 bg-white overflow-x-auto"',
  'className="flex border-b border-gray-200 px-2 md:px-8 bg-white overflow-x-auto"'
)

# FIX 1: Tab button padding
$d = $d.Replace(
  '"flex items-center gap-2 px-4 py-4 text-sm font-semibold border-b-2 transition-colors whitespace-nowrap "',
  '"flex items-center gap-2 px-3 md:px-4 py-4 text-sm font-semibold border-b-2 transition-colors whitespace-nowrap "'
)

# FIX 1: Content area padding
$d = $d.Replace(
  'className="px-8 py-6 max-w-6xl"',
  'className="px-4 md:px-8 py-4 md:py-6 max-w-6xl"'
)

# FIX 1: Overview grid
$d = $d.Replace(
  'className="grid grid-cols-2 gap-5"',
  'className="grid grid-cols-1 md:grid-cols-2 gap-5"'
)

# FIX 1: Active jobs card col-span
$d = $d.Replace(
  'className={card + " col-span-2"}',
  'className={card + " md:col-span-2"}'
)

# FIX 3: Add state flags after jobLng
$d = $d.Replace(
  '  const [jobLat, setJobLat] = useState(null)
  const [jobLng, setJobLng] = useState(null)',
  '  const [jobLat, setJobLat] = useState(null)
  const [jobLng, setJobLng] = useState(null)
  const [jobPlaceSelected, setJobPlaceSelected] = useState(false)
  const [editJobPlaceSelected, setEditJobPlaceSelected] = useState(false)'
)

# FIX 3: Set jobPlaceSelected on add autocomplete
$d = $d.Replace(
  '          if (place.geometry?.location) { setJobLat(place.geometry.location.lat()); setJobLng(place.geometry.location.lng()) }
        })
      }
      if (editAddressRef.current)',
  '          if (place.geometry?.location) { setJobLat(place.geometry.location.lat()); setJobLng(place.geometry.location.lng()) }
          setJobPlaceSelected(true)
        })
      }
      if (editAddressRef.current)'
)

# FIX 3: Set editJobPlaceSelected on edit autocomplete
$d = $d.Replace(
  '          if (place.geometry?.location) { setEditJobLat(place.geometry.location.lat()); setEditJobLng(place.geometry.location.lng()) }
        })',
  '          if (place.geometry?.location) { setEditJobLat(place.geometry.location.lat()); setEditJobLng(place.geometry.location.lng()) }
          setEditJobPlaceSelected(true)
        })'
)

# FIX 3: addJob validation
$d = $d.Replace(
  '  async function addJob() {
    if (!jobName.trim() || !jobAddress.trim()) { setFormError("Enter job name and address"); return }
    setSaving(true); setFormError("")
    const { error } = await supabase.from("jobs").insert({ company_id: userData.company_id, name: jobName.trim(), address: jobAddress.trim(), status: "active", checklist_template_id: jobTemplateId || null, lat: jobLat, lng: jobLng })
    if (error) { setFormError(error.message); setSaving(false); return }
    setJobName(""); setJobAddress(""); setJobTemplateId(""); setShowAddJob(false); setSaving(false)
    router.refresh()
  }',
  '  async function addJob() {
    if (!jobName.trim()) { setFormError("Enter a job name"); return }
    if (!jobPlaceSelected) { setFormError("Select an address from the dropdown - do not just type it"); return }
    setSaving(true); setFormError("")
    const { error } = await supabase.from("jobs").insert({ company_id: userData.company_id, name: jobName.trim(), address: jobAddress.trim(), status: "active", checklist_template_id: jobTemplateId || null, lat: jobLat, lng: jobLng })
    if (error) { setFormError(error.message); setSaving(false); return }
    setJobName(""); setJobAddress(""); setJobTemplateId(""); setJobPlaceSelected(false); setShowAddJob(false); setSaving(false)
    router.refresh()
  }'
)

# FIX 3: updateJob validation
$d = $d.Replace(
  '  async function updateJob(jobId: string) {
    if (!editJobName.trim() || !editJobAddress.trim()) { setFormError("Enter job name and address"); return }
    setSaving(true); setFormError("")',
  '  async function updateJob(jobId: string) {
    if (!editJobName.trim()) { setFormError("Enter a job name"); return }
    if (!editJobPlaceSelected) { setFormError("Select an address from the dropdown - do not just type it"); return }
    setSaving(true); setFormError("")'
)

# FIX 3: Edit button sets editJobPlaceSelected(true)
$d = $d.Replace(
  'setEditJobName(j.name); setEditJobAddress(j.address); setEditJobTemplateId(j.checklist_template_id || ""); setFormError("")',
  'setEditJobName(j.name); setEditJobAddress(j.address); setEditJobTemplateId(j.checklist_template_id || ""); setEditJobPlaceSelected(true); setFormError("")'
)

# FIX 3: Add address input resets flag on manual type
$d = $d.Replace(
  'ref={addAddressRef} value={jobAddress} onChange={e => setJobAddress(e.target.value)} placeholder="Start typing site address..."',
  'ref={addAddressRef} value={jobAddress} onChange={e => { setJobAddress(e.target.value); setJobPlaceSelected(false) }} placeholder="Start typing address, then select from dropdown..."'
)

# FIX 3: Edit address input resets flag on manual type
$d = $d.Replace(
  'ref={editAddressRef} value={editJobAddress} onChange={e => setEditJobAddress(e.target.value)} placeholder="Start typing site address..."',
  'ref={editAddressRef} value={editJobAddress} onChange={e => { setEditJobAddress(e.target.value); setEditJobPlaceSelected(false) }} placeholder="Start typing address, then select from dropdown..."'
)

$d | Set-Content "C:\vantro\components\admin\AdminDashboard.tsx" -Encoding UTF8
Write-Host "AdminDashboard.tsx done" -ForegroundColor Green


# ============================================================
# ONBOARDING/PAGE.TSX
# ============================================================
$o = Get-Content "C:\vantro\app\onboarding\page.tsx" -Raw -Encoding UTF8

# FIX 4: corrupt checkmark in step indicator
$o = $o.Replace($corruptCheck, [char]0x2713)

# FIX 2: Step type - here-strings to safely handle single quotes
$oldType = @'
type Step = 'company' | 'installers' | 'jobs' | 'done'
'@
$newType = @'
type Step = 'company' | 'installers' | 'done'
'@
$o = $o.Replace($oldType.Trim(), $newType.Trim())

# FIX 2: Remove jobs state
$o = $o.Replace(
  "  const [installers, setInstallers] = useState([{ name: '', email: '' }])
  const [jobs, setJobs] = useState([{ name: '', address: '' }])",
  "  const [installers, setInstallers] = useState([{ name: '', email: '' }])"
)

# FIX 2: saveInstallers -> done, remove saveJobs
$o = $o.Replace(
  "    if (!res.ok) { setError(data.error); setLoading(false); return }
    setStep('jobs'); setLoading(false)
  }

  async function saveJobs() {
    setLoading(true); setError('')
    const valid = jobs.filter(j => j.name && j.address)
    const res = await fetch('/api/onboarding', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ step: 'jobs', jobs: valid }) })
    const data = await res.json()
    if (!res.ok) { setError(data.error); setLoading(false); return }
    setStep('done'); setLoading(false)
  }",
  "    if (!res.ok) { setError(data.error); setLoading(false); return }
    setStep('done'); setLoading(false)
  }"
)

# FIX 2: stepIdx - here-strings
$oldIdx = @'
  const stepIdx = ['company','installers','jobs','done'].indexOf(step)
'@
$newIdx = @'
  const stepIdx = ['company','installers','done'].indexOf(step)
'@
$o = $o.Replace($oldIdx.Trim(), $newIdx.Trim())

# FIX 2: Step indicator label array
$oldLabels = @'
            {['Company','Team','Jobs'].map((label, i) => (
'@
$newLabels = @'
            {['Company','Team'].map((label, i) => (
'@
$o = $o.Replace($oldLabels.Trim(), $newLabels.Trim())

# FIX 2: Connector condition i < 2 -> i < 1
$o = $o.Replace(
  '{i < 2 && <div className="flex-1 h-px bg-white/5"/>}',
  '{i < 1 && <div className="flex-1 h-px bg-white/5"/>}'
)

# FIX 2: Remove jobs step JSX block
$jobsStart = "          {step === 'jobs' && ("
$jobsEnd = "          )}"
$startIdx = $o.IndexOf($jobsStart)
if ($startIdx -ge 0) {
  # Find the matching closing )} after the jobs block
  $searchFrom = $startIdx + $jobsStart.Length
  # The jobs block ends at the next occurrence of '          )}' after a blank line
  $endIdx = $o.IndexOf("`n`n          )}", $searchFrom)
  if ($endIdx -ge 0) {
    $endIdx = $endIdx + ("`n`n          )}").Length
    $o = $o.Remove($startIdx, $endIdx - $startIdx)
  }
}

$o | Set-Content "C:\vantro\app\onboarding\page.tsx" -Encoding UTF8
Write-Host "onboarding/page.tsx done" -ForegroundColor Green

# Verify key changes
Write-Host ""
Write-Host "Verifying..." -ForegroundColor Yellow
$check1 = (Get-Content "C:\vantro\components\admin\AdminDashboard.tsx" -Raw) -match "grid-cols-2 md:grid-cols-4"
$check2 = (Get-Content "C:\vantro\components\admin\AdminDashboard.tsx" -Raw) -match "jobPlaceSelected"
$check3 = (Get-Content "C:\vantro\app\onboarding\page.tsx" -Raw) -match "step === 'jobs'"
Write-Host "Mobile grid fix applied: $check1"
Write-Host "Maps autocomplete fix applied: $check2"
Write-Host "Jobs step removed (should be False): $(-not $check3)"

# ============================================================
# GIT PUSH
# ============================================================
git add components\admin\AdminDashboard.tsx app\onboarding\page.tsx
git commit -m "Fix: mobile layout, remove jobs onboarding step, force Maps autocomplete, fix encoding"
git push origin master

Write-Host ""
Write-Host "Done. Vercel will deploy automatically." -ForegroundColor Cyan
