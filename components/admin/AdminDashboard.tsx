"use client"
import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"

interface Props {
  user: any
  userData: any
  company: any
  jobs: any[]
  signins: any[]
  alerts: any[]
  pendingQA: any[]
  teamMembers: any[]
  jobAssignments?: any[]
  checklistTemplates: any[]
  diaryEntries: any[]
  resolvedAlerts: any[]
  defaultTab: string
}

export default function AdminDashboard({ 
  user, 
  userData, 
  company, 
  jobs, 
  signins, 
  alerts, 
  pendingQA, 
  teamMembers, 
  jobAssignments = [], 
  checklistTemplates, 
  diaryEntries, 
  resolvedAlerts, 
  defaultTab 
}: Props) {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState(defaultTab || "overview")

  const setupTabs = [
    { id: "team", label: "Team" },
    { id: "jobs", label: "Jobs" },
    { id: "checklists", label: "Checklists" },
    { id: "settings", label: "Settings" },
    { id: "alerts", label: "Alerts", badge: alerts.length },
  ]

  const operationsTabs = [
    { id: "overview", label: "Overview" },
    { id: "analytics", label: "Analytics" },
    { id: "performance", label: "Performance" },
    { id: "payroll", label: "Payroll" },
    { id: "map", label: "Map" },
    { id: "audit", label: "Audit" },
    { id: "approvals", label: "Approvals", badge: pendingQA.length },
    { id: "diary", label: "Diary" },
    { id: "defects", label: "Defects" },
  ]

  const switchTab = (tabId: string) => {
    setActiveTab(tabId)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="flex">
        <div className="w-64 bg-white border-r border-gray-200 min-h-screen">
          <div className="p-6 space-y-6">
            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Setup</h3>
              <nav className="space-y-1">
                {setupTabs.map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => switchTab(tab.id)}
                    className={`w-full text-left px-3 py-2 text-sm font-medium rounded-lg transition-colors flex items-center justify-between ${
                      activeTab === tab.id
                        ? 'bg-teal-50 text-teal-700 border-l-4 border-teal-400'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                    }`}
                  >
                    <span>{tab.label}</span>
                    {tab.badge ? <span className="bg-teal-100 text-teal-700 text-xs font-bold px-2 py-0.5 rounded-full">{tab.badge}</span> : null}
                  </button>
                ))}
              </nav>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Operations</h3>
              <nav className="space-y-1">
                {operationsTabs.map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => switchTab(tab.id)}
                    className={`w-full text-left px-3 py-2 text-sm font-medium rounded-lg transition-colors flex items-center justify-between ${
                      activeTab === tab.id
                        ? 'bg-teal-50 text-teal-700 border-l-4 border-teal-400'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                    }`}
                  >
                    <span>{tab.label}</span>
                    {tab.badge ? <span className="bg-teal-100 text-teal-700 text-xs font-bold px-2 py-0.5 rounded-full">{tab.badge}</span> : null}
                  </button>
                ))}
              </nav>
            </div>
          </div>
        </div>

        <div className="flex-1 p-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Admin Dashboard</h1>
          <p className="text-gray-600">Active tab: {activeTab}</p>
          <div className="mt-8 p-4 bg-white rounded-lg border">
            <p>Content for {activeTab} tab will go here...</p>
          </div>
        </div>
      </div>
    </div>
  )
}
