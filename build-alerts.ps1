# 1. Update diary route to send email alerts
$diary = @"
import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const service = await createServiceClient()
  const body = await request.json()
  const { jobId, entryText, companyId, userId } = body

  let aiAlertType = null
  let aiSummary = null

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const completion = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{ role: 'user', content: 'Analyse this site diary entry. Reply with JSON only: {"alert_type": "blocker"|"issue"|"none", "summary": "one sentence"}. Entry: ' + entryText }]
    })
    const parsed = JSON.parse(completion.content[0].type === 'text' ? completion.content[0].text : '{}')
    aiAlertType = parsed.alert_type || null
    aiSummary = parsed.summary || null
  } catch(e) {}

  const { data: entry } = await service.from('diary_entries').insert({
    job_id: jobId, company_id: companyId, user_id: userId,
    entry_text: entryText, ai_alert_type: aiAlertType, ai_summary: aiSummary
  }).select().single()

  if (aiAlertType && aiAlertType !== 'none') {
    const { data: job } = await service.from('jobs').select('name').eq('id', jobId).single()
    const { data: alertUser } = await service.from('users').select('name').eq('id', userId).single()

    await service.from('alerts').insert({
      company_id: companyId, job_id: jobId,
      message: (aiAlertType === 'blocker' ? 'BLOCKER' : 'ISSUE') + ' — ' + (aiSummary || entryText.slice(0, 100)),
      alert_type: aiAlertType, is_read: false
    })

    const { data: recipients } = await service.from('users').select('email, name').eq('company_id', companyId).in('role', ['admin', 'foreman'])

    if (recipients && recipients.length > 0 && process.env.RESEND_API_KEY) {
      const emailList = recipients.filter(r => r.email)
      for (const recipient of emailList) {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'Vantro Alerts <alerts@getvantro.com>',
            to: recipient.email,
            subject: (aiAlertType === 'blocker' ? 'BLOCKER' : 'ISSUE') + ' — ' + (job?.name || 'Job'),
            html: '<div style="font-family:sans-serif;max-width:600px;margin:0 auto"><div style="background:#00C896;padding:20px;border-radius:8px 8px 0 0"><h2 style="color:white;margin:0">Vantro Alert</h2></div><div style="padding:24px;background:#f9f9f9;border-radius:0 0 8px 8px"><p style="font-size:18px;font-weight:bold;color:' + (aiAlertType === 'blocker' ? '#dc2626' : '#d97706') + '">' + (aiAlertType === 'blocker' ? 'BLOCKER' : 'ISSUE') + '</p><p><strong>Job:</strong> ' + (job?.name || 'Unknown') + '</p><p><strong>Logged by:</strong> ' + (alertUser?.name || 'Unknown') + '</p><p><strong>Summary:</strong> ' + (aiSummary || entryText) + '</p><a href="https://app.getvantro.com/admin" style="display:inline-block;margin-top:16px;padding:12px 24px;background:#00C896;color:white;border-radius:8px;text-decoration:none;font-weight:bold">View Dashboard</a></div></div>'
          })
        })
      }
    }
  }

  return NextResponse.json({ success: true, entry })
}
"@
Set-Content "C:\vantro\app\api\diary\route.ts" $diary -Encoding UTF8
Write-Host "Diary route updated"
