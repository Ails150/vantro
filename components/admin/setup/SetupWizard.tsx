"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toVertical, verticalConfig } from "@/lib/vertical"

/**
 * Setup, for somebody who wants to prove one job.
 *
 * WHAT THIS USED TO BE. Five steps, four of them locked behind the one before
 * it: pick a vertical, add a job, add the team, link them on a matrix, set
 * working hours for everybody. /api/admin/setup/complete refused to finish
 * until a job AND a worker AND an assignment AND a shift pattern all existed,
 * and app/admin/page.tsx bounced every visit to /admin back here until it did.
 * A sole trader who wanted to photograph one job had to staff a rota first.
 *
 * WHAT IT IS NOW. One thing is required -- a job -- and there is a one-tap
 * answer for the person who is also the crew. The vertical question moved to
 * the first screen whose wording depends on it. Working hours and the
 * assignment matrix moved to Today, as prompts that can be answered when they
 * matter, because a prompt costs a line and a locked door costs the customer.
 */

type Props = {
  companyName: string
  userName: string
  vertical: string | null | undefined
  jobsCount: number
  teamCount: number
  assignmentsCount: number
  schedulesCount: number
}

export default function SetupWizard({
  companyName,
  userName,
  vertical,
  jobsCount,
  teamCount,
  assignmentsCount,
}: Props) {
  const router = useRouter()
  const [completing, setCompleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const terms = verticalConfig(toVertical(vertical))

  // "It's just me": the owner becomes their own first worker.
  const [soloOpen, setSoloOpen] = useState(false)
  const [pin, setPin] = useState("")
  const [soloBusy, setSoloBusy] = useState(false)
  const [soloError, setSoloError] = useState<string | null>(null)
  const [soloDone, setSoloDone] = useState(false)

  const hasJob = jobsCount > 0
  const hasWorker = teamCount > 0 || soloDone

  async function completeOnboarding() {
    setCompleting(true)
    setError(null)
    const res = await fetch("/api/admin/setup/complete", { method: "POST" })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError(j.error || "Could not complete setup")
      setCompleting(false)
      return
    }
    router.push("/admin")
  }

  async function setUpSolo() {
    setSoloBusy(true)
    setSoloError(null)
    const res = await fetch("/api/admin/setup/solo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin }),
    })
    const j = await res.json().catch(() => ({}))
    setSoloBusy(false)
    if (!res.ok) {
      setSoloError(j.error || "Could not set that up")
      return
    }
    setSoloDone(true)
    setSoloOpen(false)
    router.refresh()
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-12">
      <div className="max-w-2xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Welcome, {userName}.</h1>
          <p className="text-gray-600 mt-2">
            Add one job and {companyName} is ready. Everything else can wait until you need it.
          </p>
        </div>

        <div className="space-y-4">
          <StepCard
            number={1}
            title="Add your first job"
            description={`Where the work is. You can add more later, and change anything about this one.`}
            count={jobsCount}
            countLabel="job"
            isCurrent={!hasJob}
            isDone={hasJob}
            actionLabel={hasJob ? "Add another" : "Add a job"}
            onAction={() => router.push("/admin?tab=jobs&from=setup")}
          />

          <div className={"rounded-2xl border bg-white p-5 " + (hasWorker ? "border-emerald-200" : "border-gray-200")}>
            <div className="flex items-start gap-4">
              <div
                className={
                  "w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 font-semibold text-sm " +
                  (hasWorker ? "bg-emerald-500 text-white" : "bg-gray-100 text-gray-500")
                }
              >
                {hasWorker ? "✓" : 2}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-gray-900">Who is doing the work?</h3>
                <p className="text-sm text-gray-600 mt-0.5">
                  Optional. Add {terms.workersLower} now, or say it is just you and use the app yourself.
                </p>
                {soloDone && (
                  <p className="text-xs text-emerald-600 mt-2 font-medium">
                    You are set up as your own first worker, with your PIN, and assigned to your jobs.
                  </p>
                )}
                {teamCount > 0 && (
                  <p className="text-xs text-emerald-600 mt-2 font-medium">
                    {teamCount} team member{teamCount !== 1 ? "s" : ""} added
                    {assignmentsCount > 0 ? ` · ${assignmentsCount} assignment${assignmentsCount !== 1 ? "s" : ""}` : ""}
                  </p>
                )}

                {soloOpen && (
                  <div className="mt-4 rounded-xl bg-gray-50 border border-gray-200 p-4">
                    <label className="block text-sm font-medium text-gray-900">
                      Choose a 4-digit PIN for the app
                      <input
                        value={pin}
                        onChange={e => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                        inputMode="numeric"
                        autoComplete="off"
                        placeholder="••••"
                        className="mt-1 block w-32 rounded-lg border border-gray-300 px-3 py-2 text-lg tracking-[0.4em]"
                      />
                    </label>
                    <p className="text-xs text-gray-500 mt-2">
                      This is what you type on your phone to sign in to a job. Your email and password still get
                      you in here.
                    </p>
                    {soloError && <p className="text-sm text-red-600 mt-2">{soloError}</p>}
                    <div className="mt-3 flex gap-2">
                      <button
                        onClick={setUpSolo}
                        disabled={soloBusy || pin.length !== 4}
                        className="px-4 py-2 rounded-xl text-sm font-medium bg-teal-500 hover:bg-teal-600 text-white disabled:opacity-50"
                      >
                        {soloBusy ? "Setting up…" : "Set my PIN"}
                      </button>
                      <button
                        onClick={() => { setSoloOpen(false); setSoloError(null) }}
                        className="px-4 py-2 rounded-xl text-sm text-gray-600 hover:text-gray-900"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {!soloOpen && !soloDone && (
                <div className="flex flex-col gap-2 flex-shrink-0">
                  <button
                    onClick={() => setSoloOpen(true)}
                    className="px-4 py-2 rounded-xl text-sm font-medium bg-teal-500 hover:bg-teal-600 text-white"
                  >
                    It&apos;s just me
                  </button>
                  <button
                    onClick={() => router.push("/admin?tab=team&from=setup")}
                    className="px-4 py-2 rounded-xl text-sm font-medium bg-white border border-gray-200 text-gray-700 hover:bg-gray-50"
                  >
                    Add people
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-8 rounded-2xl border border-gray-200 bg-white p-6 text-center">
          {hasJob ? (
            <>
              <h3 className="font-semibold text-gray-900 mb-1">That is enough to start.</h3>
              <p className="text-sm text-gray-600 mb-4">
                Working hours and who works where are on the dashboard when you want them.
              </p>
            </>
          ) : (
            <p className="text-sm text-gray-600 mb-4">Add a job above and you are ready to go.</p>
          )}
          {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
          <button
            onClick={completeOnboarding}
            disabled={completing || !hasJob}
            className="px-6 py-2.5 bg-teal-500 hover:bg-teal-600 text-white font-medium rounded-xl disabled:opacity-50"
          >
            {completing ? "Loading..." : "Go to dashboard →"}
          </button>
        </div>

        <p className="text-xs text-gray-500 text-center mt-8">
          Need help? Email aileen@applyscale8.com
        </p>
      </div>
    </div>
  )
}

function StepCard({
  number,
  title,
  description,
  count,
  countLabel,
  isCurrent,
  isDone,
  actionLabel,
  onAction,
}: {
  number: number
  title: string
  description: string
  count: number
  countLabel: string
  isCurrent: boolean
  isDone: boolean
  actionLabel: string
  onAction: () => void
}) {
  return (
    <div
      className={
        "rounded-2xl border bg-white p-5 transition-all " +
        (isCurrent ? "border-teal-400 shadow-md" : isDone ? "border-emerald-200" : "border-gray-200")
      }
    >
      <div className="flex items-start gap-4">
        <div
          className={
            "w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 font-semibold text-sm " +
            (isDone ? "bg-emerald-500 text-white" : isCurrent ? "bg-teal-500 text-white" : "bg-gray-100 text-gray-500")
          }
        >
          {isDone ? "✓" : number}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-gray-900">{title}</h3>
          <p className="text-sm text-gray-600 mt-0.5">{description}</p>
          {count > 0 && (
            <p className="text-xs text-emerald-600 mt-2 font-medium">
              {count} {countLabel}{count !== 1 ? "s" : ""} added
            </p>
          )}
        </div>
        <button
          onClick={onAction}
          className={
            "px-4 py-2 rounded-xl text-sm font-medium transition-colors flex-shrink-0 " +
            (isDone
              ? "bg-white border border-emerald-200 text-emerald-700 hover:bg-emerald-50"
              : "bg-teal-500 hover:bg-teal-600 text-white")
          }
        >
          {actionLabel}
        </button>
      </div>
    </div>
  )
}
