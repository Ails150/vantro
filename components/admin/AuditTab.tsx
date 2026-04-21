import { useState } from "react"

export default function AuditTab({ jobs }: { jobs: any[] }) {
  const [selectedJob, setSelectedJob] = useState("")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [loading, setLoading] = useState(false)
  const [preview, setPreview] = useState<any>(null)

  async function generate() {
    if (!selectedJob) return
    setLoading(true)
    setPreview(null)
    const params = new URLSearchParams({ jobId: selectedJob })
    if (from) params.append('from', from)
    if (to) params.append('to', to)
    const res = await fetch('/api/audit?' + params.toString())
    if (res.ok) {
      const data = await res.json()
      setPreview(data)
    }
    setLoading(false)
  }

  async function emailReport() {
    if (!preview) return
    const email = window.prompt('Send audit report to email address:')
    if (!email) return
    const html = generateHTML(preview)
    const blob = new Blob([html], { type: 'text/html' })
    const fd = new FormData()
    fd.append('file', blob, 'report.html')
    fd.append('to', email)
    fd.append('jobName', preview.job.name)
    fd.append('reportRef', 'VTR-' + preview.job.name.replace(/\s+/g,'').toUpperCase().slice(0,8) + '-' + Date.now())
    await fetch('/api/audit/email', { method: 'POST', body: fd })
    alert('Report sent to ' + email)
  }

  function generateHTML(data: any) {
    const job = data.job
    const ref = 'VTR-' + job.name.replace(/\s+/g,'').toUpperCase().slice(0,8) + '-' + Date.now()
    const sRows = data.signins.map((s: any) => { const i=new Date(s.signed_in_at),o=s.signed_out_at?new Date(s.signed_out_at):null,h=o?((o.getTime()-i.getTime())/3600000).toFixed(1):'-'; return '<tr><td>'+(s.users?.name||'?')+'</td><td>'+i.toLocaleString('en-GB')+'</td><td>'+(o?o.toLocaleString('en-GB'):'NOT SIGNED OUT')+'</td><td>'+(s.distance_metres??'-')+'m</td><td>'+h+'</td></tr>' }).join('')
    const dRows = data.diary.map((e: any) => { const p=e.photo_urls?.length>0?e.photo_urls.map((u:string)=>'<img src="'+u+'" style="max-width:80px">').join(''): '-'; const v=e.video_url?'<a href="'+e.video_url+'" target="_blank">Play</a>':'-'; return '<tr><td>'+new Date(e.created_at).toLocaleString('en-GB')+'</td><td>'+(e.users?.name||'?')+'</td><td>'+(e.entry_text||'')+'</td><td>'+(e.ai_summary||'-')+'</td><td>'+p+'</td><td>'+v+'</td></tr>' }).join('')
    const qRows = data.qa.map((q: any) => '<tr><td>'+new Date(q.created_at).toLocaleString('en-GB')+'</td><td>'+(q.users?.name||'?')+'</td><td>'+(q.checklist_items?.label||'-')+'</td><td>'+(q.result?.toUpperCase()||'-')+'</td><td>'+(q.note||'-')+'</td></tr>').join('')
    const bRows = (data.breadcrumbs||[]).map((b: any) => '<tr><td>'+new Date(b.recorded_at).toLocaleString('en-GB')+'</td><td>'+(b.users?.name||'?')+'</td><td>'+b.lat+'</td><td>'+b.lng+'</td><td>'+(b.accuracy??'-')+'m</td></tr>').join('')
    const css = '<style>body{font-family:Arial,sans-serif;max-width:900px;margin:40px auto;color:#1a1a2e}h1{color:#00a87a}h2{margin-top:28px;border-bottom:1px solid #eee}table{width:100%;border-collapse:collapse;margin:12px 0}th{background:#f3e8ff;padding:8px;text-align:left;font-size:12px}td{padding:8px;border-bottom:1px solid #eee;font-size:12px;vertical-align:top}</style>'
    return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Vantro Audit</title>'+css+'</head><body><h1>Vantro Audit Report</h1><p><b>Ref:</b> '+ref+'<br><b>Job:</b> '+job.name+'<br><b>Address:</b> '+job.address+'<br><b>Period:</b> '+(data.period.from||'All')+' to '+(data.period.to||'now')+'<br><b>Generated:</b> '+new Date(data.generated).toLocaleString('en-GB')+'</p><h2>Attendance ('+data.signins.length+')</h2><table><tr><th>Installer</th><th>In</th><th>Out</th><th>Dist In</th><th>Hours</th></tr>'+sRows+'</table><h2>GPS Trail ('+(data.breadcrumbs?.length||0)+')</h2><table><tr><th>Time</th><th>Installer</th><th>Lat</th><th>Lng</th><th>Accuracy</th></tr>'+bRows+'</table><h2>Diary ('+data.diary.length+')</h2><table><tr><th>Time</th><th>Installer</th><th>Entry</th><th>AI</th><th>Photos</th><th>Video</th></tr>'+dRows+'</table><h2>QA ('+data.qa.length+')</h2><table><tr><th>Time</th><th>Installer</th><th>Item</th><th>Result</th><th>Note</th></tr>'+qRows+'</table><p style="color:#888;font-size:11px;margin-top:40px">Vantro - getvantro.com | CNNCTD Ltd (NI695071) | Ref: '+ref+'</p></body></html>'
  }

  function exportHTML() {
    if (!preview) return
    const job = preview.job
    const refId = "VTR-" + job.name.replace(/\s+/g, "").toUpperCase().slice(0,8) + "-" + (preview.period.from || "ALL").replace(/-/g,"") + "-" + (preview.period.to || "NOW").replace(/-/g,"") + "-" + Date.now()
    const rows = (entries: any[]) => entries.length === 0 ? '<p style="color:#888">None recorded</p>' : ''

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Vantro Audit Report — ${job.name}</title>
<style>
  body { font-family: Arial, sans-serif; max-width: 900px; margin: 40px auto; color: #1a1a2e; }
  h1 { color: #00a87a; border-bottom: 2px solid #00a87a; padding-bottom: 8px; }
  h2 { color: #1a1a2e; margin-top: 32px; border-bottom: 1px solid #eee; padding-bottom: 6px; }
  .meta { color: #666; font-size: 13px; margin-bottom: 24px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  th { background: #f3e8ff; padding: 8px 12px; text-align: left; font-size: 13px; }
  td { padding: 8px 12px; border-bottom: 1px solid #eee; font-size: 13px; vertical-align: top; }
  .blocker { color: #dc2626; font-weight: 700; }
  .issue { color: #d97706; font-weight: 700; }
  .pass { color: #059669; }
  .fail { color: #dc2626; }
  img { max-width: 120px; border-radius: 6px; margin: 2px; }
  .footer { margin-top: 48px; color: #888; font-size: 12px; border-top: 1px solid #eee; padding-top: 12px; }
</style>
</head>
<body>
<h1>Vantro Audit Report</h1>
<div class="meta">
  <strong>Job:</strong> ${job.name}<br>
  <strong>Address:</strong> ${job.address}<br>
  <strong>Period:</strong> ${preview.period.from || 'All time'} to ${preview.period.to || 'now'}<br>
  <strong>Generated:</strong> ${new Date(preview.generated).toLocaleString('en-GB')}<br>
  <strong>Report Reference:</strong> ${refId}<br>\n  <strong>Report produced by:</strong> Vantro — getvantro.com
</div>

<h2>Attendance & GPS Sign-ins (${preview.signins.length} records)</h2>
${preview.signins.length === 0 ? '<p style="color:#888">No sign-ins recorded in this period</p>' : `
<table>
<tr><th>Installer</th><th>Signed In</th><th>Signed Out</th><th>Distance In</th><th>Distance Out</th><th>Hours</th></tr>
${preview.signins.map((s: any) => {
  const inTime = new Date(s.signed_in_at)
  const outTime = s.signed_out_at ? new Date(s.signed_out_at) : null
  const hours = outTime ? ((outTime.getTime() - inTime.getTime()) / 3600000).toFixed(1) : '—'
  return `<tr>
    <td>${s.users?.name || 'Unknown'}</td>
    <td>${inTime.toLocaleString('en-GB')}</td>
    <td>${outTime ? outTime.toLocaleString('en-GB') : '<span style="color:#dc2626">Not signed out</span>'}</td>
    <td>${s.distance_metres ?? '—'}m</td>
    <td>${s.sign_out_distance_metres ?? '—'}m</td>
    <td>${hours}</td>
  </tr>`
}).join('')}
</table>`}

<h2>Site Diary (${preview.diary.length} entries)</h2>
${preview.diary.length === 0 ? '<p style="color:#888">No diary entries in this period</p>' : `
<table>
<tr><th>Time</th><th>Installer</th><th>Entry</th><th>AI Classification</th><th>Photos</th><th>Video</th></tr>
${preview.diary.map((e: any) => `<tr>
  <td>${new Date(e.created_at).toLocaleString('en-GB')}</td>
  <td>${e.users?.name || 'Unknown'}</td>
  <td>${e.entry_text || ''}</td>
  <td class="${e.ai_alert_type}">${e.ai_alert_type !== 'none' ? (e.ai_summary || e.ai_alert_type) : '—'}</td>
  <td>${e.photo_urls && e.photo_urls.length > 0 ? e.photo_urls.map((u: string) => `<img src="${u}">`).join('') : '—'}</td>
</tr>`).join('')}
</table>`}

<h2>QA Checklists (${preview.qa.length} responses)</h2>
${preview.qa.length === 0 ? '<p style="color:#888">No QA responses in this period</p>' : `
<table>
<tr><th>Time</th><th>Installer</th><th>Item</th><th>Result</th><th>Note</th><th>Photo</th></tr>
${preview.qa.map((q: any) => `<tr>
  <td>${new Date(q.created_at).toLocaleString('en-GB')}</td>
  <td>${q.users?.name || 'Unknown'}</td>
  <td>${q.checklist_items?.label || '—'}</td>
  <td class="${q.result === 'pass' ? 'pass' : 'fail'}">${q.result?.toUpperCase() || '—'}</td>
  <td>${q.note || '—'}</td>
  <td>${q.photo_url ? `<img src="${q.photo_url}">` : '—'}</td>
</tr>`).join('')}
</table>`}

<div class="footer">
  This report was generated by Vantro field operations software (getvantro.com).<br>
  All timestamps are in local time. GPS distances are measured from the registered job site address.<br>
  CNNCTD Ltd — Vantro is a product of CNNCTD Ltd (NI695071)
</div>
</body>
</html>`

    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `Vantro-Audit-${job.name.replace(/\s+/g, '-')}-${new Date().toISOString().slice(0,10)}.html`
    a.click()
    URL.revokeObjectURL(url)
  }

  const selectedJobName = jobs.find(j => j.id === selectedJob)?.name || ''

  return (
    <div style={{ padding: 24, maxWidth: 700 }}>
      <h2 style={{ color: '#fff', fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Audit & Dispute Report</h2>
      <p style={{ color: '#4d6478', fontSize: 14, marginBottom: 24 }}>Generate a full evidence pack for any job — diary entries, photos, GPS sign-ins, QA responses.</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
        <div>
          <label style={{ color: '#4d6478', fontSize: 12, fontWeight: 600 }}>JOB</label>
          <select value={selectedJob} onChange={e => setSelectedJob(e.target.value)}
            style={{ display: 'block', width: '100%', marginTop: 4, padding: '10px 12px', background: '#1a2635', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, color: '#fff', fontSize: 14 }}>
            <option value="">Select a job...</option>
            {jobs.map((j: any) => <option key={j.id} value={j.id}>{j.name}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label style={{ color: '#4d6478', fontSize: 12, fontWeight: 600 }}>FROM DATE (optional)</label>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)}
              style={{ display: 'block', width: '100%', marginTop: 4, padding: '10px 12px', background: '#1a2635', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, color: '#fff', fontSize: 14, boxSizing: 'border-box' }} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ color: '#4d6478', fontSize: 12, fontWeight: 600 }}>TO DATE (optional)</label>
            <input type="date" value={to} onChange={e => setTo(e.target.value)}
              style={{ display: 'block', width: '100%', marginTop: 4, padding: '10px 12px', background: '#1a2635', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, color: '#fff', fontSize: 14, boxSizing: 'border-box' }} />
          </div>
        </div>
        <button onClick={generate} disabled={!selectedJob || loading}
          style={{ padding: '12px 24px', background: selectedJob ? '#00d4a0' : '#1a2635', color: selectedJob ? '#0f1923' : '#4d6478', border: 'none', borderRadius: 12, fontWeight: 700, fontSize: 15, cursor: selectedJob ? 'pointer' : 'not-allowed' }}>
          {loading ? 'Generating...' : 'Generate Report'}
        </button>
      </div>

      {preview && (
        <div style={{ background: '#1a2635', borderRadius: 16, padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div>
              <div style={{ color: '#fff', fontWeight: 700, fontSize: 16 }}>{preview.job.name}</div>
              <div style={{ color: '#4d6478', fontSize: 13 }}>{preview.job.address}</div>
            </div>
            <button onClick={exportHTML}
              style={{ padding: '10px 20px', background: '#00d4a0', color: '#0f1923', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
              ⬇ Download Report</button>
            <button onClick={emailReport}
              style={{ padding: '10px 20px', background: '#1a2635', color: '#00d4a0', border: '1px solid #00d4a0', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
              ✉ Email Report
            </button>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {[
              { label: 'Sign-ins', value: preview.signins.length, color: '#00d4a0' },
              { label: 'Diary entries', value: preview.diary.length, color: '#00d4a0' },
              { label: 'Photos', value: preview.diary.reduce((n: number, e: any) => n + (e.photo_urls?.length || 0), 0), color: '#00d4a0' },
              { label: 'QA responses', value: preview.qa.length, color: '#00d4a0' },
              { label: 'GPS Points', value: preview.breadcrumbs?.length || 0, color: '#00d4a0' },
              { label: 'GPS Points', value: (preview.breadcrumbs?.length || 0), color: '#00d4a0' },
              { label: 'Blockers/Issues', value: preview.diary.filter((e: any) => e.ai_alert_type && e.ai_alert_type !== 'none').length, color: '#f87171' },
            ].map(stat => (
              <div key={stat.label} style={{ background: '#0f1923', borderRadius: 10, padding: '10px 16px', minWidth: 100 }}>
                <div style={{ color: stat.color, fontSize: 22, fontWeight: 700 }}>{stat.value}</div>
                <div style={{ color: '#4d6478', fontSize: 12 }}>{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}