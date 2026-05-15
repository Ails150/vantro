"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

type Props = {
  companyName: string
  userName: string
  jobsCount: number
  teamCount: number
  assignmentsCount: number
  schedulesCount: number
}

export default function SetupWizard({
  companyName,
  userName,
  jobsCount,
  teamCount,
  assignmentsCount,
  schedulesCount,
}: Props) {
  const router = useRouter()
  const [completing, setCompleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const step1Done = jobsCount > 0
  const step2Done = teamCount > 0
  const step3Done = assignmentsCount > 0
  const step4Done = schedulesCount > 0

  const currentStep =
    !step1Done ? 1 :
    !step2Done ? 2 :
    !step3Done ? 3 :
    !step4Done ? 4 : 5

  const allDone = step1Done && step2Done && step3Done && step4Done

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

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-12">
      <div className="max-w-2xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Welcome, {userName}.</h1>
          <p className="text-gray-600 mt-2">
            Let&apos;s get {companyName} set up. Four quick steps and you&apos;re ready to go.
          </p>
        </div>

        <div className="space-y-4">
          <StepCard
            number={1}
            title="Add your job sites"
            description="Where do your installers work? Upload a CSV or add them one by one."
            count={jobsCount}
            countLabel="job site"
            isCurrent={currentStep === 1}
            isDone={step1Done}
            isLocked={false}
            actionLabel={step1Done ? "Add more or continue" : "Add jobs"}
            onAction={() => router.push("/admin?tab=jobs&from=setup")}
          />
          <StepCard
            number={2}
            title="Add your team"
            description="Who's on the team? Upload a CSV or add people manually."
            count={teamCount}
            countLabel="team member"
            isCurrent={currentStep === 2}
            isDone={step2Done}
            isLocked={!step1Done}
            actionLabel={step2Done ? "Add more or continue" : "Add team"}
            onAction={() => router.push("/admin?tab=team&from=setup")}
          />
          <StepCard
            number={3}
            title="Who works where"
            description="Link installers to job sites — they'll only see jobs they're assigned to."
            count={assignmentsCount}
            countLabel="assignment"
            isCurrent={currentStep === 3}
            isDone={step3Done}
            isLocked={!step2Done}
            actionLabel={step3Done ? "Edit assignments" : "Assign installers"}
            onAction={() => router.push("/admin/setup/assignments")}
          />
          <StepCard
            number={4}
            title="Default working hours"
            description="Set the standard Mon–Fri hours for your team. Customise per person later."
            count={schedulesCount}
            countLabel="schedule set"
            isCurrent={currentStep === 4}
            isDone={step4Done}
            isLocked={!step3Done}
            actionLabel={step4Done ? "Edit hours" : "Set hours"}
            onAction={() => router.push("/admin/setup/hours")}
          />
        </div>

        {allDone && (
          <div className="mt-8 bg-emerald-50 border border-emerald-200 rounded-2xl p-6 text-center">
            <div className="text-2xl mb-2">🎉</div>
            <h3 className="font-semibold text-emerald-900 mb-1">All set!</h3>
            <p className="text-sm text-emerald-700 mb-4">
              Everything is configured. Click below to go to your dashboard.
            </p>
            {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
            <button
              onClick={completeOnboarding}
              disabled={completing}
              className="px-6 py-2.5 bg-teal-500 hover:bg-teal-600 text-white font-medium rounded-xl disabled:opacity-50"
            >
              {completing ? "Loading..." : "Go to dashboard →"}
            </button>
          </div>
        )}

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
  isLocked,
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
  isLocked: boolean
  actionLabel: string
  onAction: () => void
}) {
  return (
    <div
      className={
        "rounded-2xl border bg-white p-5 transition-all " +
        (isCurrent ? "border-teal-400 shadow-md" :
         isDone ? "border-emerald-200" :
         isLocked ? "border-gray-200 opacity-60" :
         "border-gray-200")
      }
    >
      <div className="flex items-start gap-4">
        <div
          className={
            "w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 font-semibold text-sm " +
            (isDone ? "bg-emerald-500 text-white" :
             isCurrent ? "bg-teal-500 text-white" :
             "bg-gray-100 text-gray-500")
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
          disabled={isLocked}
          className={
            "px-4 py-2 rounded-xl text-sm font-medium transition-colors flex-shrink-0 " +
            (isLocked ? "bg-gray-100 text-gray-400 cursor-not-allowed" :
             isDone ? "bg-white border border-emerald-200 text-emerald-700 hover:bg-emerald-50" :
             "bg-teal-500 hover:bg-teal-600 text-white")
          }
        >
          {isLocked ? "Locked" : actionLabel}
        </button>
      </div>
    </div>
  )
}