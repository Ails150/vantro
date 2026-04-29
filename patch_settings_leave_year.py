"""
patch_settings_leave_year.py
Run from C:\\vantro:    python patch_settings_leave_year.py

Adds leave_year_start_month and leave_year_start_day to the
/api/admin/settings allowlist so the Defaults tab can save them.

Idempotent.
"""
import os, sys

TARGET = os.path.join("app", "api", "admin", "settings", "route.ts")


def main():
    cwd = os.getcwd()
    if not cwd.lower().endswith("vantro"):
        print(f"WARNING: cwd is {cwd}")
        print("Run from C:\\vantro. Continue? (y/n)")
        if input().strip().lower() != "y":
            sys.exit(1)

    if not os.path.exists(TARGET):
        print(f"ERROR: {TARGET} not found")
        sys.exit(1)

    with open(TARGET, "r", encoding="utf-8") as f:
        src = f.read()

    if "leave_year_settings_v1" in src:
        print("  already patched")
        return

    # 1. Add to the allowlist (insert after "geofence_radius_metres")
    old_allow = '"geofence_radius_metres",'
    new_allow = '"geofence_radius_metres",\n    "leave_year_start_month",\n    "leave_year_start_day",'
    if old_allow not in src:
        print("  ERROR: allowlist anchor 'geofence_radius_metres' not found")
        sys.exit(1)
    src = src.replace(old_allow, new_allow, 1)

    # 2. Add validation block after the timezone validation
    old_tz_block = '''  if (body.timezone !== undefined) {
    const tz = String(body.timezone).trim()
    if (tz && tz.length > 64) {
      return NextResponse.json({ error: "Invalid timezone" }, { status: 400 })
    }
    updates.timezone = tz || null
  }'''

    new_tz_block = '''  if (body.timezone !== undefined) {
    const tz = String(body.timezone).trim()
    if (tz && tz.length > 64) {
      return NextResponse.json({ error: "Invalid timezone" }, { status: 400 })
    }
    updates.timezone = tz || null
  }

  // leave_year_settings_v1
  if (body.leave_year_start_month !== undefined) {
    const m = body.leave_year_start_month
    if (m === null) {
      updates.leave_year_start_month = null
    } else {
      const mNum = Number(m)
      if (!Number.isInteger(mNum) || mNum < 1 || mNum > 12) {
        return NextResponse.json(
          { error: "leave_year_start_month must be an integer 1-12 or null" },
          { status: 400 }
        )
      }
      updates.leave_year_start_month = mNum
    }
  }
  if (body.leave_year_start_day !== undefined) {
    const d = body.leave_year_start_day
    if (d === null) {
      updates.leave_year_start_day = null
    } else {
      const dNum = Number(d)
      if (!Number.isInteger(dNum) || dNum < 1 || dNum > 31) {
        return NextResponse.json(
          { error: "leave_year_start_day must be an integer 1-31 or null" },
          { status: 400 }
        )
      }
      updates.leave_year_start_day = dNum
    }
  }'''

    if old_tz_block not in src:
        print("  ERROR: timezone validation block not found")
        sys.exit(1)
    src = src.replace(old_tz_block, new_tz_block)

    with open(TARGET, "w", encoding="utf-8", newline="\n") as f:
        f.write(src)

    print(f"  PATCHED: {TARGET}")
    print()
    print("Added:")
    print("  - leave_year_start_month, leave_year_start_day to allowlist")
    print("  - validation: integer 1-12 / 1-31 or null (null = use country default)")


if __name__ == "__main__":
    main()
