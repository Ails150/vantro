Set-Location C:\vantro

# Create /api/qa/submit route
New-Item -ItemType Directory -Force -Path "app\api\qa\submit" | Out-Null

$submitRoute = @'
import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"

function getInstallerFromToken(request: Request) {
  const auth = request.headers.get("authorization")
  if (!auth?.startsWith("Bearer ")) return null
  try {
    const payload = JSON.parse(Buffer.from(auth.slice(7), "base64").toString())
    if (payload.exp < Date.now()) return null
    return payload
  } catch { return null }
}

export async function POST(request: Request) {
  const installer = getInstallerFromToken(request)
  if (!installer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { jobId } = await request.json()
  const service = await createServiceClient()

  const { data: job } = await service.from("jobs").select("company_id").eq("id", jobId).single()
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 })

  // Check if approval already exists
  const { data: existing } = await service
    .from("qa_approvals")
    .select("id")
    .eq("job_id", jobId)
    .eq("user_id", installer.userId)
    .eq("status", "pending")
    .single()

  if (existing) return NextResponse.json({ success: true, message: "Already submitted" })

  const { error } = await service.from("qa_approvals").insert({
    job_id: jobId,
    user_id: installer.userId,
    company_id: job.company_id,
    status: "pending",
    submitted_at: new Date().toISOString()
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  return NextResponse.json({ success: true })
}
'@

[System.IO.File]::WriteAllText("C:\vantro\app\api\qa\submit\route.ts", $submitRoute, [System.Text.UTF8Encoding]::new($false))
Write-Host "QA submit route created" -ForegroundColor Green

git add app\api\qa\submit\route.ts
git commit -m "Add QA submit API route for mobile app"
git push origin master
Write-Host "Pushed to GitHub - Vercel will deploy" -ForegroundColor Cyan

# Now fix emoji encoding in mobile - use unicode escape codes instead of emoji literals
Set-Location C:\vantro-mobile

$jobs = Get-Content "C:\vantro-mobile\app\(installer)\jobs.tsx" -Raw -Encoding UTF8

# Replace any remaining emoji with plain text
$jobs = $jobs -replace '[\x{1F4CB}\x{2713}\x{26A0}]', ''
$jobs = $jobs.Replace('"Diary"', '"Diary"')
$jobs = $jobs.Replace('"QA"', '"QA"')  
$jobs = $jobs.Replace('"Defects"', '"Defects"')

# Fix the banner text encoding - "On site â€" Pilgrim" should be "On site - Pilgrim"
$jobs = $jobs.Replace("On site \u2014", "On site -")

[System.IO.File]::WriteAllText("C:\vantro-mobile\app\(installer)\jobs.tsx", $jobs, [System.Text.UTF8Encoding]::new($false))

# The real fix - the activeBannerText has em-dash from job name
# Fix in the JSX - replace the em dash with a simple dash
$jobs = Get-Content "C:\vantro-mobile\app\(installer)\jobs.tsx" -Raw -Encoding UTF8
$jobs = $jobs.Replace(
  '`On site — ${signedInJob.name}`',
  '`On site - ${signedInJob.name}`'
)
$jobs = $jobs.Replace(
  '"On site — " + signedInJob.name',
  '"On site - " + signedInJob.name'
)
[System.IO.File]::WriteAllText("C:\vantro-mobile\app\(installer)\jobs.tsx", $jobs, [System.Text.UTF8Encoding]::new($false))

Write-Host "Banner text fixed" -ForegroundColor Green

git add .
git commit -m "Fix banner encoding and emoji text"
eas build --platform android --profile preview

Write-Host "New build submitted" -ForegroundColor Cyan
