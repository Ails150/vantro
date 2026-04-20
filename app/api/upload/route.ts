import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { verifyInstallerToken } from "@/lib/auth"

export async function POST(request: Request) {
  const auth = request.headers.get("authorization")
  if (!auth?.startsWith("Bearer ")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const installer = verifyInstallerToken(request)
  if (!installer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const formData = await request.formData()
    const file = formData.get("file") as File
    const bucket = formData.get("bucket") as string || "diary-media"
    const path = formData.get("path") as string

    if (!file || !path) return NextResponse.json({ error: "Missing file or path" }, { status: 400 })

    const service = await createServiceClient()
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    const { error } = await service.storage.from(bucket).upload(path, buffer, {
      contentType: file.type || "image/jpeg",
      upsert: true
    })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const { data: { publicUrl } } = service.storage.from(bucket).getPublicUrl(path)

    return NextResponse.json({ url: publicUrl })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}