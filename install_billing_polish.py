"""
install_billing_polish.py
Save to: C:\\vantro\\install_billing_polish.py
Run from C:\\vantro:    python install_billing_polish.py

Polishes the existing Stripe billing stack:
  1. Updates lib/billing.ts prices: 199/299/449 -> 299/399/499
  2. Creates app/api/billing/portal/route.ts (Customer Portal endpoint)
  3. Patches AdminDashboard.tsx:
     - Adds "Upgrade plan" button on over-limit amber banner
     - Adds handleOpenBillingPortal helper
  4. Adds audit logging to webhook (idempotent by stripe_event_id)

Idempotent. Safe to re-run.
"""
import base64, os, sys

PORTAL_API = os.path.join("app", "api", "billing", "portal", "route.ts")
BILLING_LIB = os.path.join("lib", "billing.ts")
DASHBOARD = os.path.join("components", "admin", "AdminDashboard.tsx")
WEBHOOK = os.path.join("app", "api", "billing", "webhook", "route.ts")

PORTAL_B64 = "aW1wb3J0IHsgTmV4dFJlc3BvbnNlIH0gZnJvbSAnbmV4dC9zZXJ2ZXInCmltcG9ydCB7IGNyZWF0ZUNsaWVudCwgY3JlYXRlU2VydmljZUNsaWVudCB9IGZyb20gJ0AvbGliL3N1cGFiYXNlL3NlcnZlcicKaW1wb3J0IFN0cmlwZSBmcm9tICdzdHJpcGUnCgpjb25zdCBzdHJpcGUgPSBuZXcgU3RyaXBlKHByb2Nlc3MuZW52LlNUUklQRV9TRUNSRVRfS0VZISkKCi8vIFBPU1QgL2FwaS9iaWxsaW5nL3BvcnRhbAovLyBHZW5lcmF0ZXMgYSBTdHJpcGUgQ3VzdG9tZXIgUG9ydGFsIHNlc3Npb24gZm9yIHRoZSBsb2dnZWQtaW4gYWRtaW4ncyBjb21wYW55LgovLyBSZXR1cm5zIHsgdXJsIH0gdG8gcmVkaXJlY3QgdG8uCmV4cG9ydCBhc3luYyBmdW5jdGlvbiBQT1NUKCkgewogIGNvbnN0IHN1cGFiYXNlID0gYXdhaXQgY3JlYXRlQ2xpZW50KCkKICBjb25zdCB7IGRhdGE6IHsgdXNlciB9IH0gPSBhd2FpdCBzdXBhYmFzZS5hdXRoLmdldFVzZXIoKQogIGlmICghdXNlcikgcmV0dXJuIE5leHRSZXNwb25zZS5qc29uKHsgZXJyb3I6ICdVbmF1dGhvcmlzZWQnIH0sIHsgc3RhdHVzOiA0MDEgfSkKCiAgY29uc3Qgc2VydmljZSA9IGF3YWl0IGNyZWF0ZVNlcnZpY2VDbGllbnQoKQogIGNvbnN0IHsgZGF0YTogdXNlckRhdGEgfSA9IGF3YWl0IHNlcnZpY2UKICAgIC5mcm9tKCd1c2VycycpCiAgICAuc2VsZWN0KCdjb21wYW55X2lkLCByb2xlJykKICAgIC5lcSgnYXV0aF91c2VyX2lkJywgdXNlci5pZCkKICAgIC5zaW5nbGUoKQogIGlmICghdXNlckRhdGEgfHwgdXNlckRhdGEucm9sZSAhPT0gJ2FkbWluJykgewogICAgcmV0dXJuIE5leHRSZXNwb25zZS5qc29uKHsgZXJyb3I6ICdPbmx5IGFkbWlucyBjYW4gbWFuYWdlIGJpbGxpbmcnIH0sIHsgc3RhdHVzOiA0MDMgfSkKICB9CgogIGNvbnN0IHsgZGF0YTogY29tcGFueSB9ID0gYXdhaXQgc2VydmljZQogICAgLmZyb20oJ2NvbXBhbmllcycpCiAgICAuc2VsZWN0KCdpZCwgbmFtZSwgc3RyaXBlX2N1c3RvbWVyX2lkJykKICAgIC5lcSgnaWQnLCB1c2VyRGF0YS5jb21wYW55X2lkKQogICAgLnNpbmdsZSgpCiAgaWYgKCFjb21wYW55KSByZXR1cm4gTmV4dFJlc3BvbnNlLmpzb24oeyBlcnJvcjogJ0NvbXBhbnkgbm90IGZvdW5kJyB9LCB7IHN0YXR1czogNDA0IH0pCgogIGNvbnN0IGFwcFVybCA9IHByb2Nlc3MuZW52Lk5FWFRfUFVCTElDX0FQUF9VUkwgfHwgJ2h0dHBzOi8vYXBwLmdldHZhbnRyby5jb20nCgogIC8vIElmIG5vIFN0cmlwZSBjdXN0b21lciB5ZXQgKHN0aWxsIG9uIHRyaWFsLCBuZXZlciBwYWlkKSwgY3JlYXRlIG9uZQogIGxldCBjdXN0b21lcklkID0gY29tcGFueS5zdHJpcGVfY3VzdG9tZXJfaWQKICBpZiAoIWN1c3RvbWVySWQpIHsKICAgIGNvbnN0IGN1c3RvbWVyID0gYXdhaXQgc3RyaXBlLmN1c3RvbWVycy5jcmVhdGUoewogICAgICBlbWFpbDogdXNlci5lbWFpbCwKICAgICAgbmFtZTogY29tcGFueS5uYW1lLAogICAgICBtZXRhZGF0YTogeyBjb21wYW55X2lkOiBjb21wYW55LmlkIH0sCiAgICB9KQogICAgY3VzdG9tZXJJZCA9IGN1c3RvbWVyLmlkCiAgICBhd2FpdCBzZXJ2aWNlCiAgICAgIC5mcm9tKCdjb21wYW5pZXMnKQogICAgICAudXBkYXRlKHsgc3RyaXBlX2N1c3RvbWVyX2lkOiBjdXN0b21lcklkIH0pCiAgICAgIC5lcSgnaWQnLCBjb21wYW55LmlkKQogIH0KCiAgdHJ5IHsKICAgIGNvbnN0IHBvcnRhbFNlc3Npb24gPSBhd2FpdCBzdHJpcGUuYmlsbGluZ1BvcnRhbC5zZXNzaW9ucy5jcmVhdGUoewogICAgICBjdXN0b21lcjogY3VzdG9tZXJJZCwKICAgICAgcmV0dXJuX3VybDogYCR7YXBwVXJsfS9hZG1pbj90YWI9dGVhbWAsCiAgICB9KQogICAgcmV0dXJuIE5leHRSZXNwb25zZS5qc29uKHsgdXJsOiBwb3J0YWxTZXNzaW9uLnVybCB9KQogIH0gY2F0Y2ggKGVycjogYW55KSB7CiAgICByZXR1cm4gTmV4dFJlc3BvbnNlLmpzb24oCiAgICAgIHsgZXJyb3I6ICdDb3VsZCBub3Qgb3BlbiBiaWxsaW5nIHBvcnRhbCcsIGRldGFpbDogZXJyPy5tZXNzYWdlIHx8IFN0cmluZyhlcnIpIH0sCiAgICAgIHsgc3RhdHVzOiA1MDAgfQogICAgKQogIH0KfQo="


