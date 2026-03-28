Set-Location C:\vantro

$o = Get-Content "C:\vantro\app\onboarding\page.tsx" -Raw -Encoding UTF8

# Find and remove the entire jobs step block
# It starts at {step === 'jobs' && ( and ends at the closing )}
$start = $o.IndexOf("{step === 'jobs' && (")
if ($start -lt 0) {
  Write-Host "Jobs block not found - may already be removed" -ForegroundColor Yellow
} else {
  # Walk back to find the newlines before it
  $blockStart = $start
  while ($blockStart -gt 0 -and $o[$blockStart - 1] -ne "`n") { $blockStart-- }

  # Find the closing )} that closes this block
  # Count braces from the opening ( to find the matching )
  $pos = $o.IndexOf("(", $start + "{step === 'jobs' && ".Length)
  $depth = 1
  $pos++
  while ($pos -lt $o.Length -and $depth -gt 0) {
    if ($o[$pos] -eq "(") { $depth++ }
    elseif ($o[$pos] -eq ")") { $depth-- }
    $pos++
  }
  # pos is now just after the closing )
  # skip the } and any trailing newline
  while ($pos -lt $o.Length -and ($o[$pos] -eq "}" -or $o[$pos] -eq "`r" -or $o[$pos] -eq "`n")) { $pos++ }

  $o = $o.Remove($blockStart, $pos - $blockStart)
  Write-Host "Jobs block removed" -ForegroundColor Green
}

$o | Set-Content "C:\vantro\app\onboarding\page.tsx" -Encoding UTF8

# Verify
$stillHasJobs = $o -match "step === 'jobs'"
Write-Host "Jobs block still present (should be False): $stillHasJobs"

git add app\onboarding\page.tsx
git commit -m "Fix: remove jobs step JSX block from onboarding"
git push origin master

Write-Host "Done." -ForegroundColor Cyan
