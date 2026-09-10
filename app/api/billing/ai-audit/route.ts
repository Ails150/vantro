import { NextResponse } from "next/server"

// RETIRED: the GBP 79 AI Audit Pack add-on.
//
// Audit features are no longer sold separately. They are what the Suite plan
// (GBP 99) is, so a company either has them or upgrades - there is no third
// state where compliance is bought a la carte on top of a tier.
//
// The route is kept rather than deleted because a client that has not reloaded
// since the change will still POST here, and a 404 from a missing route reads
// as a deploy fault. 410 Gone says the endpoint existed and deliberately does
// not any more, and the body tells the caller where to go instead.
//
// Safe to delete once no traffic reaches it for a release.

export async function POST() {
  return NextResponse.json(
    {
      error: "The AI Audit Pack add-on has been retired. Audit features are included in the Suite plan.",
      code: "add_on_retired",
      upgradeTo: "suite",
    },
    { status: 410 },
  )
}
