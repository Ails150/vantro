import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'

function getInstallerFromToken(request: Request) {
  const auth = request.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) return null
  try {
    const payload = JSON.parse(Buffer.from(auth.slice(7), 'base64').toString())
    if (payload.exp < Date.now()) return null
    return payload
  } catch { return null }
}

export async function POST(request: Request) {
  const installer = getInstallerFromToken(request)
  if (!installer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { jobId, text } = await request.json()
  if (!text?.trim()) return NextResponse.json({ error: 'No text' }, { status: 400 })

  const service = await createServiceClient()

  // Get job info
  const { data: job } = await service.from('jobs').select('name, company_id').eq('id', jobId).single()
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  // Save diary entry
  const { data: entry, error } = await service.from('diary_entries').insert({
    job_id: jobId,
    user_id: installer.userId,
    company_id: job.company_id,
    entry_text: text,
  }).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // Run AI analysis in background
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: `You are analysing a construction site diary entry. Identify if there is a blocker (work completely stopped), issue (problem that needs attention), or nothing significant.

Diary entry: "${text}"

Respond with JSON only:
{"type": "blocker"|"issue"|"none", "message": "brief description for foreman or null"}`
      }]
    })

    const aiText = response.content[0].type === 'text' ? response.content[0].text : ''
    const aiResult = JSON.parse(aiText.replace(/```json|```/g, '').trim())

    if (aiResult.type !== 'none' && aiResult.message) {
      // Save alert
      await service.from('alerts').insert({
        company_id: job.company_id,
        job_id: jobId,
        diary_entry_id: entry.id,
        triggered_by: installer.userId,
        alert_type: aiResult.type,
        message: aiResult.message,
      })

      // Mark diary entry as processed
      await service.from('diary_entries').update({ ai_processed: true }).eq('id', entry.id)
    }
  } catch (e) {
    // AI failed silently â€” diary entry still saved
    console.error('AI processing failed:', e)
  }

  return NextResponse.json({ success: true })
}
