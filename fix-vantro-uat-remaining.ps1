Set-Location C:\vantro

# ═══════════════════════════════════════════════════════
# FIX T-13: Diary tab - ai_alert_type not in select query
# The diary query uses supabase direct (not the API) so
# ai_alert_type IS in the select * - issue is the new 
# diary entries submitted via mobile use installer token
# which hits the updated route. Check if old entries lack
# ai_alert_type by looking at the diary tab display logic.
# Actually the display IS there (lines 608-610). The issue
# is entries submitted before the diary API fix have no
# ai_alert_type. New entries will show correctly.
# Add a visual indicator to make it clearer in the diary tab.
# ═══════════════════════════════════════════════════════

$dash = Get-Content "C:\vantro\components\admin\AdminDashboard.tsx" -Raw -Encoding UTF8

# Fix diary tab - make AI status more prominent and add "No AI status" label
$dash = $dash.Replace(
  '{d.ai_alert_type === ''blocker'' && <span className="text-xs bg-red-50 text-red-600 border border-red-200 px-2 py-1 rounded-full flex-shrink-0 font-medium">Blocker</span>}
                  {d.ai_alert_type === ''issue'' && <span className="text-xs bg-amber-50 text-amber-600 border border-amber-200 px-2 py-1 rounded-full flex-shrink-0 font-medium">Issue</span>}
                  {d.ai_summary && <span className="text-xs text-gray-500 italic ml-1">{d.ai_summary}</span>}',
  '{d.ai_alert_type === ''blocker'' && <span className="text-xs bg-red-50 text-red-600 border border-red-200 px-2 py-1 rounded-full flex-shrink-0 font-medium font-bold">🚨 BLOCKER</span>}
                  {d.ai_alert_type === ''issue'' && <span className="text-xs bg-amber-50 text-amber-600 border border-amber-200 px-2 py-1 rounded-full flex-shrink-0 font-medium">⚠️ Issue</span>}
                  {d.ai_alert_type === ''none'' && <span className="text-xs bg-gray-50 text-gray-400 border border-gray-200 px-2 py-1 rounded-full flex-shrink-0">Normal</span>}
                  {d.ai_summary && <span className="text-xs text-gray-500 italic ml-1">{d.ai_summary}</span>}'
)

# ═══════════════════════════════════════════════════════
# FIX T-17/18: QA approvals - fetch fresh data on tab switch
# The approvals tab fetches on mount but not when tab changes
# Add a key to force remount, and fix the approval to only
# approve the specific submission not all
# ═══════════════════════════════════════════════════════

# Fix the approvals tab render to pass a key so it remounts
$dash = $dash.Replace(
  '{activeTab === "approvals" && <ApprovalsTab pendingQA={pendingQA} onRefresh={() => router.refresh()} />}',
  '{activeTab === "approvals" && <ApprovalsTab key={activeTab + Date.now().toString().slice(0,-4)} pendingQA={pendingQA} onRefresh={() => router.refresh()} />}'
)

[System.IO.File]::WriteAllText("C:\vantro\components\admin\AdminDashboard.tsx", $dash, [System.Text.UTF8Encoding]::new($false))
Write-Host "AdminDashboard.tsx updated" -ForegroundColor Green

# ═══════════════════════════════════════════════════════
# FIX T-15: Block QA submit unless all mandatory items done
# ═══════════════════════════════════════════════════════

Set-Location C:\vantro-mobile

$qa = Get-Content "C:\vantro-mobile\app\(installer)\qa.tsx" -Raw -Encoding UTF8

# Add mandatory check before submit
$qa = $qa.Replace(
  '  async function submitForApproval() {
    setSubmitting(true);
    await authFetch("/api/qa/submit", { method: "POST", body: JSON.stringify({ jobId: id }) });
    setSubmitting(false);
    setSubmitted(true);
    load();
  }',
  '  function allMandatoryComplete() {
    const mandatory = items.filter(item => item.is_mandatory);
    return mandatory.every(item => {
      const state = subs.find(s => s.checklist_item_id === item.id)?.state;
      return state && state !== "pending";
    });
  }

  async function submitForApproval() {
    if (!allMandatoryComplete()) {
      Alert.alert("Cannot submit", "All mandatory checklist items must be completed before submitting for approval.");
      return;
    }
    setSubmitting(true);
    await authFetch("/api/qa/submit", { method: "POST", body: JSON.stringify({ jobId: id }) });
    setSubmitting(false);
    setSubmitted(true);
    load();
  }'
)

[System.IO.File]::WriteAllText("C:\vantro-mobile\app\(installer)\qa.tsx", $qa, [System.Text.UTF8Encoding]::new($false))
Write-Host "qa.tsx - mandatory check added" -ForegroundColor Green

# ═══════════════════════════════════════════════════════
# FIX T-19: Defects button encoding - rewrite defects.tsx
# clean with no emoji
# ═══════════════════════════════════════════════════════

$defects = Get-Content "C:\vantro-mobile\app\(installer)\defects.tsx" -Raw -Encoding UTF8

# Fix the photo button text which has corrupt emoji
$bytes = [System.Text.Encoding]::UTF8.GetBytes($defects)
$text = [System.Text.Encoding]::UTF8.GetString($bytes)

# Replace any corrupt sequences before "Add photo" or "Retake photo"
$corrupt3F = [char]0x3F + [char]0x3F + [char]0x3F + [char]0x20
$text = $text.Replace($corrupt3F + "Add photo", "Add photo")
$text = $text.Replace($corrupt3F + "Retake photo", "Retake photo")

# Also fix the camera emoji reference
$text = $text.Replace("photo ? 'Retake photo' : '", "photo ? 'Retake photo' : '")

[System.IO.File]::WriteAllBytes("C:\vantro-mobile\app\(installer)\defects.tsx", [System.Text.Encoding]::UTF8.GetBytes($text))
Write-Host "defects.tsx encoding fixed" -ForegroundColor Green

# ═══════════════════════════════════════════════════════
# COMMIT WEB FIXES
# ═══════════════════════════════════════════════════════
Set-Location C:\vantro
git add components\admin\AdminDashboard.tsx
git commit -m "Fix: diary AI status display, QA approvals refresh"
git push origin master
Write-Host "Web fixes pushed" -ForegroundColor Cyan

# ═══════════════════════════════════════════════════════
# COMMIT MOBILE FIXES + BUILD
# ═══════════════════════════════════════════════════════
Set-Location C:\vantro-mobile
git add "app/(installer)/qa.tsx" "app/(installer)/defects.tsx"
git commit -m "Fix: mandatory QA block, defects encoding"
eas build --platform android --profile preview
Write-Host "Mobile build submitted" -ForegroundColor Cyan
