Set-Location C:\vantro

$l = Get-Content "C:\vantro\app\layout.tsx" -Raw -Encoding UTF8

# Remove the service worker unregister script entirely
$l = $l.Replace(
  '        <script dangerouslySetInnerHTML={{ __html: `if(''serviceWorker'' in navigator){navigator.serviceWorker.getRegistrations().then(function(regs){regs.forEach(function(r){r.unregister();});})}` }}/>' + "`r`n",
  ''
)
# Also try without carriage return
$l = $l.Replace(
  '        <script dangerouslySetInnerHTML={{ __html: `if(''serviceWorker'' in navigator){navigator.serviceWorker.getRegistrations().then(function(regs){regs.forEach(function(r){r.unregister();});})}` }}/>' + "`n",
  ''
)

# Add manifest link and SW registration if not already present
if ($l -notmatch 'rel="manifest"') {
  $l = $l.Replace(
    '        <meta name="viewport"',
    '        <link rel="manifest" href="/manifest.json"/>
        <link rel="apple-touch-icon" href="/apple-touch-icon.png"/>
        <script dangerouslySetInnerHTML={{ __html: `if(''serviceWorker'' in navigator){window.addEventListener(''load'',function(){navigator.serviceWorker.register(''/sw.js'');})}` }}/>
        <meta name="viewport"'
  )
}

$l | Set-Content "C:\vantro\app\layout.tsx" -Encoding UTF8
Write-Host "layout.tsx updated" -ForegroundColor Green

# Verify unregister is gone and manifest is present
$content = Get-Content "C:\vantro\app\layout.tsx" -Raw
$unregisterGone = -not ($content -match "unregister")
$manifestPresent = $content -match 'rel="manifest"'
$swRegPresent = $content -match "sw.js"
Write-Host "Unregister script removed (should be True): $unregisterGone"
Write-Host "Manifest link present (should be True): $manifestPresent"
Write-Host "SW registration present (should be True): $swRegPresent"

git add app\layout.tsx
git commit -m "Fix: restore PWA - remove SW unregister, add manifest and SW registration"
git push origin master

Write-Host "Done." -ForegroundColor Cyan
