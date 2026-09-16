// scripts/payroll-proof.mjs
//
// Builds the Northbridge payroll proof from the demo tenant's REAL rows.
//
//   node --experimental-strip-types scripts/payroll-proof.mjs 37
//
// It imports lib/pay.ts directly rather than reimplementing the arithmetic.
// That is the whole point: a proof computed by a second implementation proves
// that the second implementation agrees with itself. The hand-calculation in
// the markdown is written from the inputs, and the app's figure comes from the
// engine the product actually ships, so a disagreement is a real finding.
//
// Deliberately a script rather than a route: it writes pay rules and rates to a
// tenant, which is an administrative act performed once. Nothing here invents a
// shift.

import dotenv from "dotenv"
import fs from "fs"
import path from "path"
import { createClient } from "@supabase/supabase-js"
import {
  payForWeek, payableHours, splitWeek, toPayRules, latenessFor,
} from "../lib/pay.ts"

dotenv.config({ path: ".env.local", quiet: true })

const CO = "5b62307d-03b8-45cd-a9ac-224fd21282bc" // Northbridge Glazing Ltd
const NAMES = ["Marcus Vane", "Priya Raman", "Tom Ashworth"]
const RATES = { "Marcus Vane": 22, "Priya Raman": 19.5, "Tom Ashworth": 18 }
const SHIFT_START = "07:30"

const RULES = {
  company_id: CO,
  round_to_minutes: null,
  rounding_direction: "nearest",
  minimum_paid_minutes: null,
  unpaid_break_minutes: null,
  break_after_hours: null,
  lateness_grace_minutes: 5,
  overtime_daily_threshold_hours: 8,
  overtime_weekly_threshold_hours: 40,
  overtime_multiplier: 1.5,
  bank_holiday_multiplier: 2.0,
  saturday_multiplier: 1.5,
  sunday_multiplier: 2.0,
}

const service = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
)

const london = (iso, opts) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", ...opts }).format(new Date(iso))
const hhmm = iso => london(iso, { hour: "2-digit", minute: "2-digit", hour12: false })
const dateKey = iso =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(iso))
const r2 = n => Math.round(n * 100) / 100

function isoWeekRange(year, week) {
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const jan4Dow = (jan4.getUTCDay() + 6) % 7
  const week1Mon = new Date(jan4)
  week1Mon.setUTCDate(jan4.getUTCDate() - jan4Dow)
  const start = new Date(week1Mon)
  start.setUTCDate(week1Mon.getUTCDate() + (week - 1) * 7)
  const end = new Date(start)
  end.setUTCDate(start.getUTCDate() + 7)
  return { start, end }
}

