import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"

function getInstallerFromToken(request: Request) {
  const auth = request.headers.get("authorization")
  if (!auth?.startsWith("Bearer ")) return null
  try {
    const payload = JSON.parse(Buffer.from(auth.slice(7), "base64").toString())
    if (payload.exp < Date.now()) return null
    return payload
  } catch { return null }
}

export async function POST(request: Request) {
  const installer = getInstallerFromToken(request)
  if (!installer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { token } = await request.json()
  if (!token) return NextResponse.json({ error: "No token" }, { status: 400 })

  const service = await createServiceClient()
  await service.from("users").update({ push_token: token }).eq("id", installer.userId)

  return NextResponse.json({ success: true })
}