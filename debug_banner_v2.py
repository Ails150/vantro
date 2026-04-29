"""
debug_banner_v2.py
Run from C:\\vantro:    python debug_banner_v2.py

Updates the debug box to show ALL keys in the company prop, not just installer_limit.
This reveals if the company object is empty, missing, or just missing one field.
"""
import os, sys

TARGET = os.path.join("components", "admin", "AdminDashboard.tsx")


def main():
    if not os.getcwd().lower().endswith("vantro"):
        sys.exit(1)

    with open(TARGET, "r", encoding="utf-8") as f:
        src = f.read()

    if "// banner_debug_v2" in src:
        print("  already at v2")
        return

    old = '''            {/* banner_debug_temp - REMOVE AFTER TESTING */}
            {(() => {
              const limit = (company as any)?.installer_limit
              const active = teamMembers.filter((m: any) => ["installer","foreman"].includes(m.role) && m.is_active !== false).length
              return (
                <div className="bg-purple-100 border border-purple-300 rounded-2xl p-4 text-sm text-purple-800 mb-2">
                  DEBUG: company.installer_limit = <strong>{String(limit)}</strong> (type: {typeof limit}) — active count = <strong>{active}</strong> — would show banner = <strong>{String(!!(limit && active > limit))}</strong>
                </div>
              )
            })()}'''

    new = '''            {/* banner_debug_v2 - REMOVE AFTER TESTING */}
            {(() => {
              const c = company as any
              const limit = c?.installer_limit
              const active = teamMembers.filter((m: any) => ["installer","foreman"].includes(m.role) && m.is_active !== false).length
              const companyKeys = c ? Object.keys(c).join(", ") : "(company is null/undefined)"
              return (
                <div className="bg-purple-100 border border-purple-300 rounded-2xl p-4 text-xs text-purple-800 mb-2 break-all">
                  <div>DEBUG company prop type: <strong>{typeof c}</strong></div>
                  <div>company.installer_limit = <strong>{String(limit)}</strong> (type: {typeof limit})</div>
                  <div>active count = <strong>{active}</strong></div>
                  <div>company keys: <strong>{companyKeys}</strong></div>
                  <div>company JSON (first 500 chars): <strong>{c ? JSON.stringify(c).slice(0, 500) : "null"}</strong></div>
                </div>
              )
            })()}'''

    if old not in src:
        print("  ERROR: v1 anchor not found")
        sys.exit(1)
    src = src.replace(old, new)

    with open(TARGET, "w", encoding="utf-8", newline="\n") as f:
        f.write(src)
    print(f"  PATCHED: {TARGET}")
    print("  Now shows full company keys + JSON in purple box.")


if __name__ == "__main__":
    main()
