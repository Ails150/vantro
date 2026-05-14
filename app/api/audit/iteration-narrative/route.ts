// app/api/audit/iteration-narrative/route.ts
// Generates an AI-written narrative comparing two periods of a job's audit data.
// Used by the Iteration tab to explain *why* things changed between Period A and B.
//
// Input: { reportA, reportB, fromA, toA, fromB, toB }
//   where reportA/reportB are the full responses from /api/audit/v2
//
// Output: { narrative: string }

import { NextResponse } from "next/server"
import { GoogleGenerativeAI } from "@google/generative-ai"

export const maxDuration = 60

function summarisePeriod(report: any) {
  const diary = report?.fullEvidence?.diary || []
  const defects = report?.issues?.allDefects || []
  const openDefects = report?.issues?.openDefects || []
  const blockers = report?.issues?.blockers || []
  const signoffs = report?.signoffs || []
  const signins = report?.onSite?.fullLog || []
  const deliverables = report?.deliverables || []

  return {
    hoursOnSite: report?.health?.metrics?.hoursThisPeriod ?? 0,
    installerCount: report?.onSite?.installerCount ?? 0,
    signinEvents: signins.length,
    totalDefects: defects.length,
    openDefects: openDefects.length,
    blockers: blockers.length,
    signoffs: signoffs.length,
    diaryEntries: diary.length,
    deliverableProgress: deliverables.map((d: any) => ({
      name: d.name,
      approved: d.approvedItems ?? 0,
      total: d.totalItems ?? 0,
    })),
    // Sample the actual diary text - max 20 entries, 200 chars each
    diarySamples: diary.slice(0, 20).map((d: any) => ({
      created: d.created_at,
      text: (d.notes || d.summary || "").substring(0, 200),
    })).filter((d: any) => d.text),
    defectFlags: defects.map((d: any) => d.responsibility || d.category || "unspecified"),
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { reportA, reportB, fromA, toA, fromB, toB } = body

    if (!reportA || !reportB) {
      return NextResponse.json({ error: "Both reportA and reportB required" }, { status: 400 })
    }

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json({ error: "AI not configured" }, { status: 500 })
    }

    const summaryA = summarisePeriod(reportA)
    const summaryB = summarisePeriod(reportB)

    const prompt = `You are a senior project manager writing a brief, factual iteration report comparing two periods of work on a construction/installation project.

PERIOD A: ${fromA} to ${toA}
${JSON.stringify(summaryA, null, 2)}

PERIOD B: ${fromB} to ${toB}
${JSON.stringify(summaryB, null, 2)}

Write a single paragraph (4-7 sentences max) comparing the two periods. Focus on:
1. WHAT changed (deliverable progress, hours, defects, sign-offs)
2. WHY it likely changed - look at diary text, defect responsibility, blocker count
   - If defects are flagged as client_responsibility or scope_change, attribute slowdown to client side
   - If diary mentions waiting, parts, approvals - call that out
   - If hours dropped but deliverables held, the team got more efficient
   - If hours held but deliverables dropped, something external blocked them
3. The headline takeaway - is this period healthy, concerning, or recovering?

Be specific with numbers but interpret them. Don't just list metrics.
Don't use headers, bullets or markdown. Plain prose only.
Write in UK English, professional but readable - imagine this is going to a paying client.`

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" })
    const result = await model.generateContent(prompt)
    const narrative = result.response.text().trim()

    return NextResponse.json({ narrative })
  } catch (err: any) {
    console.error("[iteration-narrative] failed:", err)
    return NextResponse.json({ error: err?.message || "Generation failed" }, { status: 500 })
  }
}
