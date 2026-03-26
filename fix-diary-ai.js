const fs = require("fs")
let c = fs.readFileSync("C:/vantro/app/api/diary/route.ts", "utf8")

c = c.replace(
  `You are analysing a construction site diary entry. Identify if there is a blocker (work completely stopped), issue (problem that needs attention), or nothing significant.

Diary entry: "\${text}"

Respond with JSON only:
{"type": "blocker"|"issue"|"none", "message": "brief description for foreman or null"}`,
  `You are analysing a construction site diary entry written by an installer on site.

Classify the entry into exactly one of these three categories:
- "blocker": Work has completely stopped or cannot proceed. Examples: equipment broken, access denied, dangerous conditions, missing materials that halt all work, injury, structural problem discovered.
- "issue": A problem exists that needs the foreman to be aware of but work can continue. Examples: minor delays, quality concern, something that needs follow-up, a question that needs answering.
- "update": Routine progress update, work going well, tasks completed, normal day. No action needed from foreman.

Diary entry: "\${text}"

Respond with JSON only. For blocker and issue include a brief message for the foreman. For update, message should be null:
{"type": "blocker"|"issue"|"update", "message": "brief one sentence summary for foreman or null"}`
)

// Only fire alert for blockers, not issues
c = c.replace(
  "    if (aiResult.type !== 'none' && aiResult.message) {",
  "    if (aiResult.type === 'blocker' && aiResult.message) {"
)

// Update the ai_processed flag logic - mark all non-updates
c = c.replace(
  "      await service.from('diary_entries').update({ ai_processed: true }).eq('id', entry.id)",
  "      await service.from('diary_entries').update({ ai_processed: true, ai_alert_type: aiResult.type }).eq('id', entry.id)"
)

// Save ai_alert_type for issues too even without alert
c = c.replace(
  "  } catch (e) {",
  `    } else if (aiResult.type === 'issue') {
      await service.from('diary_entries').update({ ai_alert_type: 'issue', ai_summary: aiResult.message }).eq('id', entry.id)
    } else {
      await service.from('diary_entries').update({ ai_alert_type: 'update' }).eq('id', entry.id)
    }
  } catch (e) {`
)

fs.writeFileSync("C:/vantro/app/api/diary/route.ts", c, "utf8")
console.log("Done")
