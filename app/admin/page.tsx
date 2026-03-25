import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function AdminPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  return (
    <div className="min-h-screen bg-[#0f1923] text-white p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-8 h-8 rounded-lg bg-[#00d4a0] flex items-center justify-center">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
              <rect x="2" y="2" width="7" height="7" rx="1.5" fill="#0f1923"/>
              <rect x="11" y="2" width="7" height="7" rx="1.5" fill="#0f1923" opacity="0.7"/>
              <rect x="2" y="11" width="7" height="7" rx="1.5" fill="#0f1923" opacity="0.7"/>
              <rect x="11" y="11" width="7" height="7" rx="1.5" fill="#0f1923" opacity="0.4"/>
            </svg>
          </div>
          <span className="text-xl font-semibold">Van<span className="text-[#00d4a0]">tro</span></span>
        </div>

        <div className="bg-[#1a2635] border border-[rgba(255,255,255,0.07)] rounded-2xl p-6">
          <h1 className="text-lg font-semibold mb-1">Dashboard</h1>
          <p className="text-[#4d6478] text-sm mb-6">Signed in as {user.email}</p>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {['On site', 'Jobs today', 'Awaiting review', 'SiteLog alerts'].map((label) => (
              <div key={label} className="bg-[#243040] rounded-xl p-4">
                <div className="text-[#4d6478] text-xs font-medium uppercase tracking-wide mb-2">{label}</div>
                <div className="text-2xl font-semibold text-[#00d4a0]">0</div>
              </div>
            ))}
          </div>
        </div>

        <p className="text-[#4d6478] text-sm mt-6 text-center">
          Full dashboard building now. Come back soon.
        </p>
      </div>
    </div>
  )
}
