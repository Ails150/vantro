// app/api/admin/captured/route.ts
//
// GET  the "captured this month" figure for the TODAY board.
//
// Suite only, and owners only: it is money. A 402 or 403 here is normal and
// the board simply does not draw the line.

import { NextResponse } from "next/server"
import { suiteCaller } from "@/lib/suite-caller"
import { capturedSentence, loadCaptured } from "@/lib/captured"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const c = await suiteCaller("variations")
  if ("error" in c) return c.error
  try {
    const captured = await loadCaptured(c.service, c.companyId)
    return NextResponse.json({ ...captured, sentence: capturedSentence(captured) })
  } catch (e: any) {
    console.error("[captured]", c.companyId, e?.message)
    return NextResponse.json({ error: "Could not add up this month" }, { status: 500 })
  }
}
