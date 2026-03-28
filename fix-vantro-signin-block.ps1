Set-Location C:\vantro

$s = Get-Content "C:\vantro\app\api\signin\route.ts" -Raw -Encoding UTF8

$old = '  // Check already signed in today
  const today = new Date(); today.setHours(0,0,0,0)
  const { data: existing } = await service.from(''signins'')
    .select(''id'')
    .eq(''job_id'', jobId)
    .eq(''user_id'', installer.userId)
    .gte(''signed_in_at'', today.toISOString())
    .is(''signed_out_at'', null)
    .single()
  
  if (existing) return NextResponse.json({ success: true, distanceMetres, withinRange, alreadySignedIn: true })'

$new = '  // Block if already signed in to ANY job
  const today = new Date(); today.setHours(0,0,0,0)
  const { data: existing } = await service.from(''signins'')
    .select(''id, job_id, jobs(name)'')
    .eq(''user_id'', installer.userId)
    .gte(''signed_in_at'', today.toISOString())
    .is(''signed_out_at'', null)
    .limit(1)
    .maybeSingle()

  if (existing) {
    if (existing.job_id === jobId) {
      return NextResponse.json({ success: true, distanceMetres, withinRange, alreadySignedIn: true })
    }
    const otherJobName = (existing.jobs as any)?.name || ''another job''
    return NextResponse.json({ error: `You are already signed in to ${otherJobName}. Sign out first.` }, { status: 400 })
  }'

$s = $s.Replace($old, $new)
$s | Set-Content "C:\vantro\app\api\signin\route.ts" -Encoding UTF8

# Verify
$check = (Get-Content "C:\vantro\app\api\signin\route.ts" -Raw) -match "already signed in to"
Write-Host "Fix applied (should be True): $check" -ForegroundColor Green

git add app\api\signin\route.ts
git commit -m "Fix: block signing in to multiple jobs simultaneously"
git push origin master

Write-Host "Done." -ForegroundColor Cyan
