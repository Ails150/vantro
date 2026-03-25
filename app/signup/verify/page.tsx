import Link from 'next/link'

export default function VerifyPage() {
  return (
    <div className="min-h-screen bg-[#0f1923] flex items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <div className="inline-flex items-center gap-2 mb-8">
          <div className="w-8 h-8 rounded-lg bg-[#00d4a0] flex items-center justify-center">
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
              <rect x="2" y="2" width="7" height="7" rx="1.5" fill="#0f1923"/>
              <rect x="11" y="2" width="7" height="7" rx="1.5" fill="#0f1923" opacity="0.7"/>
              <rect x="2" y="11" width="7" height="7" rx="1.5" fill="#0f1923" opacity="0.7"/>
              <rect x="11" y="11" width="7" height="7" rx="1.5" fill="#0f1923" opacity="0.4"/>
            </svg>
          </div>
          <span className="text-xl font-semibold text-white">Van<span className="text-[#00d4a0]">tro</span></span>
        </div>

        <div className="bg-[#1a2635] border border-white/5 rounded-2xl p-8">
          <div className="w-16 h-16 rounded-full bg-[#00d4a0]/10 border border-[#00d4a0]/20 flex items-center justify-center mx-auto mb-5">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" stroke="#00d4a0" stroke-width="1.5"/>
              <path d="M22 6l-10 7L2 6" stroke="#00d4a0" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-white mb-2">Check your email</h1>
          <p className="text-[#4d6478] text-sm mb-6">
            We sent a confirmation link to your email address. Click it to verify your account and set up your team.
          </p>
          <p className="text-xs text-[#4d6478]">
            Did not receive it? Check your spam folder or{' '}
            <Link href="/signup" className="text-[#00d4a0] hover:underline">try again</Link>.
          </p>
        </div>
      </div>
    </div>
  )
}
