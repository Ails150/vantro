"""
patch_timeoff_guards.py
Run from C:\\vantro:    python patch_timeoff_guards.py

Wires approved time-off and public-holiday awareness into three places:

  1. app/api/notifications/cron/route.ts
     - Adds a getProtectedUserIds() helper
     - In the sign-in reminder loop, skips installers who are on approved
       time off or whose company is observing a public holiday today

  2. app/api/location/route.ts
     - Before logging a GPS breadcrumb, checks for approved time off today
     - If the installer is on time off, skips the insert (returns 200 with skipped flag)

  3. app/api/admin/time-report/route.ts
     - When computing per-installer summary, also fetches approved time-off days
       in the period and exposes time_off_days on each summary row
     - Compliance score denominator unchanged (we don't have a baseline of
       expected-vs-actual yet); just exposes the data so it's visible

Idempotent — safe to re-run.
"""

import os, sys, re

CRON = os.path.join("app", "api", "notifications", "cron", "route.ts")
LOCATION = os.path.join("app", "api", "location", "route.ts")
TIMEREPORT = os.path.join("app", "api", "admin", "time-report", "route.ts")


def read(path):
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def write(path, content):
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(content)


# ────────────────────────────────────────────────────────────────────
# Patch 1: notifications cron
# ────────────────────────────────────────────────────────────────────

CRON_HELPER = '''
// timeoff_guard_helper
// Returns the set of user_ids who are on approved time off today or whose
// company is observing a public holiday. Defensive: empty set on any error.
async function getProtectedUserIds(service: any, companyIds: string[], date: Date): Promise<Set<string>> {
  const protectedIds = new Set<string>()
  if (!companyIds.length) return protectedIds
  const dateStr = date.toISOString().slice(0, 10)
  try {
    const { data: timeOff } = await service
      .from("time_off_entries")
      .select("user_id")
      .in("company_id", companyIds)
      .eq("status", "approved")
      .lte("start_date", dateStr)
      .gte("end_date", dateStr)
    for (const t of timeOff || []) protectedIds.add(t.user_id)

    const { data: companies } = await service
      .from("companies")
      .select("id, country_code")
      .in("id", companyIds)
    const countryByCompany: Record<string, string> = {}
    const countries = new Set<string>()
    for (const c of companies || []) {
      const cc = c.country_code || "GB"
      countryByCompany[c.id] = cc
      countries.add(cc)
    }

    if (countries.size > 0) {
      const { data: holidays } = await service
        .from("public_holidays")
        .select("country_code")
        .in("country_code", Array.from(countries))
        .eq("holiday_date", dateStr)
      const holidayCountries = new Set((holidays || []).map((h: any) => h.country_code))
      if (holidayCountries.size > 0) {
        const affectedCompanies = companyIds.filter(
          (id) => holidayCountries.has(countryByCompany[id])
        )
        if (affectedCompanies.length > 0) {
          const { data: users } = await service
            .from("users")
            .select("id")
            .in("company_id", affectedCompanies)
            .or("is_active.is.null,is_active.eq.true")
          for (const u of users || []) protectedIds.add(u.id)
        }
      }
    }
  } catch (err) {
    console.error("[cron] getProtectedUserIds failed", err)
  }
  return protectedIds
}
'''


def patch_cron():
    if not os.path.exists(CRON):
        print(f"  SKIP: {CRON} not found")
        return False
    src = read(CRON)
    if "timeoff_guard_helper" in src:
        print(f"  cron already patched")
        return True

    # Insert the helper function right after the distanceMetres function definition.
    # We anchor on the closing brace of distanceMetres.
    anchor = "  return 2 * R * Math.asin(Math.sqrt(a))\n}\n"
    if anchor not in src:
        print("  ERROR: could not find anchor (distanceMetres closing brace) in cron file")
        return False
    src = src.replace(anchor, anchor + CRON_HELPER, 1)

    # Inject the protectedIds fetch + skip logic into the sign-in reminder loop.
    # Anchor: the line that opens the activeJobs loop.
    old_block = '''  if (activeJobs) {
    for (const job of activeJobs) {'''
    new_block = '''  // timeoff_guard_loop
  if (activeJobs && activeJobs.length > 0) {
    const companyIds = Array.from(new Set(activeJobs.map((j: any) => j.company_id)))
    const protectedIds = await getProtectedUserIds(service, companyIds, today)
    for (const job of activeJobs) {'''
    if old_block not in src:
        print("  WARN: could not find sign-in reminder loop anchor (no skip injected)")
    else:
        src = src.replace(old_block, new_block, 1)

    # Inject the skip inside the assignment loop, before sendPushNotification fires.
    skip_anchor = "          if (!user?.push_token || signedInIds.has(assignment.user_id)) continue\n"
    skip_inject = '''          if (!user?.push_token || signedInIds.has(assignment.user_id)) continue
          if (protectedIds.has(assignment.user_id)) {
            results.time_off_skipped = (results.time_off_skipped || 0) + 1
            continue
          }
'''
    if skip_anchor in src:
        src = src.replace(skip_anchor, skip_inject, 1)
    else:
        print("  WARN: could not find skip injection point (signedInIds check)")

    # Initialise the new counter in the results object
    src = src.replace(
        'reminders_sent: 0, admin_alerts: 0, auto_closed: 0',
        'reminders_sent: 0, admin_alerts: 0, auto_closed: 0, time_off_skipped: 0',
        1,
    )

    write(CRON, src)
    print(f"  PATCHED: {CRON}")
    return True