def write_portal_endpoint():
    full = os.path.join(os.getcwd(), PORTAL_API)
    if os.path.exists(full):
        print(f"  exists, skipping: {PORTAL_API}")
        return
    os.makedirs(os.path.dirname(full), exist_ok=True)
    contents = base64.b64decode(PORTAL_B64).decode("utf-8")
    with open(full, "w", encoding="utf-8", newline="\n") as f:
        f.write(contents)
    print(f"  wrote: {PORTAL_API}")


def update_prices():
    if not os.path.exists(BILLING_LIB):
        print(f"  ERROR: {BILLING_LIB} not found")
        sys.exit(1)
    with open(BILLING_LIB, "r", encoding="utf-8") as f:
        src = f.read()

    if "// price_polish_v1" in src:
        print(f"  prices already updated")
        return

    # Three replacements
    replacements = [
        ("    price: 199,\n    installerLimit: 40,", "    price: 299, // price_polish_v1\n    installerLimit: 40,"),
        ("    price: 299,\n    installerLimit: 70,", "    price: 399,\n    installerLimit: 70,"),
        ("    price: 449,\n    installerLimit: 100,", "    price: 499,\n    installerLimit: 100,"),
    ]
    
    found_count = 0
    for old, new in replacements:
        if old in src:
            src = src.replace(old, new)
            found_count += 1

    if found_count == 0:
        print(f"  ERROR: no price anchors matched - prices may be different format")
        sys.exit(1)
    if found_count < 3:
        print(f"  WARN: only {found_count}/3 prices updated. Check {BILLING_LIB} manually.")
    
    with open(BILLING_LIB, "w", encoding="utf-8", newline="\n") as f:
        f.write(src)
    print(f"  updated {found_count}/3 prices in {BILLING_LIB}")


