import Link from "next/link"

// Shown at the top of the dashboard when a platform support user is viewing a
// company, so it's always clear they're acting as support (not a team member).
export default function SupportBanner({ companyName }: { companyName: string }) {
  return (
    <div className="bg-purple-600 text-white text-sm px-4 py-2 flex items-center justify-between gap-3">
      <span className="font-medium">
        🛟 Support mode — viewing <strong>{companyName}</strong>. Access is logged.
      </span>
      <Link href="/support" className="underline whitespace-nowrap hover:text-purple-100">
        Switch company
      </Link>
    </div>
  )
}
