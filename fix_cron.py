import re

content = open('app/api/notifications/cron/route.ts', encoding='utf-8').read()

# Find and replace the grace period expired block
old = """          } else {
            // Grace period expired — auto-close with zero hours
            await service.from("signins").update({
              signed_out_at: now.toISOString(),
              hours_worked: 0,
              auto_closed: true,
              auto_closed_reason: "cutoff_zero",
              flagged: true,
              flag_reason: `Did not sign out. Expected: ${soh}:${som.toString().padStart(2, "0")}. Auto-closed after ${gracePeriod} min grace. Zero hours.`,
            }).eq("id", signin.id)

            await sendPushNotification(
              [user.push_token],
              "Hours recorded as zero",
              `You did not sign out of ${job?.name}. Your hours for today have been recorded as zero. Please speak to your manager.`,
              { type: "auto_cutoff", jobId: signin.job_id }
            )"""

new = """          } else {
            // Grace period expired - use GPS to determine sign-out time
            const fortyFiveMinsAgo = new Date(now.getTime() - 45 * 60 * 1000).toISOString()
            const { data: lastPings } = await service
              .from("location_logs")
              .select("lat, lng, logged_at, within_range, distance_from_site_metres")
              .eq("user_id", signin.user_id)
              .eq("job_id", signin.job_id)
              .order("logged_at", { ascending: false })
              .limit(5)

            let autoSignOutTime = now.toISOString()
            let flagReason = ""
            let hoursWorked = 0
            const signInTime = new Date(signin.signed_in_at)

            if (lastPings && lastPings.length > 0) {
              const lastPing = lastPings[0]
              const lastOnSite = lastPings.find((p: any) => p.within_range)

              if (lastPing.within_range && lastPing.logged_at > fortyFiveMinsAgo) {
                // Still on site - close at now, full hours
                autoSignOutTime = now.toISOString()
                hoursWorked = parseFloat(((now.getTime() - signInTime.getTime()) / 3600000).toFixed(2))
                flagReason = `Auto-closed: GPS confirmed on site within last 45 mins (${Math.round(lastPing.distance_from_site_metres)}m from site). Full hours recorded: ${hoursWorked}.`
              } else if (lastOnSite) {
                // Last on-site ping found - close at that time
                autoSignOutTime = lastOnSite.logged_at
                hoursWorked = parseFloat(((new Date(lastOnSite.logged_at).getTime() - signInTime.getTime()) / 3600000).toFixed(2))
                flagReason = `Auto-closed: Last GPS on-site ping at ${lastOnSite.logged_at}. Hours recorded to last confirmed on-site time: ${hoursWorked}.`
              } else {
                // No on-site ping found - close at expected sign-out time
                const expectedOut = new Date(signInTime)
                expectedOut.setHours(soh, som, 0, 0)
                autoSignOutTime = expectedOut.toISOString()
                hoursWorked = parseFloat(((expectedOut.getTime() - signInTime.getTime()) / 3600000).toFixed(2))
                flagReason = `Auto-closed: No GPS on-site confirmation found. Closed at expected finish time. Hours: ${hoursWorked}. Admin review required.`
              }
            } else {
              // No GPS data at all - close at expected sign-out time
              const expectedOut = new Date(signInTime)
              expectedOut.setHours(soh, som, 0, 0)
              autoSignOutTime = expectedOut.toISOString()
              hoursWorked = parseFloat(((expectedOut.getTime() - signInTime.getTime()) / 3600000).toFixed(2))
              flagReason = `Auto-closed: No GPS data available. Closed at expected finish time. Hours: ${hoursWorked}. Admin review required.`
            }

            hoursWorked = Math.max(0, hoursWorked)

            await service.from("signins").update({
              signed_out_at: autoSignOutTime,
              hours_worked: hoursWorked,
              auto_closed: true,
              auto_closed_reason: "auto_closed_gps",
              flagged: true,
              flag_reason: flagReason,
            }).eq("id", signin.id)

            await sendPushNotification(
              [user.push_token],
              "Shift auto-closed",
              `Your shift at ${job?.name} has been automatically closed. ${hoursWorked.toFixed(1)} hrs recorded. Please speak to your manager if this is incorrect.`,
              { type: "auto_cutoff", jobId: signin.job_id }
            )"""

content = content.replace(old, new)
open('app/api/notifications/cron/route.ts', 'w', encoding='utf-8').write(content)
print('Fixed:', 'auto_closed_gps' in content)