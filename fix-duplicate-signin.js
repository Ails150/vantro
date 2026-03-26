const fs = require("fs")
let c = fs.readFileSync("app/api/signin/route.ts", "utf8")

// Add duplicate check before insert
c = c.replace(
  "  const { error } = await service.from('signins').insert({",
  `  // Check already signed in today
  const today = new Date(); today.setHours(0,0,0,0)
  const { data: existing } = await service.from('signins')
    .select('id')
    .eq('job_id', jobId)
    .eq('user_id', installer.userId)
    .gte('signed_in_at', today.toISOString())
    .is('signed_out_at', null)
    .single()
  
  if (existing) return NextResponse.json({ success: true, distanceMetres, withinRange, alreadySignedIn: true })

  const { error } = await service.from('signins').insert({`
)

fs.writeFileSync("app/api/signin/route.ts", c, "utf8")
console.log("Done")
