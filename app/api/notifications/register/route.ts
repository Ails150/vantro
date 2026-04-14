import { verifyInstallerToken } from '@/lib/auth'
import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"

export async function POST(request: Request) {
  const installer = verifyInstallerToken(request)
  if (!installer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { token } = await request.json()
  if (!token) return NextResponse.json({ error: "No token" }, { status: 400 })

  const service = await createServiceClient()
  await service.from("users").update({ push_token: token }).eq("id", installer.userId)

  return NextResponse.json({ success: true })
}