def patch_dashboard():
    if not os.path.exists(DASHBOARD):
        print(f"  ERROR: {DASHBOARD} not found")
        sys.exit(1)
    with open(DASHBOARD, "r", encoding="utf-8") as f:
        src = f.read()

    if "// billing_polish_v1" in src:
        print(f"  AdminDashboard already patched")
        return

    # 1. Add handleOpenBillingPortal function near the existing addMember function
    old_addmember_anchor = "  async function addMember() {"
    new_function_block = """  // billing_polish_v1
  async function handleOpenBillingPortal() {
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" })
      const data = await res.json()
      if (data?.url) {
        window.open(data.url, "_blank", "noopener,noreferrer")
        return
      }
      alert(data?.error || "Could not open billing portal. Please try again or contact support.")
    } catch (err) {
      alert("Could not open billing portal. Please try again or contact support.")
    }
  }

  async function addMember() {"""

    if old_addmember_anchor not in src:
        print(f"  ERROR: addMember anchor not found")
        sys.exit(1)
    src = src.replace(old_addmember_anchor, new_function_block)

    # 2. Patch the amber over-limit banner to add an Upgrade button
    old_banner = """              if (limit && active > limit) {
                const over = active - limit
                return (
                  <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-800">
                    <strong>You're {over} over your plan limit of {limit} installers.</strong> Existing users will keep working. To add more, upgrade your plan or remove a user.
                  </div>
                )
              }"""
    
    new_banner = """              if (limit && active > limit) {
                const over = active - limit
                return (
                  <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-800 flex items-start justify-between gap-4">
                    <div>
                      <strong>You're {over} over your plan limit of {limit} installers.</strong> Existing users will keep working. To add more, upgrade your plan or remove a user.
                    </div>
                    <button
                      onClick={handleOpenBillingPortal}
                      className="flex-shrink-0 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors whitespace-nowrap"
                    >
                      Upgrade plan â†'
                    </button>
                  </div>
                )
              }"""
    
    if old_banner not in src:
        print(f"  WARN: banner anchor not found, button not added")
    else:
        src = src.replace(old_banner, new_banner)
        print(f"  added Upgrade plan button to banner")

    with open(DASHBOARD, "w", encoding="utf-8", newline="\n") as f:
        f.write(src)
    print(f"  PATCHED: {DASHBOARD}")


def patch_webhook_audit():
    if not os.path.exists(WEBHOOK):
        print(f"  ERROR: {WEBHOOK} not found")
        sys.exit(1)
    with open(WEBHOOK, "r", encoding="utf-8") as f:
        src = f.read()

    if "// audit_log_v1" in src:
        print(f"  webhook already has audit logging")
        return

    # Insert audit logging right after constructEvent
    old = """  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch (err) {
    return NextResponse.json({ error: 'Webhook error' }, { status: 400 })
  }

  const service = await createServiceClient()"""

    new = """  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch (err) {
    return NextResponse.json({ error: 'Webhook error' }, { status: 400 })
  }

  const service = await createServiceClient()

  // audit_log_v1: idempotency + audit log via billing_events table.
  // Unique constraint on stripe_event_id prevents double-processing on Stripe retries.
  // If this insert fails because event was already logged, return 200 immediately.
  try {
    const obj: any = event.data.object
    const companyId =
      obj?.metadata?.company_id ||
      (obj?.customer ? (await service.from('companies').select('id').eq('stripe_customer_id', obj.customer).maybeSingle()).data?.id : null) ||
      null
    const { error: auditError } = await service.from('billing_events').insert({
      stripe_event_id: event.id,
      event_type: event.type,
      company_id: companyId,
      data: event.data.object as any,
    })
    if (auditError && auditError.code === '23505') {
      // Duplicate key violation = event already processed. Stripe is retrying. Return 200.
      return NextResponse.json({ received: true, duplicate: true })
    }
  } catch (err) {
    // If billing_events table doesn't exist yet, log and continue (don't break webhook).
    console.error('billing_events audit log error:', err)
  }"""

    if old not in src:
        print(f"  ERROR: webhook audit anchor not found")
        sys.exit(1)
    src = src.replace(old, new)

    with open(WEBHOOK, "w", encoding="utf-8", newline="\n") as f:
        f.write(src)
    print(f"  PATCHED: {WEBHOOK} (idempotency + audit logging)")


def main():
    cwd = os.getcwd()
    if not cwd.lower().endswith("vantro"):
        print(f"WARNING: cwd is {cwd}")
        print("Run from C:\\vantro. Continue? (y/n)")
        if input().strip().lower() != "y":
            sys.exit(1)

    write_portal_endpoint()
    update_prices()
    patch_dashboard()
    patch_webhook_audit()
    print()
    print("Done. Four changes:")
    print("  1. Customer Portal endpoint at /api/billing/portal")
    print("  2. lib/billing.ts prices 299/399/499 (was 199/299/449)")
    print("  3. AdminDashboard banner has Upgrade plan button")
    print("  4. Webhook is now idempotent + audit logs to billing_events")
    print()
    print("Before pushing:")
    print("  - Run the billing_events SQL migration in Supabase if not done")
    print("  - Verify Stripe Customer Portal is enabled and has 3 products")
    print("  - Verify env vars STRIPE_SECRET_KEY (sk_test_) + STRIPE_PRICE_* are correct")


if __name__ == "__main__":
    main()
