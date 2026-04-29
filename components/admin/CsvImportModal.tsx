"use client"

import { useState, useRef } from "react"
import Papa from "papaparse"

export interface CsvField {
  key: string
  label: string
  required?: boolean
  example?: string
}

interface RowResult {
  row: number
  status: "created" | "skipped" | "error"
  message?: string
  [k: string]: any
}

interface Props {
  open: boolean
  onClose: () => void
  onSuccess?: (summary: { total: number; created: number; skipped: number; errored: number }) => void
  title: string                      // e.g. "Import jobs from CSV"
  endpoint: string                   // e.g. "/api/admin/jobs/bulk-import"
  fields: CsvField[]                 // expected columns
  templateFilename: string           // e.g. "vantro-jobs-template.csv"
  maxRows?: number                   // default 200
}

export default function CsvImportModal({
  open,
  onClose,
  onSuccess,
  title,
  endpoint,
  fields,
  templateFilename,
  maxRows = 200,
}: Props) {
  const [step, setStep] = useState<"upload" | "preview" | "result">("upload")
  const [rows, setRows] = useState<any[]>([])
  const [parseError, setParseError] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [results, setResults] = useState<RowResult[]>([])
  const [summary, setSummary] = useState<any>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  if (!open) return null

  const reset = () => {
    setStep("upload")
    setRows([])
    setParseError("")
    setResults([])
    setSummary(null)
    setSubmitting(false)
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  const downloadTemplate = () => {
    const headers = fields.map((f) => f.key)
    const example = fields.map((f) => f.example || "")
    const csv = headers.join(",") + "\n" + example.join(",") + "\n"
    const blob = new Blob([csv], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = templateFilename
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleFile = (file: File) => {
    setParseError("")
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (parsed) => {
        if (parsed.errors.length > 0) {
          setParseError("CSV parse error: " + parsed.errors[0].message)
          return
        }
        const data = parsed.data as any[]
        if (data.length === 0) {
          setParseError("CSV is empty")
          return
        }
        if (data.length > maxRows) {
          setParseError(`Max ${maxRows} rows per import. Your file has ${data.length}.`)
          return
        }
        // Validate required columns are present
        const firstRow = data[0]
        const missing = fields.filter((f) => f.required && !(f.key in firstRow)).map((f) => f.key)
        if (missing.length > 0) {
          setParseError(`Missing required columns: ${missing.join(", ")}`)
          return
        }
        setRows(data)
        setStep("preview")
      },
      error: (err) => setParseError("Could not read file: " + err.message),
    })
  }

  const handleSubmit = async () => {
    setSubmitting(true)
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      })
      const data = await res.json()
      if (!res.ok && !data.results) {
        setParseError(data.error || "Import failed")
        setSubmitting(false)
        return
      }
      setResults(data.results || [])
      setSummary(data.summary)
      setStep("result")
      if (onSuccess && data.summary) onSuccess(data.summary)
    } catch (err: any) {
      setParseError(err?.message || "Network error")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={handleClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {step === "upload" && (
            <div>
              <div className="mb-4">
                <button
                  onClick={downloadTemplate}
                  className="text-sm text-teal-600 hover:text-teal-700 underline"
                >
                  Download CSV template
                </button>
                <p className="text-xs text-gray-500 mt-1">
                  Required columns: {fields.filter((f) => f.required).map((f) => f.key).join(", ")}
                </p>
              </div>

              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setDragOver(false)
                  const file = e.dataTransfer.files[0]
                  if (file) handleFile(file)
                }}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors ${
                  dragOver ? "border-teal-500 bg-teal-50" : "border-gray-300 hover:border-teal-400"
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) handleFile(file)
                  }}
                  className="hidden"
                />
                <p className="text-gray-600 font-medium">Drop a CSV file here or click to browse</p>
                <p className="text-sm text-gray-400 mt-1">Max {maxRows} rows</p>
              </div>

              {parseError && (
                <p className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
                  {parseError}
                </p>
              )}
            </div>
          )}

          {step === "preview" && (
            <div>
              <p className="text-sm text-gray-600 mb-3">
                {rows.length} row{rows.length !== 1 ? "s" : ""} ready to import. Review below and click Confirm.
              </p>
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="overflow-x-auto max-h-96">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium text-gray-600 border-b">#</th>
                        {fields.map((f) => (
                          <th key={f.key} className="px-3 py-2 text-left font-medium text-gray-600 border-b">
                            {f.label}
                            {f.required && <span className="text-red-500 ml-0.5">*</span>}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, i) => (
                        <tr key={i} className="border-b border-gray-50">
                          <td className="px-3 py-2 text-gray-400">{i + 1}</td>
                          {fields.map((f) => (
                            <td key={f.key} className="px-3 py-2 text-gray-700 whitespace-nowrap">
                              {row[f.key] || <span className="text-gray-300">—</span>}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {parseError && (
                <p className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
                  {parseError}
                </p>
              )}
            </div>
          )}

          {step === "result" && summary && (
            <div>
              <div className="grid grid-cols-3 gap-3 mb-5">
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-green-700">{summary.created}</div>
                  <div className="text-xs text-green-700">Created</div>
                </div>
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-amber-700">{summary.skipped}</div>
                  <div className="text-xs text-amber-700">Skipped</div>
                </div>
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-red-700">{summary.errored}</div>
                  <div className="text-xs text-red-700">Errors</div>
                </div>
              </div>

              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="overflow-x-auto max-h-80">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium text-gray-600 border-b">Row</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-600 border-b">Status</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-600 border-b">Message</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.map((r) => (
                        <tr key={r.row} className="border-b border-gray-50">
                          <td className="px-3 py-2 text-gray-500">{r.row}</td>
                          <td className="px-3 py-2">
                            {r.status === "created" && <span className="text-green-600 font-medium">✓ Created</span>}
                            {r.status === "skipped" && <span className="text-amber-600 font-medium">— Skipped</span>}
                            {r.status === "error" && <span className="text-red-600 font-medium">✗ Error</span>}
                          </td>
                          <td className="px-3 py-2 text-gray-600">{r.message || ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          {step === "upload" && (
            <button onClick={handleClose} className="px-4 py-2 text-gray-600 hover:bg-gray-50 rounded-lg">Cancel</button>
          )}
          {step === "preview" && (
            <>
              <button onClick={() => setStep("upload")} className="px-4 py-2 text-gray-600 hover:bg-gray-50 rounded-lg">Back</button>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="px-4 py-2 bg-teal-500 hover:bg-teal-600 text-white rounded-lg disabled:opacity-50"
              >
                {submitting ? "Importing…" : `Confirm import (${rows.length} rows)`}
              </button>
            </>
          )}
          {step === "result" && (
            <button onClick={handleClose} className="px-4 py-2 bg-teal-500 hover:bg-teal-600 text-white rounded-lg">Done</button>
          )}
        </div>
      </div>
    </div>
  )
}
