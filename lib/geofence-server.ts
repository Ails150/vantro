// Server-side geofence radius resolution, including the "smart geofence" for
// remote sites that have no address/postcode. Runs transparently at sign-in /
// sign-out — the installer never sees it.

function haversineMetres(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371000
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)))
}

// Reverse-geocode lat/lng and report whether a postcode exists within maxMetres.
// Degrades to false (treat as remote) if the API key is missing or the call fails.
async function hasPostcodeWithin(lat: number, lng: number, maxMetres: number): Promise<boolean> {
  const key = process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
  if (!key) return false
  try {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${key}`
    )
    const data = await res.json()
    if (data.status !== "OK" || !Array.isArray(data.results)) return false
    for (const r of data.results) {
      const hasPostal = (r.address_components || []).some((c: any) =>
        (c.types || []).includes("postal_code")
      )
      if (!hasPostal) continue
      const loc = r.geometry?.location
      if (!loc) continue
      if (haversineMetres(lat, lng, loc.lat, loc.lng) <= maxMetres) return true
    }
    return false
  } catch {
    return false
  }
}

type JobLike = {
  address?: string | null
  lat?: number | null
  lng?: number | null
  distance_from_site_km?: number | null
  geofence_radius_metres?: number | null
}
type CompanyLike = { geofence_radius_metres?: number | null }

// Effective geofence radius in metres for a sign-in/out check.
// Precedence:
//   1) Per-job override (admin-chosen) or company default, else 150m  -> base
//   2) For REMOTE sites (no address/postcode):
//        a) if distance_from_site_km is set, use it (km -> m)
//        b) else if no postcode is found within 500m of the site, use a 500m minimum
export async function resolveGeofenceRadius(
  job: JobLike,
  company: CompanyLike | null | undefined
): Promise<number> {
  let radius = job?.geofence_radius_metres ?? company?.geofence_radius_metres ?? 150

  const isRemote = !job?.address || !String(job.address).trim()
  if (isRemote) {
    if (job?.distance_from_site_km != null) {
      radius = Math.round(Number(job.distance_from_site_km) * 1000)
    } else if (job?.lat != null && job?.lng != null) {
      const nearPostcode = await hasPostcodeWithin(job.lat, job.lng, 500)
      if (!nearPostcode) radius = Math.max(radius, 500)
    }
  }
  return radius
}
