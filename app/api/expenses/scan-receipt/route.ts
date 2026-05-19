import { NextResponse } from "next/server"
import { GoogleGenerativeAI } from "@google/generative-ai"
import { verifyInstallerToken } from "@/lib/auth"

const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY
const VALID_CATEGORIES = ["fuel", "materials", "food", "parking", "tools", "other"]

const EXTRACTION_PROMPT = `You are extracting structured data from a UK construction trade expense receipt.

Return ONLY a JSON object with these exact fields. No prose, no markdown fences.

{
  "amount": number or null,
  "vat_amount": number or null,
  "vendor": string or null,
  "date": string or null,
  "suggested_category": string,
  "currency": string,
  "confidence": string
}

amount: TOTAL inc VAT, in pounds (e.g. 77.97). Use dot decimal, not comma.
vat_amount: VAT line if shown separately, else null
vendor: shop/supplier name, e.g. "Screwfix"
date: YYYY-MM-DD if visible
suggested_category: one of fuel, materials, food, parking, tools, other
currency: "GBP", "EUR", or "USD"
confidence: "high" (clear amount + clear vendor), "medium" (one missing), "low" (mostly guessing or not a receipt)

Category guidance:
- fuel: petrol stations (Shell, BP, Esso, Texaco, Asda Fuel, Tesco Fuel)
- materials: builders merchants (Selco, Travis Perkins, Jewson, Wickes, Plumb Center)
- food: cafes, supermarkets at lunch, Greggs, Subway, McDonalds
- parking: NCP, RingGo, council parking
- tools: Screwfix, Toolstation, Machine Mart, B&Q for tools
- other: anything else

Return ONLY the JSON.`

function emptyScan(reason: string) {
  console.warn("[scan-receipt] empty scan:", reason)
  return {
    amount: null,
    vat_amount: null,
    vendor: null,
    date: null,
    suggested_category: "other",
    currency: "GBP",
    confidence: "low",
  }
}

export async function POST(request: Request) {
  let installer
  try {
    installer = await verifyInstallerToken(request)
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (!installer) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (!GEMINI_KEY) {
    return NextResponse.json({
      success: true,
      scan: emptyScan("GEMINI_API_KEY missing"),
    })
  }

  let imageBuffer: Buffer
  let mimeType: string
  try {
    const form = await request.formData()
    const file = form.get("receipt") as File | null
    if (!file) {
      return NextResponse.json({ error: "No receipt uploaded" }, { status: 400 })
    }
    const arrayBuffer = await file.arrayBuffer()
    imageBuffer = Buffer.from(arrayBuffer)
    mimeType = file.type || "image/jpeg"
    if (imageBuffer.length > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "Image too large (max 10MB)" }, { status: 400 })
    }
  } catch (e: any) {
    console.error("[scan-receipt] form parse failed", e)
    return NextResponse.json({ error: "Bad form data" }, { status: 400 })
  }

  try {
    const ai = new GoogleGenerativeAI(GEMINI_KEY)
    const model = ai.getGenerativeModel({ model: "gemini-2.5-flash" })

    const result = await model.generateContent([
      EXTRACTION_PROMPT,
      { inlineData: { data: imageBuffer.toString("base64"), mimeType } },
    ])

    const text = result.response.text().trim()
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim()

    let parsed: any
    try {
      parsed = JSON.parse(cleaned)
    } catch {
      return NextResponse.json({
        success: true,
        scan: emptyScan("AI returned unparseable output: " + text.slice(0, 100)),
      })
    }

    const scan = {
      amount: typeof parsed.amount === "number" ? parsed.amount : null,
      vat_amount: typeof parsed.vat_amount === "number" ? parsed.vat_amount : null,
      vendor: typeof parsed.vendor === "string" ? parsed.vendor.slice(0, 100) : null,
      date: typeof parsed.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ? parsed.date : null,
      suggested_category: VALID_CATEGORIES.includes(parsed.suggested_category) ? parsed.suggested_category : "other",
      currency: typeof parsed.currency === "string" ? parsed.currency.toUpperCase().slice(0, 3) : "GBP",
      confidence: ["high", "medium", "low"].includes(parsed.confidence) ? parsed.confidence : "low",
    }

    return NextResponse.json({ success: true, scan })
  } catch (e: any) {
    console.error("[scan-receipt] Gemini call failed:", e?.message || e)
    return NextResponse.json({
      success: true,
      scan: emptyScan("Gemini call failed"),
    })
  }
}
