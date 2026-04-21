content = open('components/admin/AuditTab.tsx', encoding='utf-8').read()

# Add email button
content = content.replace(
    'style={{ padding: \'10px 20px\', background: \'#00d4a0\', color: \'#0f1923\', border: \'none\', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: \'pointer\' }}>\n              \u2b07 Download Report\n            </button>',
    'style={{ padding: \'10px 20px\', background: \'#00d4a0\', color: \'#0f1923\', border: \'none\', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: \'pointer\' }}>\n              \u2b07 Download Report\n            </button>\n            <button onClick={emailReport}\n              style={{ padding: \'10px 20px\', background: \'#1a2635\', color: \'#00d4a0\', border: \'1px solid #00d4a0\', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: \'pointer\' }}>\n              \u2709 Email Report\n            </button>'
)

# Add GPS stat
content = content.replace(
    "{ label: 'Blockers/Issues',",
    "{ label: 'GPS Points', value: (preview.breadcrumbs?.length || 0), color: '#00d4a0' },\n              { label: 'Blockers/Issues',"
)

# Add emailReport and generateHTML before exportHTML
inject = """  async function emailReport() {
    if (!preview) return
    const email = window.prompt('Send audit report to email address:')
    if (!email) return
    const html = generateHTML(preview)
    const blob = new Blob([html], { type: 'text/html' })
    const fd = new FormData()
    fd.append('file', blob, 'report.html')
    fd.append('to', email)
    fd.append('jobName', preview.job.name)
    fd.append('reportRef', 'VTR-' + preview.job.name.replace(/\\s+/g,'').toUpperCase().slice(0,8) + '-' + Date.now())
    await fetch('/api/audit/email', { method: 'POST', body: fd })
    alert('Report sent to ' + email)
  }

  function generateHTML(data: any) {
    const job = data.job
    const ref = 'VTR-' + job.name.replace(/\\s+/g,'').toUpperCase().slice(0,8) + '-' + Date.now()
    const sRows = data.signins.map((s: any) => { const i=new Date(s.signed_in_at),o=s.signed_out_at?new Date(s.signed_out_at):null,h=o?((o.getTime()-i.getTime())/3600000).toFixed(1):'-'; return '<tr><td>'+(s.users?.name||'?')+'</td><td>'+i.toLocaleString('en-GB')+'</td><td>'+(o?o.toLocaleString('en-GB'):'NOT SIGNED OUT')+'</td><td>'+(s.distance_metres??'-')+'m</td><td>'+h+'</td></tr>' }).join('')
    const dRows = data.diary.map((e: any) => { const p=e.photo_urls?.length>0?e.photo_urls.map((u:string)=>'<img src="'+u+'" style="max-width:80px">').join(''): '-'; const v=e.video_url?'<a href="'+e.video_url+'" target="_blank">Play</a>':'-'; return '<tr><td>'+new Date(e.created_at).toLocaleString('en-GB')+'</td><td>'+(e.users?.name||'?')+'</td><td>'+(e.entry_text||'')+'</td><td>'+(e.ai_summary||'-')+'</td><td>'+p+'</td><td>'+v+'</td></tr>' }).join('')
    const qRows = data.qa.map((q: any) => '<tr><td>'+new Date(q.created_at).toLocaleString('en-GB')+'</td><td>'+(q.users?.name||'?')+'</td><td>'+(q.checklist_items?.label||'-')+'</td><td>'+(q.result?.toUpperCase()||'-')+'</td><td>'+(q.note||'-')+'</td></tr>').join('')
    const bRows = (data.breadcrumbs||[]).map((b: any) => '<tr><td>'+new Date(b.recorded_at).toLocaleString('en-GB')+'</td><td>'+(b.users?.name||'?')+'</td><td>'+b.lat+'</td><td>'+b.lng+'</td><td>'+(b.accuracy??'-')+'m</td></tr>').join('')
    const css = '<style>body{font-family:Arial,sans-serif;max-width:900px;margin:40px auto;color:#1a1a2e}h1{color:#00a87a}h2{margin-top:28px;border-bottom:1px solid #eee}table{width:100%;border-collapse:collapse;margin:12px 0}th{background:#f3e8ff;padding:8px;text-align:left;font-size:12px}td{padding:8px;border-bottom:1px solid #eee;font-size:12px;vertical-align:top}</style>'
    return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Vantro Audit</title>'+css+'</head><body><h1>Vantro Audit Report</h1><p><b>Ref:</b> '+ref+'<br><b>Job:</b> '+job.name+'<br><b>Address:</b> '+job.address+'<br><b>Period:</b> '+(data.period.from||'All')+' to '+(data.period.to||'now')+'<br><b>Generated:</b> '+new Date(data.generated).toLocaleString('en-GB')+'</p><h2>Attendance ('+data.signins.length+')</h2><table><tr><th>Installer</th><th>In</th><th>Out</th><th>Dist In</th><th>Hours</th></tr>'+sRows+'</table><h2>GPS Trail ('+(data.breadcrumbs?.length||0)+')</h2><table><tr><th>Time</th><th>Installer</th><th>Lat</th><th>Lng</th><th>Accuracy</th></tr>'+bRows+'</table><h2>Diary ('+data.diary.length+')</h2><table><tr><th>Time</th><th>Installer</th><th>Entry</th><th>AI</th><th>Photos</th><th>Video</th></tr>'+dRows+'</table><h2>QA ('+data.qa.length+')</h2><table><tr><th>Time</th><th>Installer</th><th>Item</th><th>Result</th><th>Note</th></tr>'+qRows+'</table><p style="color:#888;font-size:11px;margin-top:40px">Vantro - getvantro.com | CNNCTD Ltd (NI695071) | Ref: '+ref+'</p></body></html>'
  }

"""
content = content.replace('  function exportHTML() {', inject + '  function exportHTML() {', 1)

open('components/admin/AuditTab.tsx', 'w', encoding='utf-8').write(content)
print('Done - ' + str(len(content)) + ' chars')