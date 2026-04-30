import { redirect } from "next/navigation"
import { createServiceClient } from "@/lib/supabase/server"

/**
 * Public audit share page.
 * Validates the token, bumps the view counter, then redirects to the
 * shared report endpoint which renders the full HTML.
 */
export default async function AuditSharePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const service = await createServiceClient()

  const { data: share, error } = await service
    .from("audit_shares")
    .select("id, job_id, company_id, date_from, date_to, expires_at, revoked")
    .eq("token", token)
    .maybeSingle()

  if (error || !share) {
    return (
      <SharePageError
        title="Link not found"
        message="This audit link is invalid. Please check the URL or ask the sender for a new one."
      />
    )
  }

  if (share.revoked) {
    return (
      <SharePageError
        title="Link revoked"
        message="This audit link has been revoked by the sender and is no longer available."
      />
    )
  }

  if (share.expires_at && new Date(share.expires_at) < new Date()) {
    return (
      <SharePageError
        title="Link expired"
        message="This audit link has expired. Please ask the sender for an updated link."
      />
    )
  }

  // Bump view tracking — best effort, don\'t block render
  await service
    .from("audit_shares")
    .update({
      view_count: ((share as any).view_count ?? 0) + 1,
      last_viewed_at: new Date().toISOString(),
    })
    .eq("id", share.id)

  // Redirect to the shared report endpoint
  const params2 = new URLSearchParams({
    jobId: share.job_id,
    shareToken: token,
  })
  if (share.date_from) {
    params2.set("from", String(share.date_from).slice(0, 10))
  }
  if (share.date_to) {
    params2.set("to", String(share.date_to).slice(0, 10))
  }
  redirect(`/api/audit/report?${params2.toString()}`)
}

function SharePageError({ title, message }: { title: string; message: string }) {
  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "#f8fafc", fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
      padding: "24px",
    }}>
      <div style={{
        background: "white", border: "1px solid #e2e8f0", borderRadius: 12,
        padding: "40px 48px", maxWidth: 480, textAlign: "center",
        boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
      }}>
        <div style={{
          width: 48, height: 48, background: "#00a87a", borderRadius: 10,
          margin: "0 auto 24px", display: "flex", alignItems: "center", justifyContent: "center",
          color: "white", fontWeight: 700, fontSize: 20,
        }}>V</div>
        <h1 style={{ margin: "0 0 8px", fontSize: 22, color: "#0f172a" }}>{title}</h1>
        <p style={{ margin: 0, color: "#64748b", lineHeight: 1.5 }}>{message}</p>
        <div style={{ marginTop: 32, fontSize: 11, color: "#94a3b8",
          textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Vantro &middot; getvantro.com
        </div>
      </div>
    </div>
  )
}
