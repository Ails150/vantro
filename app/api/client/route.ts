import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"

const JWT_SECRET = process.env.JWT_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'fallback'

export async function POST(request: Request) {
  const { action, email, password, token } = await request.json()
  const service = await createServiceClient()

  // LOGIN
  if (action === 'login') {
    const { data: client } = await service.from('client_users').select('*').eq('email', email.toLowerCase()).single()
    if (!client) return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
    if (!client.password_hash) return NextResponse.json({ error: 'Please set your password via the invite link' }, { status: 401 })
    const valid = await bcrypt.compare(password, client.password_hash)
    if (!valid) return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
    await service.from('client_users').update({ last_login_at: new Date().toISOString() }).eq('id', client.id)
    const jwtToken = jwt.sign({ clientId: client.id, jobId: client.job_id, companyId: client.company_id, type: 'client' }, JWT_SECRET, { expiresIn: '7d' })
    return NextResponse.json({ token: jwtToken, name: client.name, jobId: client.job_id })
  }

  // SET PASSWORD FROM INVITE
  if (action === 'set_password') {
    const { data: client } = await service.from('client_users').select('*').eq('invite_token', token).single()
    if (!client) return NextResponse.json({ error: 'Invalid or expired invite link' }, { status: 400 })
    const hash = await bcrypt.hash(password, 10)
    await service.from('client_users').update({ password_hash: hash, invite_token: null }).eq('id', client.id)
    const jwtToken = jwt.sign({ clientId: client.id, jobId: client.job_id, companyId: client.company_id, type: 'client' }, JWT_SECRET, { expiresIn: '7d' })
    return NextResponse.json({ token: jwtToken, name: client.name, jobId: client.job_id })
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}