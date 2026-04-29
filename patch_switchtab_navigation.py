"""
patch_switchtab_navigation.py
Run from C:\\vantro:    python patch_switchtab_navigation.py

Updates components\\admin\\AdminDashboard.tsx so the Scheduler sidebar item
(and any future href-style item) routes via Next.js router instead of being
ignored by the activeTab swap.

Three exact edits:
  1. Replace the body of switchTab() to handle href.
  2. Update sidebar render in setupTabs to pass tab object.
  3. Update sidebar render in operationsTabs to pass tab object.

Idempotent — safe to re-run.
"""
import os, sys

DASHBOARD = os.path.join("components", "admin", "AdminDashboard.tsx")


def main():
    if not os.path.exists(DASHBOARD):
        print(f"ERROR: {DASHBOARD} not found. Run from C:\\vantro.")
        sys.exit(1)

    with open(DASHBOARD, "r", encoding="utf-8") as f:
        src = f.read()

    if "switchTab_href_patched" in src:
        print("Already patched — no changes.")
        return

    # ── 1. Replace switchTab body ──
    old_switch = (
        '  function switchTab(tab: string) {\n'
        '    setActiveTab(tab)\n'
        '    try { localStorage.setItem("vantro_tab", tab) } catch {}\n'
        '  }'
    )
    new_switch = (
        '  // switchTab_href_patched\n'
        '  function switchTab(tab: { id: string; href?: string } | string) {\n'
        '    if (typeof tab === "object" && tab.href) {\n'
        '      router.push(tab.href)\n'
        '      return\n'
        '    }\n'
        '    const id = typeof tab === "string" ? tab : tab.id\n'
        '    setActiveTab(id)\n'
        '    try { localStorage.setItem("vantro_tab", id) } catch {}\n'
        '  }'
    )
    if old_switch not in src:
        print("ERROR: could not find existing switchTab body. Bailing — file untouched.")
        sys.exit(2)
    src = src.replace(old_switch, new_switch, 1)

    # ── 2. & 3. Replace both call sites: switchTab(tab.id) -> switchTab(tab) ──
    # There are exactly two occurrences (lines 476 and 497).
    old_call = "onClick={() => switchTab(tab.id)}"
    new_call = "onClick={() => switchTab(tab)}"
    count = src.count(old_call)
    if count != 2:
        print(
            f"ERROR: expected exactly 2 onClick handlers, found {count}. Bailing."
        )
        sys.exit(3)
    src = src.replace(old_call, new_call)

    with open(DASHBOARD, "w", encoding="utf-8", newline="\n") as f:
        f.write(src)

    print(f"Patched: {DASHBOARD}")
    print("  - switchTab now routes via router.push when tab has href")
    print("  - both sidebar renderers now pass the tab object")
    print()
    print("Next:  npm run build, then commit and push.")


if __name__ == "__main__":
    main()