async function main() {
  const week = Number(process.argv[2] || 37)
  const { start, end } = isoWeekRange(2026, week)
  const lastDay = new Date(end.getTime() - 86400000)

  const { error: rulesErr } = await service
    .from("pay_rules").upsert(RULES, { onConflict: "company_id" })
  if (rulesErr) throw new Error(`pay_rules: ${rulesErr.message}`)

  const { data: company } = await service
    .from("companies").select("id, name, country_code").eq("id", CO).single()

  const { data: workers, error: wErr } = await service
    .from("users").select("id, name").eq("company_id", CO).in("name", NAMES)
  if (wErr) throw new Error(`users: ${wErr.message}`)

  for (const w of workers) {
    const { error } = await service
      .from("users")
      .update({ hourly_rate: RATES[w.name], sign_in_time: `${SHIFT_START}:00` })
      .eq("id", w.id)
    if (error) throw new Error(`rate ${w.name}: ${error.message}`)
  }

  const { data: storedRules } = await service
    .from("pay_rules").select("*").eq("company_id", CO).single()
  const rules = toPayRules(storedRules)

  const ids = workers.map(w => w.id)
  const { data: shifts, error: sErr } = await service
    .from("signins")
    .select("id, user_id, signed_in_at, signed_out_at, hours_worked, jobs(name, start_time)")
    .in("user_id", ids)
    .gte("signed_in_at", start.toISOString())
    .lt("signed_in_at", end.toISOString())
    .order("signed_in_at")
  if (sErr) throw new Error(`signins: ${sErr.message}`)

  const { data: bonuses } = await service
    .from("pay_bonuses").select("user_id, amount, reason, awarded_on")
    .eq("company_id", CO)
    .gte("awarded_on", dateKey(start.toISOString()))
    .lte("awarded_on", dateKey(lastDay.toISOString()))

  // Holidays are filtered by the COMPANY'S country. The first version of this
  // script did not, and picked up US Labor Day on 7 September -- which would
  // have paid all three workers double time for a Monday. The application's own
  // queries have always filtered correctly; this was a bug in the proof.
  const { data: holidays } = await service
    .from("public_holidays").select("holiday_date, name, country_code")
    .eq("country_code", company.country_code)
    .gte("holiday_date", dateKey(start.toISOString()))
    .lte("holiday_date", dateKey(lastDay.toISOString()))
  const holidaySet = new Set((holidays || []).map(h => h.holiday_date))

  const report = {
    week,
    from: dateKey(start.toISOString()),
    to: dateKey(lastDay.toISOString()),
    company: company.name,
    countryCode: company.country_code,
    holidays: holidays || [],
    rules: storedRules,
    workers: [],
  }

  for (const w of workers) {
    const rate = RATES[w.name]
    const mine = (shifts || []).filter(s => s.user_id === w.id)

    const rows = mine.map(s => {
      const worked = Number(s.hours_worked ?? 0)
      const paid = payableHours(worked, rules)
      const arrived = hhmm(s.signed_in_at)
      const late = latenessFor(arrived, SHIFT_START, rules.latenessGraceMinutes)
      return {
        date: dateKey(s.signed_in_at),
        weekday: london(s.signed_in_at, { weekday: "short" }),
        in: arrived,
        out: s.signed_out_at ? hhmm(s.signed_out_at) : null,
        siteStart: String(s.jobs?.start_time ?? "").slice(0, 5),
        job: s.jobs?.name ?? null,
        workedHours: r2(worked),
        breakMinutes: rules.unpaidBreakMinutes ?? 0,
        paidHours: r2(paid),
        minutesLate: late.minutesLate,
        isLate: late.isLate,
      }
    })

    // One entry per DAY, which is what the daily overtime threshold measures.
    const byDate = new Map()
    for (const row of rows) byDate.set(row.date, r2((byDate.get(row.date) || 0) + row.paidHours))
    const days = [...byDate.entries()].map(([date, hours]) => ({ date, hours }))

    const split = splitWeek(days, holidaySet, rules)
    const pay = payForWeek(split, rate, rules)
    const mineBonus = (bonuses || []).filter(b => b.user_id === w.id)
    const bonusTotal = r2(mineBonus.reduce((a, b) => a + Number(b.amount), 0))

    report.workers.push({
      name: w.name, id: w.id, rate,
      rows, days, split, pay,
      bonuses: mineBonus, bonusTotal,
      grandTotal: r2((pay.total ?? 0) + bonusTotal),
    })
  }

  // --- The Xero export, exactly as /api/payroll/xero builds it -------------
  //
  // Replicated here rather than called, because the route requires an admin
  // browser session. The shape is copied line for line from that file: one row
  // per employee, a column per weekday, employees sorted by name, hours to two
  // decimals. If the two ever diverge, this proof is wrong and not the product.
  //
  // It covers the WHOLE company, not just the three workers, because that is
  // what the route does -- a timesheet with three of eight employees on it
  // would be a timesheet nobody could file.
  const DAY_HEADERS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
  const weekStartKey = dateKey(start.toISOString())

  const { data: allSignins } = await service
    .from("signins")
    .select("id, user_id, signed_in_at, signed_out_at, hours_worked, users:user_id (id, name, email)")
    .eq("company_id", CO)
    .gte("signed_in_at", start.toISOString())
    .lt("signed_in_at", end.toISOString())
    .order("signed_in_at", { ascending: true })

  const byEmployee = new Map()
  let totalHours = 0
  for (const s2 of allSignins || []) {
    const hours = Number(s2.hours_worked ?? 0)
    totalHours += hours
    const dayIndex = DAY_HEADERS.indexOf(london(s2.signed_in_at, { weekday: "short" }))
    if (dayIndex < 0) continue
    const entry = byEmployee.get(s2.user_id) || {
      name: s2.users?.name || "Unknown",
      email: s2.users?.email || "",
      days: [0, 0, 0, 0, 0, 0, 0],
    }
    entry.days[dayIndex] += hours
    byEmployee.set(s2.user_id, entry)
  }

  const ref = `VTR-TS-${weekStartKey.replace(/-/g, "")}`

  const { data: adminUser } = await service
    .from("users").select("id").eq("company_id", CO).eq("role", "admin").limit(1).single()

  const { data: exportRow, error: expErr } = await service
    .from("payroll_exports")
    .upsert({
      company_id: CO,
      exported_by: adminUser?.id ?? null,
      date_from: start.toISOString(),
      date_to: end.toISOString(),
      signin_count: (allSignins || []).length,
      total_hours: Number(totalHours.toFixed(2)),
      xero_week_start: weekStartKey,
      xero_timesheet_ref: ref,
      updated_at: new Date().toISOString(),
    }, { onConflict: "company_id,xero_week_start" })
    .select("id, xero_timesheet_ref")
    .single()
  if (expErr) throw new Error(`payroll_exports: ${expErr.message}`)

  const csvEscape = v => {
    if (v === null || v === undefined) return ""
    const t = String(v)
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
  }
  const dayLabel = i => {
    const d = new Date(start.getTime() + i * 86400000)
    return london(d.toISOString(), { day: "2-digit", month: "short" })
  }
  const header = [
    "Employee", "Email", "Earnings Rate",
    ...DAY_HEADERS.map((d, i) => `${d} ${dayLabel(i)}`),
    "Total",
  ]
  const csvLines = [header.join(",")]
  for (const e of [...byEmployee.values()].sort((a2, b2) => a2.name.localeCompare(b2.name))) {
    const t = e.days.reduce((acc, h) => acc + h, 0)
    csvLines.push([
      csvEscape(e.name), csvEscape(e.email), csvEscape("Ordinary Hours"),
      ...e.days.map(h => csvEscape(h.toFixed(2))),
      csvEscape(t.toFixed(2)),
    ].join(","))
  }

  report.xero = {
    ref: exportRow.xero_timesheet_ref,
    exportId: exportRow.id,
    weekStart: weekStartKey,
    employees: byEmployee.size,
    signinCount: (allSignins || []).length,
    totalHours: Number(totalHours.toFixed(2)),
    csv: csvLines.join("\n"),
  }

  fs.mkdirSync(path.join(process.cwd(), "docs", "payroll"), { recursive: true })
  fs.writeFileSync(path.join(process.cwd(), "docs", "payroll", `${ref}.csv`), csvLines.join("\n") + "\n")
  const out = path.join(process.cwd(), "docs", "payroll", `week${week}-data.json`)
  fs.writeFileSync(out, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  console.error(`\nwrote ${out}`)
}

main().catch(err => { console.error(err); process.exit(1) })
