content = open('app/api/notifications/cron/route.ts', encoding='utf-8').read()
content = content.replace('"Please sign out"', '"Sign out reminder"')
content = content.replace('"Hours recorded as zero"', '"Shift auto-closed"')
content = content.replace('"Zero hours recorded"', '"Shift auto-closed"')
content = content.replace('hours_worked: 0,', 'hours_worked: Math.max(0, parseFloat(((now.getTime() - new Date(signin.signed_in_at).getTime()) / 3600000).toFixed(2))),')
content = content.replace('auto_closed_reason: "cutoff_zero"', 'auto_closed_reason: "auto_closed_gps"')
content = content.replace(
    'You did not sign out of ${job?.name}. Your hours for today have been recorded as zero. Please speak to your manager.',
    'Your shift at ${job?.name} was automatically closed. Hours recorded based on your start time. Please speak to your manager if incorrect.'
)
content = content.replace(
    '${user?.name} did not sign out of ${job?.name}. Zero hours recorded automatically.',
    '${user?.name} did not sign out of ${job?.name}. Hours auto-recorded. Please review.'
)
open('app/api/notifications/cron/route.ts', 'w', encoding='utf-8').write(content)
print('Cron fixed:', 'auto_closed_gps' in content)