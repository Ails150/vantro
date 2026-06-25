import { NextResponse } from "next/server"
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3"
import { createClient, createServiceClient } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const maxDuration = 60
export const dynamic = "force-dynamic"

const CAN_RAISE = ["admin", "superadmin", "support"]
const SUPPORT_EMAIL = "aileen@applyscale8.com"

const R2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.eu.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY!,
  },
})

async function getCaller() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const service = await createServiceClient()
  const { data: u } = await service
    .from("users")
    .select("id, company_id, role, name, email")
    .eq("auth_user_id", user.id)
    .single()
  return u ? { u, service } : null
}

export async function GET() {
  const caller = await getCaller()
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { u, service } = caller
  if (!CAN_RAISE.includes(u.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { data: tickets } = await service
    .from("support_tickets")
    .select("id, title, description, screenshot_url, status, created_at, updated_at")
    .eq("user_id", u.id)
    .order("created_at", { ascending: false })

  return NextResponse.json({ tickets: tickets || [] })
}

export async function POST(request: Request) {
  const caller = await getCaller()
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { u, service } = caller
  if (!CAN_RAISE.includes(u.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const form = await request.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: "Invalid body" }, { status: 400 })

  const title = String(form.get("title") || "").trim()
  const description = String(form.get("description") || "").trim()
  if (!title) return NextResponse.json({ error: "Title required" }, { status: 400 })
  if (!description) return NextResponse.json({ error: "Description required" }, { status: 400 })

  // Optional screenshot -> Cloudflare R2
  let screenshotUrl: string | null = null
  const file = form.get("screenshot") as File | null
  if (file && typeof file === "object" && file.size > 0) {
    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ error: "Screenshot must be an image" }, { status: 400 })
    }
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "Screenshot must be under 10MB" }, { status: 400 })
    }
    try {
      const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "")
      const path = `support/${u.company_id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
      const buffer = Buffer.from(await file.arrayBuffer())
      await R2.send(new PutObjectCommand({
        Bucket: process.env.CLOUDFLARE_R2_BUCKET!,
        Key: path,
        Body: buffer,
        ContentType: file.type || "image/png",
      }))
      screenshotUrl = `${process.env.CLOUDFLARE_R2_PUBLIC_URL}/${path}`
    } catch (e: any) {
      console.error("[support/tickets] screenshot upload failed:", e?.message)
      // Non-fatal: still create the ticket without a screenshot.
    }
  }

  const { data: company } = await service
    .from("companies").select("name").eq("id", u.company_id).single()
  const companyName = company?.name || "Unknown company"

  const { data: ticket, error } = await service.from("support_tickets").insert({
    company_id: u.company_id,
    user_id: u.id,
    raised_by_name: u.name,
    raised_by_email: u.email,
    title,
    description,
    screenshot_url: screenshotUrl,
    status: "open",
  }).select().single()

  if (error) {
    console.error("[support/tickets] insert failed:", error)
    return NextResponse.json({ error: "Could not create ticket" }, { status: 400 })
  }

  // Notify Aileen via Resend (non-fatal if it fails — ticket is already stored).
  if (process.env.RESEND_API_KEY) {
    try {
      const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + process.env.RESEND_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "Vantro Support <support@getvantro.com>",
          to: SUPPORT_EMAIL,
          reply_to: u.email || undefined,
          subject: `[Support] ${title} — ${companyName}`,
          html: `
            <h2>New support ticket</h2>
            <p><strong>Company:</strong> ${esc(companyName)}</p>
            <p><strong>Raised by:</strong> ${esc(u.name || "")} (${esc(u.email || "")})</p>
            <p><strong>Title:</strong> ${esc(title)}</p>
            <p><strong>Description:</strong></p>
            <p style="white-space:pre-wrap">${esc(description)}</p>
            ${screenshotUrl ? `<p><strong>Screenshot:</strong> <a href="${screenshotUrl}">${screenshotUrl}</a></p>` : ""}
            <hr/>
            <p style="color:#888;font-size:12px">Ticket ID: ${ticket.id}</p>
          `,
        }),
      })
    } catch (e: any) {
      console.error("[support/tickets] email failed:", e?.message)
    }
  }

  return NextResponse.json({ success: true, ticket })
}
