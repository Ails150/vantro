// Geofence radius options, in metres. Used by company settings and per-job
// override dropdowns. KM options are for remote sites with no postcode.
export const GEOFENCE_RADIUS_OPTIONS: { value: number; label: string }[] = [
  { value: 50, label: "50 m" },
  { value: 100, label: "100 m" },
  { value: 150, label: "150 m" },
  { value: 200, label: "200 m" },
  { value: 300, label: "300 m" },
  { value: 500, label: "500 m" },
  { value: 1000, label: "1 km" },
  { value: 2000, label: "2 km" },
  { value: 5000, label: "5 km" },
  { value: 10000, label: "10 km" },
  { value: 25000, label: "25 km" },
]
