"""
debug_banner.py
Run from C:\\vantro:    python debug_banner.py

Adds a temporary debug line that ALWAYS renders showing limit + active count.
Once we see what those values actually are, we'll know what the bug is.

Run, push, refresh, see the values, then tell me what they are.

Idempotent.
"""
import os, sys

TARGET = os.path.join("components", "admin", "AdminDashboard.tsx")


def main():
    if not os.getcwd().lower().endswith("vantro"):
        print(f"WARNING: cwd is {os.getcwd()}")
        sys.exit(1)

    with open(TARGET, "r", encoding="utf-8") as f:
        src = f.read()

    if "// banner_debug_temp" in src:
        print("  already added")
        return

    old = '''            {/* installer_limit_enforced_v1 banner */}
            {/* banner_data_source_fix_v1: read from company prop, not userData.companies */}
            {(() => {
              const limit = (company as any)?.installer_limit
              const active = teamMembers.filter((m: any) => ["installer","foreman"].includes(m.role) && m.is_active !== false).length
              if (limit && active > limit) {'''

    new = '''            {/* installer_limit_enforced_v1 banner */}
            {/* banner_data_source_fix_v1: read from company prop, not userData.companies */}
            {/* banner_debug_temp - REMOVE AFTER TESTING */}
            {(() => {
              const limit = (company as any)?.installer_limit
              const active = teamMembers.filter((m: any) => ["installer","foreman"].includes(m.role) && m.is_active !== false).length
              return (
                <div className="bg-purple-100 border border-purple-300 rounded-2xl p-4 text-sm text-purple-800 mb-2">
                  DEBUG: company.installer_limit = <strong>{String(limit)}</strong> (type: {typeof limit}) — active count = <strong>{active}</strong> — would show banner = <strong>{String(!!(limit && active > limit))}</strong>
                </div>
              )
            })()}
            {(() => {
              const limit = (company as any)?.installer_limit
              const active = teamMembers.filter((m: any) => ["installer","foreman"].includes(m.role) && m.is_active !== false).length
              if (limit && active > limit) {'''

    if old not in src:
        print("  ERROR: anchor not found")
        sys.exit(1)
    src = src.replace(old, new)

    with open(TARGET, "w", encoding="utf-8", newline="\n") as f:
        f.write(src)
    print(f"  PATCHED: {TARGET}")
    print("  A purple debug box will show on Team tab with limit/active values.")
    print("  Once we see the values, we'll know what the bug is.")
    print("  REMEMBER TO REVERT after testing.")


if __name__ == "__main__":
    main()
