Set-Location C:\vantro

# Fix encoding using byte arrays - no string comparison issues

# Corrupt checkmark bytes: C3 A2 C5 93 E2 80 9C -> E2 9C 93 (U+2713 checkmark)
$corruptCheckBytes = [byte[]](0xC3,0xA2,0xC5,0x93,0xE2,0x80,0x9C)
$checkmarkBytes    = [byte[]](0xE2,0x9C,0x93)

# Corrupt em-dash bytes: C3 A2 E2 82 AC E2 80 9D -> E2 80 94 (U+2014 em-dash)
$corruptDashBytes  = [byte[]](0xC3,0xA2,0xE2,0x82,0xAC,0xE2,0x80,0x9D)
$emDashBytes       = [byte[]](0xE2,0x80,0x94)

function Replace-Bytes {
  param([byte[]]$source, [byte[]]$find, [byte[]]$replace)
  $result = [System.Collections.Generic.List[byte]]::new()
  $i = 0
  while ($i -lt $source.Length) {
    $match = $true
    if ($i + $find.Length -le $source.Length) {
      for ($j = 0; $j -lt $find.Length; $j++) {
        if ($source[$i + $j] -ne $find[$j]) { $match = $false; break }
      }
    } else { $match = $false }
    if ($match) {
      $result.AddRange($replace)
      $i += $find.Length
    } else {
      $result.Add($source[$i])
      $i++
    }
  }
  return $result.ToArray()
}

# Fix AdminDashboard.tsx
$bytes = [System.IO.File]::ReadAllBytes("C:\vantro\components\admin\AdminDashboard.tsx")
$bytes = Replace-Bytes $bytes $corruptCheckBytes $checkmarkBytes
$bytes = Replace-Bytes $bytes $corruptDashBytes $emDashBytes
[System.IO.File]::WriteAllBytes("C:\vantro\components\admin\AdminDashboard.tsx", $bytes)
Write-Host "AdminDashboard.tsx encoding fixed" -ForegroundColor Green

# Fix onboarding/page.tsx
$bytes = [System.IO.File]::ReadAllBytes("C:\vantro\app\onboarding\page.tsx")
$bytes = Replace-Bytes $bytes $corruptCheckBytes $checkmarkBytes
[System.IO.File]::WriteAllBytes("C:\vantro\app\onboarding\page.tsx", $bytes)
Write-Host "onboarding/page.tsx encoding fixed" -ForegroundColor Green

# Verify
$content = Get-Content "C:\vantro\components\admin\AdminDashboard.tsx" -Raw
$hasCheckmark = $content -match [char]0x2713
$hasEmDash    = $content -match [char]0x2014
$noCorrupt    = -not ($content -match "a`u{030A}")
Write-Host "Checkmark fixed: $hasCheckmark"
Write-Host "Em-dash fixed: $hasEmDash"

git add components\admin\AdminDashboard.tsx app\onboarding\page.tsx
git commit -m "Fix character encoding: checkmark and em-dash corrupt bytes"
git push origin master

Write-Host ""
Write-Host "Done." -ForegroundColor Cyan
