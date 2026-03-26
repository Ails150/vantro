const fs = require("fs")
let c = fs.readFileSync("C:/vantro/app/api/qa/route.ts", "utf8")

c = c.replace(
  "  const { jobId, itemId, state, notes } = await request.json()",
  "  const { jobId, itemId, state, notes, photoUrl, photoPath } = await request.json()"
)

c = c.replace(
  "    await service.from('qa_submissions').update({ state, notes, submitted_at: new Date().toISOString() }).eq('id', existing.id)",
  "    await service.from('qa_submissions').update({ state, notes, photo_url: photoUrl || null, photo_path: photoPath || null, submitted_at: new Date().toISOString() }).eq('id', existing.id)"
)

c = c.replace(
  "    await service.from('qa_submissions').insert({ job_id: jobId, user_id: installer.userId, company_id: job.company_id, checklist_item_id: itemId, state, notes })",
  "    await service.from('qa_submissions').insert({ job_id: jobId, user_id: installer.userId, company_id: job.company_id, checklist_item_id: itemId, state, notes, photo_url: photoUrl || null, photo_path: photoPath || null })"
)

fs.writeFileSync("C:/vantro/app/api/qa/route.ts", c, "utf8")
console.log("Done")
