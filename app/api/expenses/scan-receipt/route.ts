import { NextResponse } from "next/server"
import { GoogleGenerativeAI } from "@google/generative-ai"
import { verifyInstallerToken } from "@/lib/auth"
import { checkRateLimit } from "@/lib/rate-limit"

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
vendor: shop/supplier name exactly as printed on the receipt, e.g. "Screwfix"
date: YYYY-MM-DD if visible
suggested_category: one of fuel, materials, food, parking, tools, other
currency: "GBP", "EUR", or "USD"
confidence: "high" (clear amount + clear vendor), "medium" (one missing), "low" (mostly guessing or not a receipt)

Read the vendor FIRST, then choose suggested_category from the vendor name.
What a merchant sells decides the category. Line items only break a tie when
the vendor name alone is ambiguous. The same merchant must always get the
same category, so do not let the basket sway you: a sandwich bought at a tool
shop is still that shop's category.

Category guidance:
- fuel: petrol stations (Shell, BP, Esso, Texaco, Asda Fuel, Tesco Fuel)
- materials: builders merchants (Selco, Travis Perkins, Jewson, Wickes, Plumb Center)
- food: cafes, supermarkets at lunch, Greggs, Subway, McDonalds
- parking: NCP, RingGo, council parking
- tools: tool and trade counters (Screwfix, Toolstation, Machine Mart, B&Q,
  and any merchant whose name says tools, tool hire, plant or technical trade supply)
- other: anything else

Return ONLY the JSON.`

// A merchant's category must not drift between one receipt and the next.
// CITY TECH STORE was landing as food on one row and tools on another. Where
// the vendor name is a clear signal, it decides the category outright.
const MERCHANT_CATEGORY: Array<{ match: RegExp; category: string }> = [
  { match: /\b(shell|bp|esso|texaco|gulf|jet|morrisons fuel|asda fuel|tesco fuel|sainsbury'?s fuel|petrol|filling station)\b/i, category: "fuel" },
  { match: /\b(ncp|ringgo|parkingeye|justpark|car park|parking)\b/i, category: "parking" },
  { match: /\b(screwfix|toolstation|machine mart|b&q|b and q|tool ?station|tool hire|hss hire|speedy hire|tech store|technical|plant hire)\b/i, category: "tools" },
  { match: /\b(selco|travis perkins|jewson|wickes|plumb ?cent(er|re)|buildbase|howdens|builders? merchant|timber)\b/i, category: "materials" },
  { match: /\b(greggs|subway|mcdonald'?s|costa|pret|starbucks|caf[eé]|coffee|bakery|sandwich)\b/i, category: "food" },
]

// Trailing company suffixes and punctuation are noise, and casing varies
// between receipts from the same shop.
function normaliseVendor(vendor: string): string {
  return vendor
    .toLowerCase()
    .replace(/\b(ltd|limited|plc|llp|uk|gb|store|stores)\b/g, " ")
    .replace(/[^a-z0-9& ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

// Returns the category the merchant name implies, or null when it says nothing.
export function categoryFromVendor(vendor: string | null): string | null {
  if (!vendor) return null
  const name = normaliseVendor(vendor)
  if (!name) return null
  for (const { match, category } of MERCHANT_CATEGORY) {
    if (match.test(name)) return category
  }
  return null
}

function emptyScan(reason: string) {
  console.warn("[scan-receipt] empty scan:", reason)
  return {
    amount: null,
    vat_amount: null,
    vendor: null,
    date: null,
    suggested_category: "other",
    category_source: "none",
    currency: "GBP",
    confidence: "low",
  }
}

export async function POST(request: Request) {
  // audit-guard-2026-05-19 - security hardening pass
  {
    const _ip = (request.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim()
    const _ok = await checkRateLimit(`scan-receipt:ip:${_ip}`, 30, 3600)
    if (!_ok) {
      return NextResponse.json({ error: "Too many requests. Slow down." }, { status: 429 })
    }
  }

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

    const vendor = typeof parsed.vendor === "string" ? parsed.vendor.slice(0, 100) : null
    const modelCategory = VALID_CATEGORIES.includes(parsed.suggested_category) ? parsed.suggested_category : "other"

    // The merchant name is the strongest signal available, and unlike the
    // model it gives the same answer every time for the same shop.
    const vendorCategory = categoryFromVendor(vendor)
    if (vendorCategory && vendorCategory !== modelCategory) {
      console.log("[scan-receipt] vendor override:", vendor, modelCategory, "->", vendorCategory)
    }

    const scan = {
      amount: typeof parsed.amount === "number" ? parsed.amount : null,
      vat_amount: typeof parsed.vat_amount === "number" ? parsed.vat_amount : null,
      vendor,
      date: typeof parsed.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ? parsed.date : null,
      suggested_category: vendorCategory || modelCategory,
      category_source: vendorCategory ? "merchant" : "model",
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
