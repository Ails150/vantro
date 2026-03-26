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

  const { data: job } = await service.from('jobs').select('name, company_id').eq('id', jobId).single()
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  const { data: entry, error } = await service.from('diary_entries').insert({
    job_id: jobId,
    user_id: installer.userId,
    company_id: job.company_id,
    entry_text: text,
  }).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: `You are analysing a construction site diary entry written by an installer on site.

Classify the entry into exactly one of these three categories:
- "blocker": Work has completely stopped or cannot proceed. Examples: equipment broken, access denied, dangerous conditions, missing materials that halt all work, injury, structural problem discovered.
- "issue": A problem exists that needs the foreman to be aware of but work can continue. Examples: minor delays, quality concern, something that needs follow-up, a question that needs answering.
- "update": Routine progress update, work going well, tasks completed, normal day. No action needed from foreman.

Diary entry: "${text}"

Respond with JSON only. For blocker and issue include a brief message for the foreman. For update, message should be null:
{"type": "blocker"|"issue"|"update", "message": "brief one sentence summary or null"}`
      }]
    })

    const aiText = response.content[0].type === 'text' ? response.content[0].text : ''
    const aiResult = JSON.parse(aiText.replace(/```json|```/g, '').trim())

    if (aiResult.type === 'blocker' && aiResult.message) {
      await service.from('alerts').insert({
        company_id: job.company_id,
        job_id: jobId,
        diary_entry_id: entry.id,
        triggered_by: installer.userId,
        alert_type: aiResult.type,
        message: aiResult.message,
      })
      await service.from('diary_entries').update({
        ai_processed: true,
        ai_alert_type: 'blocker',
        ai_summary: aiResult.message
      }).eq('id', entry.id)
    } else if (aiResult.type === 'issue') {
      await service.from('diary_entries').update({
        ai_alert_type: 'issue',
        ai_summary: aiResult.message
      }).eq('id', entry.id)
    } else {
      await service.from('diary_entries').update({
        ai_alert_type: 'update'
      }).eq('id', entry.id)
    }
  } catch (e) {
    console.error('AI processing failed:', e)
  }

  return NextResponse.json({ success: true })
}
