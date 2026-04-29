"""
remove_debug_banner.py
Save to: C:\\vantro\\remove_debug_banner.py
Run from C:\\vantro:    python remove_debug_banner.py

Removes the purple debug box that we added to diagnose the RLS bug.
The amber over-limit banner stays — that's the real feature.

Idempotent.
"""
import os, sys

TARGET = os.path.join("components", "admin", "AdminDashboard.tsx")


def main():
    if not os.getcwd().lower().endswith("vantro"):
        print(f"WARNING: cwd is {os.getcwd()}")
        sys.exit(1)

    if not os.path.exists(TARGET):
        print(f"ERROR: {TARGET} not found")
        sys.exit(1)

    with open(TARGET, "r", encoding="utf-8") as f:
        src = f.read()

    if "// banner_debug_v2" not in src:
        print("  no debug box found - already clean")
        return

    old = '''            {/* banner_debug_v2 - REMOVE AFTER TESTING */}
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
        print("  ERROR: debug box anchor not found")
        sys.exit(1)
    src = src.replace(old, "")

    with open(TARGET, "w", encoding="utf-8", newline="\n") as f:
        f.write(src)
    print(f"  PATCHED: {TARGET}")
    print("  Purple debug box removed. Amber over-limit banner kept.")


if __name__ == "__main__":
    main()
