# Offline Mode Bugs — Found in testing 02 May 2026, ~midnight

Confirmed working:
- Home screen offline banner + cached jobs list ✅
- Site Diary offline banner + cached entries ✅
- Diary entry queue + auto-sync (text + photo) ✅
- "Queued — Entry will sync when online" UX ✅

## Bug 1: Defects screen - no offline support
File: app/(installer)/defects.tsx (or similar - confirm path)
Symptom: TypeError: Network when "Log defect" pressed offline
Pattern to copy: Diary screen's queue + "Queued" dialog
Fix: wrap defect submit in try/catch, queue to AsyncStorage if offline,
     show "Queued" dialog same as Diary, sync on reconnect.

## Bug 2: QA Checklists - no offline cache or queue
File: likely app/(installer)/checklists.tsx
Symptom: Infinite "Loading checklists..." + TypeError: Network
         No cached checklist data, no error state, no queue.
Fix:
  (a) Cache checklist templates to AsyncStorage on every successful fetch
  (b) On load, hydrate from cache first, fetch in background
  (c) Queue completion submissions when offline
  (d) Show "Offline — showing cached" banner like Diary

## Bug 3: activeShift hydrate fails offline
Symptom: "[activeShift] hydrate failed TypeError: Net..."
         Console-only currently, doesn't crash UI but means shift
         state can't restore from a fresh app open while offline.
Fix: hydrate logic should fall back to AsyncStorage cached shift state
     when network fetch fails. Search codebase for "activeShift" hydrate
     to find the function.

## Bug 4: location service network error
Symptom: "[location] network error foreground TypeE..."
Likely cause: sign-in trying to call a location-related API endpoint
              that doesn't exist or is unreachable.
Fix: identify which call this is, wrap in try/catch with offline fallback.

## Bug 5: Cosmetic - emoji mojibake on Defects screen
File: same as Bug 1
Symptom: "ðŸ"· Add photo" instead of "📷 Add photo"
Cause: UTF-8 BOM/encoding issue we've seen before in TSX files
Fix: re-save file with UTF-8 no BOM, replace mangled bytes with proper emoji.

## Sidebar reorganisation (web admin, separate task)
File: components/admin/AdminSidebar.tsx (or similar)
- Move "Alerts" from Setup section to Operations section.
- Find/add "Checklists" — Aileen reports she gets confused finding it.
  Currently no Checklists entry in sidebar. Add to Operations section.

## Test plan (run all of these for each fix)
1. npx expo start in C:\vantro-mobile
2. Open Expo Go, log in as installer
3. Use the affected feature online once (caches data)
4. Turn on airplane mode
5. Try the affected feature - should work or queue gracefully
6. Turn airplane mode off - queued items should auto-sync within 5-10 sec
7. Verify in admin web that synced items appear