import { NextResponse } from "next/server"
import { verifyInstallerToken } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const installer = verifyInstallerToken(request)
  if (!installer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const level = body.level
  if (!["always", "whenInUse", "denied"].includes(level)) {
    return NextResponse.json({ error: "Invalid level" }, { status: 400 })
  }

  const service = await createServiceClient()
  const { error } = await service
    .from("users")
    .update({ gps_permission_level: level })
    .eq("id", installer.userId)

  if (error) {
    console.error("[gps-permission] update failed:", error)
    return NextResponse.json({ error: "Update failed", detail: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, level })
}
