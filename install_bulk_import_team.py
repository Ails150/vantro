"""
install_bulk_import_team.py
Run from C:\\vantro:    python install_bulk_import_team.py

Adds bulk-import-installers-via-CSV to the admin Team tab.

Installs:
  - app/api/admin/team/bulk-import/route.ts  (POST endpoint)

Patches:
  - components/admin/AdminDashboard.tsx
    + state for CSV import modal
    + "Import CSV" button next to "+ Add member"
    + CSV import modal with file picker, preview, and results
    + bulkImport() handler

CSV format:
  name,email,role
  Pete Walker,pete@example.com,installer
  Tom Burke,tom@example.com,foreman

Idempotent.
"""
import base64, os, sys

API_PATH = os.path.join("app", "api", "admin", "team", "bulk-import", "route.ts")
DASHBOARD = os.path.join("components", "admin", "AdminDashboard.tsx")

API_B64 = "aW1wb3J0IHsgTmV4dFJlc3BvbnNlIH0gZnJvbSAibmV4dC9zZXJ2ZXIiCmltcG9ydCB7IGNyZWF0ZUNsaWVudCwgY3JlYXRlU2VydmljZUNsaWVudCB9IGZyb20gIkAvbGliL3N1cGFiYXNlL3NlcnZlciIKCi8vIEJ1bGsgaW1wb3J0IGluc3RhbGxlcnMvZm9yZW1lbiB2aWEgQ1NWLgovLyAgIFBPU1QgL2FwaS9hZG1pbi90ZWFtL2J1bGstaW1wb3J0Ci8vICAgYm9keTogeyByb3dzOiBbeyBuYW1lOiBzdHJpbmcsIGVtYWlsOiBzdHJpbmcsIHJvbGU6ICJpbnN0YWxsZXIiIHwgImZvcmVtYW4iIH1dIH0KLy8KLy8gUmV0dXJucyBwZXItcm93IHJlc3VsdHMgc28gdGhlIFVJIGNhbiBzaG93IHdoaWNoIHN1Y2NlZWRlZCBhbmQgd2hpY2ggZGlkbid0LgoKY29uc3QgVkFMSURfUk9MRVMgPSBbImluc3RhbGxlciIsICJmb3JlbWFuIl0gYXMgY29uc3QKCmludGVyZmFjZSBDc3ZSb3cgewogIG5hbWU6IHN0cmluZwogIGVtYWlsOiBzdHJpbmcKICByb2xlOiBzdHJpbmcKfQoKaW50ZXJmYWNlIFJvd1Jlc3VsdCB7CiAgcm93OiBudW1iZXIKICBuYW1lOiBzdHJpbmcKICBlbWFpbDogc3RyaW5nCiAgc3RhdHVzOiAiY3JlYXRlZCIgfCAic2tpcHBlZCIgfCAiZXJyb3IiCiAgbWVzc2FnZT86IHN0cmluZwp9CgpleHBvcnQgYXN5bmMgZnVuY3Rpb24gUE9TVChyZXF1ZXN0OiBSZXF1ZXN0KSB7CiAgY29uc3Qgc3VwYWJhc2UgPSBhd2FpdCBjcmVhdGVDbGllbnQoKQogIGNvbnN0IHsgZGF0YTogeyB1c2VyIH0gfSA9IGF3YWl0IHN1cGFiYXNlLmF1dGguZ2V0VXNlcigpCiAgaWYgKCF1c2VyKSByZXR1cm4gTmV4dFJlc3BvbnNlLmpzb24oeyBlcnJvcjogIlVuYXV0aG9yaXplZCIgfSwgeyBzdGF0dXM6IDQwMSB9KQoKICBjb25zdCBzZXJ2aWNlID0gYXdhaXQgY3JlYXRlU2VydmljZUNsaWVudCgpCiAgY29uc3QgeyBkYXRhOiBhZG1pbiB9ID0gYXdhaXQgc2VydmljZQogICAgLmZyb20oInVzZXJzIikKICAgIC5zZWxlY3QoImlkLCBjb21wYW55X2lkLCByb2xlIikKICAgIC5lcSgiYXV0aF91c2VyX2lkIiwgdXNlci5pZCkKICAgIC5zaW5nbGUoKQogIGlmICghYWRtaW4gfHwgYWRtaW4ucm9sZSAhPT0gImFkbWluIikgewogICAgcmV0dXJuIE5leHRSZXNwb25zZS5qc29uKHsgZXJyb3I6ICJGb3JiaWRkZW4iIH0sIHsgc3RhdHVzOiA0MDMgfSkKICB9CgogIGxldCBib2R5OiB7IHJvd3M/OiBDc3ZSb3dbXSB9CiAgdHJ5IHsKICAgIGJvZHkgPSBhd2FpdCByZXF1ZXN0Lmpzb24oKQogIH0gY2F0Y2ggewogICAgcmV0dXJuIE5leHRSZXNwb25zZS5qc29uKHsgZXJyb3I6ICJJbnZhbGlkIEpTT04iIH0sIHsgc3RhdHVzOiA0MDAgfSkKICB9CgogIGNvbnN0IHJvd3MgPSBib2R5LnJvd3MKICBpZiAoIUFycmF5LmlzQXJyYXkocm93cykgfHwgcm93cy5sZW5ndGggPT09IDApIHsKICAgIHJldHVybiBOZXh0UmVzcG9uc2UuanNvbih7IGVycm9yOiAicm93cyBtdXN0IGJlIGEgbm9uLWVtcHR5IGFycmF5IiB9LCB7IHN0YXR1czogNDAwIH0pCiAgfQogIGlmIChyb3dzLmxlbmd0aCA+IDIwMCkgewogICAgcmV0dXJuIE5leHRSZXNwb25zZS5qc29uKHsgZXJyb3I6ICJNYXggMjAwIHJvd3MgcGVyIGltcG9ydCIgfSwgeyBzdGF0dXM6IDQwMCB9KQogIH0KCiAgLy8gUHJlLWNoZWNrIGluc3RhbGxlciBsaW1pdCBpZiBzZXQKICBjb25zdCB7IGRhdGE6IGNvbXBhbnkgfSA9IGF3YWl0IHNlcnZpY2UKICAgIC5mcm9tKCJjb21wYW5pZXMiKQogICAgLnNlbGVjdCgiaW5zdGFsbGVyX2xpbWl0IikKICAgIC5lcSgiaWQiLCBhZG1pbi5jb21wYW55X2lkKQogICAgLnNpbmdsZSgpCgogIGlmIChjb21wYW55Py5pbnN0YWxsZXJfbGltaXQpIHsKICAgIGNvbnN0IHsgY291bnQ6IGN1cnJlbnRDb3VudCB9ID0gYXdhaXQgc2VydmljZQogICAgICAuZnJvbSgidXNlcnMiKQogICAgICAuc2VsZWN0KCIqIiwgeyBjb3VudDogImV4YWN0IiwgaGVhZDogdHJ1ZSB9KQogICAgICAuZXEoImNvbXBhbnlfaWQiLCBhZG1pbi5jb21wYW55X2lkKQogICAgICAuaW4oInJvbGUiLCBbImluc3RhbGxlciIsICJmb3JlbWFuIl0pCiAgICBpZiAoY3VycmVudENvdW50ICE9PSBudWxsICYmIGN1cnJlbnRDb3VudCArIHJvd3MubGVuZ3RoID4gY29tcGFueS5pbnN0YWxsZXJfbGltaXQpIHsKICAgICAgcmV0dXJuIE5leHRSZXNwb25zZS5qc29uKAogICAgICAgIHsgZXJyb3I6IGBJbXBvcnRpbmcgJHtyb3dzLmxlbmd0aH0gd291bGQgZXhjZWVkIHlvdXIgaW5zdGFsbGVyIGxpbWl0IG9mICR7Y29tcGFueS5pbnN0YWxsZXJfbGltaXR9LiBZb3UgY3VycmVudGx5IGhhdmUgJHtjdXJyZW50Q291bnR9LmAgfSwKICAgICAgICB7IHN0YXR1czogNDAwIH0KICAgICAgKQogICAgfQogIH0KCiAgLy8gR2V0IGV4aXN0aW5nIGVtYWlscyBpbiB0aGlzIGNvbXBhbnkgdG8gZGV0ZWN0IGR1cGxpY2F0ZXMKICBjb25zdCBpbmNvbWluZ0VtYWlscyA9IHJvd3MKICAgIC5tYXAoKHIpID0+IChyPy5lbWFpbCB8fCAiIikudHJpbSgpLnRvTG93ZXJDYXNlKCkpCiAgICAuZmlsdGVyKChlKSA9PiBlLmxlbmd0aCA+IDApCiAgY29uc3QgeyBkYXRhOiBleGlzdGluZyB9ID0gYXdhaXQgc2VydmljZQogICAgLmZyb20oInVzZXJzIikKICAgIC5zZWxlY3QoImVtYWlsIikKICAgIC5lcSgiY29tcGFueV9pZCIsIGFkbWluLmNvbXBhbnlfaWQpCiAgICAuaW4oImVtYWlsIiwgaW5jb21pbmdFbWFpbHMpCiAgY29uc3QgZXhpc3RpbmdTZXQgPSBuZXcgU2V0KChleGlzdGluZyB8fCBbXSkubWFwKCh1KSA9PiAodS5lbWFpbCB8fCAiIikudG9Mb3dlckNhc2UoKSkpCgogIGNvbnN0IHJlc3VsdHM6IFJvd1Jlc3VsdFtdID0gW10KICBjb25zdCB0b0luc2VydDogYW55W10gPSBbXQoKICBmb3IgKGxldCBpID0gMDsgaSA8IHJvd3MubGVuZ3RoOyBpKyspIHsKICAgIGNvbnN0IHIgPSByb3dzW2ldCiAgICBjb25zdCByb3dOdW0gPSBpICsgMQogICAgY29uc3QgbmFtZSA9IChyPy5uYW1lIHx8ICIiKS50cmltKCkKICAgIGNvbnN0IGVtYWlsID0gKHI/LmVtYWlsIHx8ICIiKS50cmltKCkudG9Mb3dlckNhc2UoKQogICAgY29uc3Qgcm9sZSA9IChyPy5yb2xlIHx8ICJpbnN0YWxsZXIiKS50cmltKCkudG9Mb3dlckNhc2UoKQoKICAgIGlmICghbmFtZSkgewogICAgICByZXN1bHRzLnB1c2goeyByb3c6IHJvd051bSwgbmFtZTogIiIsIGVtYWlsLCBzdGF0dXM6ICJlcnJvciIsIG1lc3NhZ2U6ICJNaXNzaW5nIG5hbWUiIH0pCiAgICAgIGNvbnRpbnVlCiAgICB9CiAgICBpZiAoIWVtYWlsKSB7CiAgICAgIHJlc3VsdHMucHVzaCh7IHJvdzogcm93TnVtLCBuYW1lLCBlbWFpbDogIiIsIHN0YXR1czogImVycm9yIiwgbWVzc2FnZTogIk1pc3NpbmcgZW1haWwiIH0pCiAgICAgIGNvbnRpbnVlCiAgICB9CiAgICBpZiAoIS9eXFMrQFxTK1wuXFMrJC8udGVzdChlbWFpbCkpIHsKICAgICAgcmVzdWx0cy5wdXNoKHsgcm93OiByb3dOdW0sIG5hbWUsIGVtYWlsLCBzdGF0dXM6ICJlcnJvciIsIG1lc3NhZ2U6ICJJbnZhbGlkIGVtYWlsIiB9KQogICAgICBjb250aW51ZQogICAgfQogICAgaWYgKCFWQUxJRF9ST0xFUy5pbmNsdWRlcyhyb2xlIGFzIGFueSkpIHsKICAgICAgcmVzdWx0cy5wdXNoKHsgcm93OiByb3dOdW0sIG5hbWUsIGVtYWlsLCBzdGF0dXM6ICJlcnJvciIsIG1lc3NhZ2U6IGBSb2xlIG11c3QgYmUgb25lIG9mOiAke1ZBTElEX1JPTEVTLmpvaW4oIiwgIil9YCB9KQogICAgICBjb250aW51ZQogICAgfQogICAgaWYgKGV4aXN0aW5nU2V0LmhhcyhlbWFpbCkpIHsKICAgICAgcmVzdWx0cy5wdXNoKHsgcm93OiByb3dOdW0sIG5hbWUsIGVtYWlsLCBzdGF0dXM6ICJza2lwcGVkIiwgbWVzc2FnZTogIkVtYWlsIGFscmVhZHkgZXhpc3RzIiB9KQogICAgICBjb250aW51ZQogICAgfQoKICAgIGNvbnN0IGluaXRpYWxzID0gbmFtZQogICAgICAuc3BsaXQoL1xzKy8pCiAgICAgIC5tYXAoKG4pID0+IG5bMF0gfHwgIiIpCiAgICAgIC5qb2luKCIiKQogICAgICAudG9VcHBlckNhc2UoKQogICAgICAuc2xpY2UoMCwgMikKCiAgICB0b0luc2VydC5wdXNoKHsKICAgICAgY29tcGFueV9pZDogYWRtaW4uY29tcGFueV9pZCwKICAgICAgbmFtZSwKICAgICAgZW1haWwsCiAgICAgIGluaXRpYWxzLAogICAgICByb2xlLAogICAgICBpc19hY3RpdmU6IHRydWUsCiAgICB9KQogICAgcmVzdWx0cy5wdXNoKHsgcm93OiByb3dOdW0sIG5hbWUsIGVtYWlsLCBzdGF0dXM6ICJjcmVhdGVkIiB9KQogICAgZXhpc3RpbmdTZXQuYWRkKGVtYWlsKSAvLyBwcmV2ZW50IGR1cGxpY2F0ZSB3aXRoaW4gdGhlIHNhbWUgaW1wb3J0CiAgfQoKICBpZiAodG9JbnNlcnQubGVuZ3RoID4gMCkgewogICAgY29uc3QgeyBlcnJvcjogaW5zZXJ0RXJyb3IgfSA9IGF3YWl0IHNlcnZpY2UuZnJvbSgidXNlcnMiKS5pbnNlcnQodG9JbnNlcnQpCiAgICBpZiAoaW5zZXJ0RXJyb3IpIHsKICAgICAgLy8gSWYgYmF0Y2ggaW5zZXJ0IGZhaWxzLCBtYXJrIGFsbCBjcmVhdGVkIGVudHJpZXMgYXMgZXJyb3JzCiAgICAgIGZvciAoY29uc3QgciBvZiByZXN1bHRzKSB7CiAgICAgICAgaWYgKHIuc3RhdHVzID09PSAiY3JlYXRlZCIpIHsKICAgICAgICAgIHIuc3RhdHVzID0gImVycm9yIgogICAgICAgICAgci5tZXNzYWdlID0gaW5zZXJ0RXJyb3IubWVzc2FnZQogICAgICAgIH0KICAgICAgfQogICAgICByZXR1cm4gTmV4dFJlc3BvbnNlLmpzb24oeyByZXN1bHRzLCBzdW1tYXJ5OiBzdW1tYXJpc2UocmVzdWx0cykgfSwgeyBzdGF0dXM6IDUwMCB9KQogICAgfQogIH0KCiAgcmV0dXJuIE5leHRSZXNwb25zZS5qc29uKHsgcmVzdWx0cywgc3VtbWFyeTogc3VtbWFyaXNlKHJlc3VsdHMpIH0pCn0KCmZ1bmN0aW9uIHN1bW1hcmlzZShyZXN1bHRzOiBSb3dSZXN1bHRbXSkgewogIHJldHVybiB7CiAgICB0b3RhbDogcmVzdWx0cy5sZW5ndGgsCiAgICBjcmVhdGVkOiByZXN1bHRzLmZpbHRlcigocikgPT4gci5zdGF0dXMgPT09ICJjcmVhdGVkIikubGVuZ3RoLAogICAgc2tpcHBlZDogcmVzdWx0cy5maWx0ZXIoKHIpID0+IHIuc3RhdHVzID09PSAic2tpcHBlZCIpLmxlbmd0aCwKICAgIGVycm9yZWQ6IHJlc3VsdHMuZmlsdGVyKChyKSA9PiByLnN0YXR1cyA9PT0gImVycm9yIikubGVuZ3RoLAogIH0KfQo="


