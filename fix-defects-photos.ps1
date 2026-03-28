Set-Location C:\vantro

$content = Get-Content "C:\vantro\app\api\defects\route.ts" -Raw -Encoding UTF8

# Replace the GET handler to generate signed URLs for photos
$old = '  let query = service.from(''defects'').select(''*, jobs(name), users(name, initials)'').eq(''company_id'', userData.company_id).order(''created_at'', { ascending: false })
  if (jobId) query = query.eq(''job_id'', jobId)

  const { data } = await query
  return NextResponse.json({ defects: data || [] })'

$new = '  let query = service.from(''defects'').select(''*, jobs(name), users(name, initials)'').eq(''company_id'', userData.company_id).order(''created_at'', { ascending: false })
  if (jobId) query = query.eq(''job_id'', jobId)

  const { data } = await query

  // Generate signed URLs for photos
  const defectsWithSignedUrls = await Promise.all((data || []).map(async (defect: any) => {
    if (defect.photo_path) {
      const { data: signedData } = await service.storage.from(''vantro-media'').createSignedUrl(defect.photo_path, 3600)
      return { ...defect, photo_url: signedData?.signedUrl || defect.photo_url }
    }
    return defect
  }))

  return NextResponse.json({ defects: defectsWithSignedUrls })'

$content = $content.Replace($old, $new)
[System.IO.File]::WriteAllText("C:\vantro\app\api\defects\route.ts", $content, [System.Text.UTF8Encoding]::new($false))

# Verify
$check = (Get-Content "C:\vantro\app\api\defects\route.ts" -Raw) -match "createSignedUrl"
Write-Host "Signed URL fix applied (should be True): $check" -ForegroundColor Green

git add app\api\defects\route.ts
git commit -m "Fix defects photos - use signed URLs instead of public URLs"
git push origin master
Write-Host "Pushed - Vercel will deploy" -ForegroundColor Cyan
