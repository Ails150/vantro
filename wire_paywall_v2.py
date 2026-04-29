"""
wire_paywall_v2.py
Save to: C:\\vantro\\wire_paywall_v2.py
Run: python wire_paywall_v2.py

v2: Renders PaywallOverlay INSIDE the existing root div (not wrapping in fragment).
The overlay uses position:fixed so it floats above content anyway.

Idempotent.
"""
import os, sys, re

TARGET = os.path.join("components", "admin", "AdminDashboard.tsx")


def main():
    if not os.getcwd().lower().endswith("vantro"):
        print("Not in vantro dir")
        sys.exit(1)

    with open(TARGET, "r", encoding="utf-8") as f:
        src = f.read()

    if "paywall_wired_v2" in src:
        print("  already wired")
        return

    actions = []

    # 1. Add import
    if "import PaywallOverlay from" not in src:
        import_pattern = re.compile(r'^import .*$', re.MULTILINE)
        matches = list(import_pattern.finditer(src))
        if matches:
            last_import = matches[-1]
            insert_pos = last_import.end()
            src = src[:insert_pos] + "\nimport PaywallOverlay from '@/components/billing/PaywallOverlay' // paywall_wired_v2" + src[insert_pos:]
            actions.append("added PaywallOverlay import")

    # 2. Add to Props type
    props_match = re.search(r'(\s+checklistTemplates: any\[\]; diaryEntries: any\[\]; resolvedAlerts: any\[\]; defaultTab: string)', src)
    if props_match and "trialExpiredAndUnpaid" not in src[max(0, props_match.start()-200):props_match.end()+200]:
        old = props_match.group(1)
        new = old + "; trialExpiredAndUnpaid?: boolean"
        src = src.replace(old, new)
        actions.append("added trialExpiredAndUnpaid to Props")

    # 3. Add to destructured params
    func_sig_match = re.search(
        r'(export default function AdminDashboard\(\{ )([^}]+?)(\s*\}: Props\))',
        src
    )
    if func_sig_match:
        params = func_sig_match.group(2)
        if "trialExpiredAndUnpaid" not in params:
            new_params = params.rstrip().rstrip(',') + ", trialExpiredAndUnpaid"
            new_sig = func_sig_match.group(1) + new_params + func_sig_match.group(3)
            src = src.replace(func_sig_match.group(0), new_sig)
            actions.append("added trialExpiredAndUnpaid to destructured props")

    # 4. Render PaywallOverlay INSIDE the root div, right after it opens
    # Pattern: <div className="min-h-screen bg-gray-50 text-gray-900">\n
    root_div_pattern = re.search(
        r'(<div className="min-h-screen bg-gray-50 text-gray-900">\n)',
        src
    )
    if root_div_pattern and "<PaywallOverlay" not in src:
        old = root_div_pattern.group(1)
        new = old + '        <PaywallOverlay show={!!trialExpiredAndUnpaid} companyName={company?.name} currentPlan={company?.current_plan} />\n'
        src = src.replace(old, new, 1)
        actions.append("rendered PaywallOverlay at top of root div")

    if not actions:
        print("  nothing to do - already patched or anchors missing")
        return

    with open(TARGET, "w", encoding="utf-8", newline="\n") as f:
        f.write(src)
    
    for a in actions:
        print(f"  {a}")
    print(f"PATCHED: {TARGET}")


if __name__ == "__main__":
    main()