def write_api():
    full = os.path.join(os.getcwd(), API_PATH)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    contents = base64.b64decode(API_B64).decode("utf-8")
    with open(full, "w", encoding="utf-8", newline="\n") as f:
        f.write(contents)
    print(f"  wrote: {API_PATH}  ({len(contents)} bytes)")


def patch_dashboard():
    if not os.path.exists(DASHBOARD):
        print(f"  ERROR: {DASHBOARD} not found")
        sys.exit(1)
    with open(DASHBOARD, "r", encoding="utf-8") as f:
        src = f.read()

    if "csv_import_v1" in src:
        print(f"  AdminDashboard already patched")
        return

    # 1. Add state declarations near showAddMember
    old_state = '  const [showAddMember, setShowAddMember] = useState(false)'
    new_state = """  const [showAddMember, setShowAddMember] = useState(false)
  // csv_import_v1
  const [showCsvImport, setShowCsvImport] = useState(false)
  const [csvRows, setCsvRows] = useState<Array<{name:string; email:string; role:string}>>([])
  const [csvError, setCsvError] = useState<string>("")
  const [csvImporting, setCsvImporting] = useState(false)
  const [csvResults, setCsvResults] = useState<any>(null)"""
    if old_state not in src:
        print("  ERROR: showAddMember state anchor not found")
        sys.exit(1)
    src = src.replace(old_state, new_state)

    # 2. Add bulkImport handler near addMember (insert before async function addMember)
    old_addmember = "  async function addMember() {"
    new_addmember = """  // csv_import_v1
  function parseCsvText(text: string): Array<{name:string; email:string; role:string}> {
    const lines = text.replace(/\r/g, "").split("\n").map(l => l.trim()).filter(l => l.length > 0)
    if (lines.length === 0) return []
    // Detect header
    let startIdx = 0
    const first = lines[0].toLowerCase()
    if (first.includes("name") && first.includes("email")) {
      startIdx = 1
    }
    const rows: Array<{name:string; email:string; role:string}> = []
    for (let i = startIdx; i < lines.length; i++) {
      const cols = lines[i].split(",").map(c => c.trim().replace(/^"|"$/g, ""))
      if (cols.length < 2) continue
      const [name, email, role] = cols
      rows.push({ name: name || "", email: email || "", role: role || "installer" })
    }
    return rows
  }
  async function handleCsvFile(file: File) {
    setCsvError("")
    setCsvResults(null)
    if (!file.name.toLowerCase().endsWith(".csv") && file.type !== "text/csv") {
      setCsvError("Please choose a .csv file")
      return
    }
    try {
      const text = await file.text()
      const rows = parseCsvText(text)
      if (rows.length === 0) {
        setCsvError("No rows found in file")
        return
      }
      if (rows.length > 200) {
        setCsvError("Max 200 rows per import. Split your file.")
        return
      }
      setCsvRows(rows)
    } catch (err: any) {
      setCsvError(err?.message || "Could not read file")
    }
  }
  async function bulkImport() {
    if (csvRows.length === 0) return
    setCsvImporting(true)
    setCsvResults(null)
    try {
      const res = await fetch("/api/admin/team/bulk-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: csvRows }),
      })
      const data = await res.json()
      if (!res.ok) {
        setCsvError(data.error || "Import failed")
        setCsvResults(data.results ? data : null)
        setCsvImporting(false)
        return
      }
      setCsvResults(data)
      // Send invites for created rows
      const created = (data.results || []).filter((r: any) => r.status === "created")
      for (const c of created) {
        try {
          await fetch("/api/invite", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: c.email, name: c.name, role: csvRows.find(r => r.email.toLowerCase() === c.email)?.role || "installer" }),
          })
        } catch {}
      }
      router.refresh()
    } catch (err: any) {
      setCsvError(err?.message || "Import failed")
    }
    setCsvImporting(false)
  }
  function downloadSampleCsv() {
    const sample = "name,email,role\nPete Walker,pete@example.com,installer\nTom Burke,tom@example.com,foreman\n"
    const blob = new Blob([sample], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "vantro-team-template.csv"
    a.click()
    URL.revokeObjectURL(url)
  }
  function resetCsvImport() {
    setShowCsvImport(false)
    setCsvRows([])
    setCsvError("")
    setCsvResults(null)
  }

  async function addMember() {"""

    if old_addmember not in src:
        print("  ERROR: addMember anchor not found")
        sys.exit(1)
    src = src.replace(old_addmember, new_addmember)

    # 3. Add Import CSV button next to + Add member, and the modal below
    old_button_row = '            <div className="flex justify-end"><button onClick={() => { setShowAddMember(true); setFormError("") }} className={btn}>+ Add member</button></div>'
    new_button_row = """            {/* csv_import_v1 */}
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowCsvImport(true)} className={btnGhost}>Import CSV</button>
              <button onClick={() => { setShowAddMember(true); setFormError("") }} className={btn}>+ Add member</button>
            </div>
            {showCsvImport && (
              <div className="bg-white border border-teal-200 rounded-2xl p-6 space-y-4 shadow-sm">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold">Import team from CSV</h3>
                    <p className="text-sm text-gray-500">Upload a CSV with columns: name, email, role. Existing emails are skipped.</p>
                  </div>
                  <button onClick={downloadSampleCsv} className="text-sm text-teal-600 hover:underline">Download template</button>
                </div>
                {!csvResults && csvRows.length === 0 && (
                  <div>
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) handleCsvFile(f) }}
                      className="block w-full text-sm border border-gray-200 rounded-md p-3"
                    />
                    {csvError && <p className="text-sm text-red-600 mt-2">{csvError}</p>}
                  </div>
                )}
                {!csvResults && csvRows.length > 0 && (
                  <div>
                    <p className="text-sm text-gray-600 mb-2">{csvRows.length} row(s) ready to import:</p>
                    <div className="border border-gray-200 rounded-md max-h-64 overflow-y-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 text-xs text-gray-500">
                          <tr>
                            <th className="px-3 py-2 text-left">Name</th>
                            <th className="px-3 py-2 text-left">Email</th>
                            <th className="px-3 py-2 text-left">Role</th>
                          </tr>
                        </thead>
                        <tbody>
                          {csvRows.map((r, i) => (
                            <tr key={i} className="border-t border-gray-100">
                              <td className="px-3 py-2">{r.name}</td>
                              <td className="px-3 py-2">{r.email}</td>
                              <td className="px-3 py-2">{r.role}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {csvError && <p className="text-sm text-red-600 mt-2">{csvError}</p>}
                    <div className="flex gap-3 mt-4">
                      <button onClick={bulkImport} disabled={csvImporting} className={btn}>
                        {csvImporting ? "Importing..." : `Import ${csvRows.length} member(s)`}
                      </button>
                      <button onClick={() => setCsvRows([])} className={btnGhost}>Choose different file</button>
                      <button onClick={resetCsvImport} className={btnGhost}>Cancel</button>
                    </div>
                  </div>
                )}
                {csvResults && (
                  <div>
                    <div className="flex gap-4 mb-3 text-sm">
                      <span className="text-teal-600">Created: {csvResults.summary?.created || 0}</span>
                      <span className="text-gray-500">Skipped: {csvResults.summary?.skipped || 0}</span>
                      <span className="text-red-600">Errors: {csvResults.summary?.errored || 0}</span>
                    </div>
                    <div className="border border-gray-200 rounded-md max-h-64 overflow-y-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 text-xs text-gray-500">
                          <tr>
                            <th className="px-3 py-2 text-left">Row</th>
                            <th className="px-3 py-2 text-left">Name</th>
                            <th className="px-3 py-2 text-left">Email</th>
                            <th className="px-3 py-2 text-left">Status</th>
                            <th className="px-3 py-2 text-left">Detail</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(csvResults.results || []).map((r: any, i: number) => (
                            <tr key={i} className="border-t border-gray-100">
                              <td className="px-3 py-2">{r.row}</td>
                              <td className="px-3 py-2">{r.name}</td>
                              <td className="px-3 py-2">{r.email}</td>
                              <td className={"px-3 py-2 " + (r.status === "created" ? "text-teal-600" : r.status === "skipped" ? "text-gray-500" : "text-red-600")}>{r.status}</td>
                              <td className="px-3 py-2 text-gray-500">{r.message || ""}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="flex gap-3 mt-4">
                      <button onClick={resetCsvImport} className={btn}>Done</button>
                    </div>
                  </div>
                )}
              </div>
            )}"""

    if old_button_row not in src:
        print("  ERROR: + Add member button row anchor not found")
        sys.exit(1)
    src = src.replace(old_button_row, new_button_row)

    with open(DASHBOARD, "w", encoding="utf-8", newline="\n") as f:
        f.write(src)
    print(f"  PATCHED: {DASHBOARD}")


def main():
    cwd = os.getcwd()
    if not cwd.lower().endswith("vantro"):
        print(f"WARNING: cwd is {cwd}")
        print("Run from C:\\vantro. Continue? (y/n)")
        if input().strip().lower() != "y":
            sys.exit(1)

    write_api()
    patch_dashboard()
    print()
    print("Done. Test: Team tab -> Import CSV -> upload file -> Import.")


if __name__ == "__main__":
    main()
