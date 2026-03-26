const fs = require("fs")
let c = fs.readFileSync("components/admin/AdminDashboard.tsx", "utf8")

// Fix imports
c = c.replace(
  'import { useState } from "react"',
  'import { useState, useEffect, useRef } from "react"'
)

// Add lat/lng state after jobTemplateId state
c = c.replace(
  'const [jobTemplateId, setJobTemplateId] = useState("")',
  `const [jobTemplateId, setJobTemplateId] = useState("")
  const [jobLat, setJobLat] = useState(null)
  const [jobLng, setJobLng] = useState(null)
  const [editJobLat, setEditJobLat] = useState(null)
  const [editJobLng, setEditJobLng] = useState(null)
  const addAddressRef = useRef(null)
  const editAddressRef = useRef(null)`
)

// Add useEffect for Google Maps after the state declarations - before switchTab
c = c.replace(
  '  function switchTab(tab: string) {',
  `  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY
    if (!key) return
    function init() {
      if (!window.google) return
      if (addAddressRef.current) {
        const ac = new (window as any).google.maps.places.Autocomplete(addAddressRef.current, { types: ["address"] })
        ac.addListener("place_changed", () => {
          const place = ac.getPlace()
          if (place.formatted_address) setJobAddress(place.formatted_address)
          if (place.geometry?.location) { setJobLat(place.geometry.location.lat()); setJobLng(place.geometry.location.lng()) }
        })
      }
      if (editAddressRef.current) {
        const ac2 = new (window as any).google.maps.places.Autocomplete(editAddressRef.current, { types: ["address"] })
        ac2.addListener("place_changed", () => {
          const place = ac2.getPlace()
          if (place.formatted_address) setEditJobAddress(place.formatted_address)
          if (place.geometry?.location) { setEditJobLat(place.geometry.location.lat()); setEditJobLng(place.geometry.location.lng()) }
        })
      }
    }
    if ((window as any).google) { init(); return }
    if (!document.getElementById("gmaps")) {
      const s = document.createElement("script")
      s.id = "gmaps"
      s.src = "https://maps.googleapis.com/maps/api/js?key=" + key + "&libraries=places"
      s.async = true
      s.onload = init
      document.head.appendChild(s)
    }
  }, [showAddJob, editingJobId])

  function switchTab(tab: string) {`
)

// Update addJob to include lat/lng
c = c.replace(
  'address: jobAddress.trim(), status: "active", checklist_template_id: jobTemplateId || null })',
  'address: jobAddress.trim(), status: "active", checklist_template_id: jobTemplateId || null, lat: jobLat, lng: jobLng })'
)

// Update updateJob to include lat/lng
c = c.replace(
  'address: editJobAddress.trim(), checklist_template_id: editJobTemplateId || null })',
  'address: editJobAddress.trim(), checklist_template_id: editJobTemplateId || null, lat: editJobLat, lng: editJobLng })'
)

// Add ref to add job address input
c = c.replace(
  '<input value={jobAddress} onChange={e => setJobAddress(e.target.value)} placeholder="Site address" className={inp}/>',
  '<input ref={addAddressRef} value={jobAddress} onChange={e => setJobAddress(e.target.value)} placeholder="Start typing site address..." className={inp}/>'
)

// Add ref to edit job address input
c = c.replace(
  '<input value={editJobAddress} onChange={e => setEditJobAddress(e.target.value)} placeholder="Site address" className={inp}/>',
  '<input ref={editAddressRef} value={editJobAddress} onChange={e => setEditJobAddress(e.target.value)} placeholder="Start typing site address..." className={inp}/>'
)

fs.writeFileSync("components/admin/AdminDashboard.tsx", c, "utf8")
console.log("Done")
