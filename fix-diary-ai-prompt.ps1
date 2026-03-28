Set-Location C:\vantro

$old = 'messages: [{ role: ''user'', content: ''Analyse this site diary entry. Reply with JSON only: {"alert_type": "blocker"|"issue"|"none", "summary": "one sentence"}. Entry: '' + entryText }]'

$new = 'messages: [{ role: ''user'', content: ''You are a construction site supervisor AI. Analyse this site diary entry and classify it. Reply with JSON only - no other text: {"alert_type": "blocker"|"issue"|"none", "summary": "one sentence max 15 words"}.\n\nBLOCKER = work cannot continue today. Examples: no workers on site, missing materials, access denied, safety hazard, equipment failure, waiting for delivery.\nISSUE = problem that needs attention but work can continue. Examples: minor delay, quality concern, weather impact, missing one team member.\nNONE = normal progress update.\n\nEntry: '' + entryText }]'

$content = Get-Content "C:\vantro\app\api\diary\route.ts" -Raw -Encoding UTF8
$content = $content.Replace($old, $new)
[System.IO.File]::WriteAllText("C:\vantro\app\api\diary\route.ts", $content, [System.Text.UTF8Encoding]::new($false))
Write-Host "Diary AI prompt updated" -ForegroundColor Green

git add app\api\diary\route.ts
git commit -m "Improve diary AI prompt - smarter construction blocker detection"
git push origin master
Write-Host "Pushed - Vercel will deploy" -ForegroundColor Cyan
