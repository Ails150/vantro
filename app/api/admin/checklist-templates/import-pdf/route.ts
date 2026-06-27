import { NextResponse } from "next/server"
import { GoogleGenerativeAI } from "@google/generative-ai"
import { createClient, createServiceClient } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const maxDuration = 60
export const dynamic = "force-dynamic"

const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY
const VALID_TYPES = ["tick", "photo", "pass_fail", "measurement"]

const PROMPT = `You are converting a UK construction QA / inspection checklist PDF (e.g. Fieldwire format) into a structured digital checklist.

Return ONLY a JSON object — no prose, no markdown fences:
{
  "template_name": "string - a concise title for this checklist",
  "items": [
    {
      "label": "string - the check/task text",
      "section": "string or null - the bold section heading this item sits under",
      "item_type": "tick | photo | pass_fail | measurement",
      "is_mandatory": boolean,
      "requires_photo": boolean,
      "hold_point": boolean
    }
  ]
}

Rules:
- Each bold heading is a section; each check / line / task under it becomes one item. Preserve document order.
- If a line is a HOLD POINT / WITNESS POINT / "H/P" / "HP" / "HOLD" — set hold_point=true AND is_mandatory=true (these require supervisor sign-off).
- If a section or item asks for a photo / photograph / photographic evidence — set requires_photo=true.
- item_type: "pass_fail" for pass/fail or satisfactory/unsatisfactory inspections; "measurement" for numeric readings / dimensions / torque / pressure; "photo" for photo-only evidence; otherwise "tick".
- Keep labels concise (under 160 chars). Do NOT invent items that are not in the document.

Return ONLY the JSON.`

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const service = await createServiceClient()
  const { data: u } = await service.from("users").select("company_id, role").eq("auth_user_id", user.id).single()
  if (!u || !["admin", "foreman", "superadmin"].includes(u.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  if (!GEMINI_KEY) return NextResponse.json({ error: "PDF import is not configured (missing AI key)." }, { status: 500 })

  let buffer: Buffer, fileName: string
  try {
    const form = await request.formData()
    const file = form.get("file") as File | null
    if (!file) return NextResponse.json({ error: "No PDF uploaded" }, { status: 400 })
    const mimeType = file.type || "application/pdf"
    if (!mimeType.includes("pdf")) return NextResponse.json({ error: "Please upload a PDF file." }, { status: 400 })
    fileName = (file.name || "Imported checklist").replace(/\.pdf$/i, "").trim()
    buffer = Buffer.from(await file.arrayBuffer())
    if (buffer.length > 15 * 1024 * 1024) return NextResponse.json({ error: "PDF too large (max 15MB)." }, { status: 400 })
  } catch {
    return NextResponse.json({ error: "Bad upload." }, { status: 400 })
  }

  let parsed: any
  try {
    const ai = new GoogleGenerativeAI(GEMINI_KEY)
    const model = ai.getGenerativeModel({ model: "gemini-2.5-flash" })
    const result = await model.generateContent([
      PROMPT,
      { inlineData: { data: buffer.toString("base64"), mimeType: "application/pdf" } },
    ])
    const text = result.response.text().trim()
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim()
    parsed = JSON.parse(cleaned)
  } catch (e: any) {
    console.error("[import-pdf] Gemini/parse failed:", e?.message || e)
    return NextResponse.json({ error: "Could not read a checklist from that PDF. Try a clearer PDF, or build it manually." }, { status: 422 })
  }

  const rawItems = Array.isArray(parsed?.items) ? parsed.items : []
  if (rawItems.length === 0) return NextResponse.json({ error: "No checklist items found in the PDF." }, { status: 422 })

  const templateName = (typeof parsed?.template_name === "string" && parsed.template_name.trim()) || fileName || "Imported checklist"

  const { data: template, error: tErr } = await service
    .from("checklist_templates")
    .insert({ name: templateName.slice(0, 120), company_id: u.company_id, frequency: "job" })
    .select()
    .single()
  if (tErr || !template) {
    console.error("[import-pdf] template insert failed:", tErr)
    return NextResponse.json({ error: "Could not create the checklist template." }, { status: 400 })
  }

  const buildRows = (withHoldPoint: boolean) =>
    rawItems.slice(0, 300).map((it: any, i: number) => {
      const holdPoint = it?.hold_point === true
      const row: any = {
        template_id: template.id,
        company_id: u.company_id,
        label: String(it?.label ?? "").trim().slice(0, 200) || `Item ${i + 1}`,
        item_type: VALID_TYPES.includes(it?.item_type) ? it.item_type : "tick",
        is_mandatory: it?.is_mandatory === true || holdPoint,
        requires_photo: it?.requires_photo === true,
        requires_video: false,
        fail_note_required: false,
        sort_order: i,
        trade: null,
      }
      if (withHoldPoint) row.hold_point = holdPoint
      return row
    })

  // Insert items; if the hold_point column hasn't been migrated yet, retry without it.
  let insErr: any
  ;({ error: insErr } = await service.from("checklist_items").insert(buildRows(true)))
  if (insErr && /hold_point/.test(`${insErr.message || ""} ${insErr.details || ""} ${insErr.hint || ""}`)) {
    console.warn("[import-pdf] checklist_items.hold_point missing — inserting without hold-point flags. Run the migration.")
    ;({ error: insErr } = await service.from("checklist_items").insert(buildRows(false)))
  }
  if (insErr) {
    console.error("[import-pdf] items insert failed:", insErr)
    await service.from("checklist_templates").delete().eq("id", template.id) // don't leave an empty template
    return NextResponse.json({ error: "Could not save the checklist items.", detail: insErr.message }, { status: 400 })
  }

  return NextResponse.json({
    success: true,
    template: { id: template.id, name: template.name },
    itemCount: Math.min(rawItems.length, 300),
    holdPoints: rawItems.filter((i: any) => i?.hold_point === true).length,
    photoItems: rawItems.filter((i: any) => i?.requires_photo === true).length,
  })
}
