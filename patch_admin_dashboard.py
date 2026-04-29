"""
patch_admin_dashboard.py
Run from C:\\vantro:    python patch_admin_dashboard.py

Surgically adds a "Scheduler" sidebar item to AdminDashboard.tsx that links
to /admin/schedule. Idempotent — safe to re-run.
"""
import os, re, sys

DASHBOARD_PATH = os.path.join("components", "admin", "AdminDashboard.tsx")

def main():
    if not os.path.exists(DASHBOARD_PATH):
        print(f"ERROR: {DASHBOARD_PATH} not found. Run from C:\\vantro.")
        sys.exit(1)

    with open(DASHBOARD_PATH, "r", encoding="utf-8") as f:
        src = f.read()

    # Bail if already patched
    if "schedule_link_added" in src or '"/admin/schedule"' in src:
        print("Already patched — no changes.")
        return

    # Find the sidebar items array. It contains entries like:
    #   { id: "settings", label: "Settings" },
    # We insert a Scheduler row right BEFORE the "settings" entry so that
    # Setup section reads: Team / Jobs / Checklists / Scheduler / Settings.
    pattern = re.compile(r'(\{\s*id:\s*"settings",\s*label:\s*"Settings"\s*\},)')
    m = pattern.search(src)
    if not m:
        print(
            "Could not find sidebar items array (pattern { id: \"settings\", label: \"Settings\" })."
        )
        print("Open AdminDashboard.tsx and add manually:")
        print('  { id: "schedule", label: "Scheduler", href: "/admin/schedule" },')
        sys.exit(2)

    insertion = (
        '{ id: "schedule", label: "Scheduler", href: "/admin/schedule" }, // schedule_link_added\n    '
    )
    new_src = src[: m.start()] + insertion + src[m.start() :]

    with open(DASHBOARD_PATH, "w", encoding="utf-8", newline="\n") as f:
        f.write(new_src)
    print(f"Patched: {DASHBOARD_PATH}")
    print("Inserted Scheduler entry before Settings.")
    print()
    print("NOTE: This entry has 'href: /admin/schedule'. Your AdminDashboard")
    print("currently switches activeTab on click. To make the Scheduler link")
    print("navigate properly, you may need to update the click handler to:")
    print("  if (item.href) router.push(item.href); else setActiveTab(item.id);")
    print("Otherwise click the Settings tab → Scheduler link in 'Site rules' card.")


if __name__ == "__main__":
    main()