# ────────────────────────────────────────────────────────────────────
# Patch 2: location route
# ────────────────────────────────────────────────────────────────────


def patch_location():
    if not os.path.exists(LOCATION):
        print(f"  SKIP: {LOCATION} not found")
        return False
    src = read(LOCATION)
    if "timeoff_guard_location" in src:
        print(f"  location already patched")
        return True

    # Insert a time-off check after we've resolved company_id but before insert.
    anchor = "  if (!me?.company_id) return NextResponse.json({ error: 'No company' }, { status: 400 })\n"
    if anchor not in src:
        print("  ERROR: could not find anchor in location route")
        return False

    inject = '''  if (!me?.company_id) return NextResponse.json({ error: 'No company' }, { status: 400 })

  // timeoff_guard_location
  // Skip GPS log if installer is on approved time off today.
  // Also skip if their company is observing a public holiday today.
  try {
    const todayStr = new Date().toISOString().slice(0, 10)
    const { data: tOff } = await service
      .from('time_off_entries')
      .select('id')
      .eq('user_id', installer.userId)
      .eq('status', 'approved')
      .lte('start_date', todayStr)
      .gte('end_date', todayStr)
      .limit(1)
    if (tOff && tOff.length > 0) {
      return NextResponse.json({ success: true, skipped: 'time_off' })
    }
    const { data: cmp } = await service
      .from('companies')
      .select('country_code')
      .eq('id', me.company_id)
      .single()
    if (cmp?.country_code) {
      const { data: ph } = await service
        .from('public_holidays')
        .select('id')
        .eq('country_code', cmp.country_code)
        .eq('holiday_date', todayStr)
        .limit(1)
      if (ph && ph.length > 0) {
        return NextResponse.json({ success: true, skipped: 'public_holiday' })
      }
    }
  } catch (err) {
    console.error('[location] timeoff guard check failed', err)
    // fall through and log GPS as normal
  }
'''
    src = src.replace(anchor, inject, 1)
    write(LOCATION, src)
    print(f"  PATCHED: {LOCATION}")
    return True


# ────────────────────────────────────────────────────────────────────
# Patch 3: time-report — expose time_off_days per installer
# ────────────────────────────────────────────────────────────────────


def patch_timereport():
    if not os.path.exists(TIMEREPORT):
        print(f"  SKIP: {TIMEREPORT} not found")
        return False
    src = read(TIMEREPORT)
    if "timeoff_guard_report" in src:
        print(f"  time-report already patched")
        return True

    # Inject query to fetch approved time off in the period, before the byUser loop.
    anchor = '  // Group by user for summary\n'
    if anchor not in src:
        print("  ERROR: could not find anchor in time-report")
        return False

    inject = '''  // timeoff_guard_report
  // Fetch approved time off in the period so we can expose it on each installer's summary
  function daysBetween(a: string, b: string, half: boolean): number {
    if (half) return 0.5
    const s = new Date(a + "T00:00:00Z").getTime()
    const e = new Date(b + "T00:00:00Z").getTime()
    return Math.round((e - s) / 86400000) + 1
  }
  const { data: timeOffEntries } = await service
    .from("time_off_entries")
    .select("user_id, type, start_date, end_date, is_half_day")
    .eq("company_id", u.company_id)
    .eq("status", "approved")
    .lte("start_date", endDate)
    .gte("end_date", startDate)
  const timeOffByUser: Record<string, { total: number; by_type: Record<string, number> }> = {}
  for (const e of timeOffEntries || []) {
    const days = daysBetween(e.start_date, e.end_date, !!e.is_half_day)
    if (!timeOffByUser[e.user_id]) timeOffByUser[e.user_id] = { total: 0, by_type: {} }
    timeOffByUser[e.user_id].total += days
    timeOffByUser[e.user_id].by_type[e.type] = (timeOffByUser[e.user_id].by_type[e.type] || 0) + days
  }

  // Group by user for summary
'''
    src = src.replace(anchor, inject, 1)

    # Add time_off_days fields to each summary row
    old_summary = '''    return {
      ...u,
      early_departure_count: u.early_departure_count || 0,
      early_departure_minutes_total: u.early_departure_minutes_total || 0,
      compliance_score: complianceScore,
    }'''
    new_summary = '''    const timeOff = timeOffByUser[u.user_id] || { total: 0, by_type: {} }
    return {
      ...u,
      early_departure_count: u.early_departure_count || 0,
      early_departure_minutes_total: u.early_departure_minutes_total || 0,
      compliance_score: complianceScore,
      time_off_days: timeOff.total,
      time_off_by_type: timeOff.by_type,
    }'''
    if old_summary not in src:
        print("  WARN: could not find summary return statement to patch")
    else:
        src = src.replace(old_summary, new_summary, 1)

    write(TIMEREPORT, src)
    print(f"  PATCHED: {TIMEREPORT}")
    return True


def main():
    cwd = os.getcwd()
    if not cwd.lower().endswith("vantro"):
        print(f"WARNING: cwd is {cwd}")
        print("Run from C:\\vantro. Continue anyway? (y/n)")
        if input().strip().lower() != "y":
            sys.exit(1)

    print("Patching timeoff guards...")
    print()
    ok1 = patch_cron()
    print()
    ok2 = patch_location()
    print()
    ok3 = patch_timereport()
    print()
    if ok1 and ok2 and ok3:
        print("All three patches applied.")
    else:
        print("WARNING: not all patches applied cleanly. Review output above.")
    print()
    print("Next:  npm run build, then commit and push.")


if __name__ == "__main__":
    main()
