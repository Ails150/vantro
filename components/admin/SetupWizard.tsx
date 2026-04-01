'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const STEPS = [
  { id: 'team', num: 1, title: 'Add your first team member', sub: 'They will get an email to download the app and set their PIN.' },
  { id: 'checklist', num: 2, title: 'Create a QA checklist', sub: 'Define the quality checks your team complete on every job.' },
  { id: 'job', num: 3, title: 'Add your first job', sub: 'GPS sign-in enforces attendance. Assign team and checklists from Jobs tab.' },
]

export default function SetupWizard({ companyId, onComplete }: { companyId: string, onComplete: () => void }) {
  const [step, setStep] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [memberName, setMemberName] = useState('')
  const [memberEmail, setMemberEmail] = useState('')
  const [memberRole, setMemberRole] = useState('installer')
  const [checklistName, setChecklistName] = useState('')
  const [jobName, setJobName] = useState('')
  const router = useRouter()

  async function addTeamMember() {
    if (!memberName.trim() || !memberEmail.trim()) { setError('Enter name and email'); return }
    setLoading(true); setError('')
    const res = await fetch('/api/invite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: memberEmail, name: memberName, role: memberRole }) })
    if (!res.ok) { setError('Could not add team member'); setLoading(false); return }
    setLoading(false); setStep(1)
  }

  async function createChecklist() {
    if (!checklistName.trim()) { setError('Enter a checklist name'); return }
    setLoading(true); setError('')
    const supabase = createClient()
    const { error: e } = await supabase.from('checklist_templates').insert({ company_id: companyId, name: checklistName.trim(), requires_approval: false, audit_only: false })
    if (e) { setError(e.message); setLoading(false); return }
    setLoading(false); setStep(2)
  }

  async function addJob() {
    if (!jobName.trim()) { setError('Enter a job name'); return }
    setLoading(true); setError('')
    const supabase = createClient()
    const { error: e } = await supabase.from('jobs').insert({ company_id: companyId, name: jobName.trim(), status: 'active' })
    if (e) { setError(e.message); setLoading(false); return }
    await supabase.from('companies').update({ setup_complete: true }).eq('id', companyId)
    setLoading(false); onComplete()
  }

  const current = STEPS[step]

  return (
    <div className="fixed inset-0 bg-[#0A1628] flex flex-col items-center justify-center px-4 z-50">
      <div className="w-full max-w-lg">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 mb-2">
            <div className="w-9 h-9 rounded-xl bg-[#00d4a0] flex items-center justify-center">
              <svg width="16" height="16" viewBox="0 0 20 20" fill="none"><rect x="2" y="2" width="7" height="7" rx="1.5" fill="#0f1923"/><rect x="11" y="2" width="7" height="7" rx="1.5" fill="#0f1923" opacity="0.7"/><rect x="2" y="11" width="7" height="7" rx="1.5" fill="#0f1923" opacity="0.7"/><rect x="11" y="11" width="7" height="7" rx="1.5" fill="#0f1923" opacity="0.4"/></svg>
            </div>
            <span className="text-white text-xl font-semibold">Van<span className="text-[#00d4a0]">tro</span></span>
          </div>
          <p className="text-[#4d6478] text-sm">Let's get you set up in 3 steps</p>
        </div>

        <div className="flex items-center justify-center gap-3 mb-10">
          {STEPS.map((s, i) => (
            <div key={s.id} className="flex items-center gap-3">
              <div className={"flex items-center gap-2"}>
                <div className={"w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all " + (i < step ? "bg-[#00d4a0] text-[#0A1628]" : i === step ? "border-2 border-[#00d4a0] text-[#00d4a0]" : "border-2 border-white/10 text-[#4d6478]")}>
                  {i < step ? "✓" : s.num}
                </div>
                <span className={"text-sm " + (i === step ? "text-white font-medium" : "text-[#4d6478]")}>{s.title.split(' ').slice(0,2).join(' ')}</span>
              </div>
              {i < 2 && <div className="w-8 h-px bg-white/10"/>}
            </div>
          ))}
        </div>

        <div className="bg-[#131f30] border border-white/5 rounded-2xl p-8">
          <h2 className="text-white text-xl font-semibold mb-1">{current.title}</h2>
          <p className="text-[#4d6478] text-sm mb-6">{current.sub}</p>

          {step === 0 && (
            <div className="space-y-3">
              <input value={memberName} onChange={e => setMemberName(e.target.value)} placeholder="Full name" className="w-full bg-[#0A1628] border border-white/10 rounded-xl px-4 py-3 text-white placeholder-[#4d6478] focus:outline-none focus:border-[#00d4a0]/50 text-sm"/>
              <input value={memberEmail} onChange={e => setMemberEmail(e.target.value)} placeholder="Email address" type="email" className="w-full bg-[#0A1628] border border-white/10 rounded-xl px-4 py-3 text-white placeholder-[#4d6478] focus:outline-none focus:border-[#00d4a0]/50 text-sm"/>
              <select value={memberRole} onChange={e => setMemberRole(e.target.value)} className="w-full bg-[#0A1628] border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#00d4a0]/50 text-sm">
                <option value="installer">Installer — PIN app access</option>
                <option value="foreman">Foreman — Dashboard + PIN app</option>
              </select>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-3">
              <input value={checklistName} onChange={e => setChecklistName(e.target.value)} placeholder="e.g. Glazing Installation QA" className="w-full bg-[#0A1628] border border-white/10 rounded-xl px-4 py-3 text-white placeholder-[#4d6478] focus:outline-none focus:border-[#00d4a0]/50 text-sm"/>
              <p className="text-xs text-[#4d6478]">You can add checklist items after setup from the Checklists tab.</p>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <input value={jobName} onChange={e => setJobName(e.target.value)} placeholder="e.g. 14 Church Street, Manchester" className="w-full bg-[#0A1628] border border-white/10 rounded-xl px-4 py-3 text-white placeholder-[#4d6478] focus:outline-none focus:border-[#00d4a0]/50 text-sm"/>
              <p className="text-xs text-[#4d6478]">You can add the full address and assign team from the Jobs tab after setup.</p>
            </div>
          )}

          {error && <p className="text-red-400 text-sm mt-3">{error}</p>}

          <div className="flex gap-3 mt-6">
            {step > 0 && <button onClick={() => { setStep(step - 1); setError('') }} className="flex-1 bg-white/5 text-[#8fa3b8] rounded-xl py-3 text-sm hover:bg-white/10 transition-colors">Back</button>}
            <button
              onClick={step === 0 ? addTeamMember : step === 1 ? createChecklist : addJob}
              disabled={loading}
              className="flex-[2] bg-[#00d4a0] hover:bg-[#00b88a] disabled:opacity-40 text-[#0A1628] font-semibold rounded-xl py-3 text-sm transition-colors"
            >
              {loading ? 'Saving...' : step === 2 ? 'Go to dashboard →' : 'Continue →'}
            </button>
          </div>

          <button onClick={onComplete} className="w-full text-center text-xs text-[#4d6478] hover:text-white mt-4 transition-colors">
            Skip setup — I'll do this later
          </button>
        </div>
      </div>
    </div>
  )
}
