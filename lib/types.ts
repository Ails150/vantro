export type Role = 'installer' | 'foreman' | 'admin'
export type JobStatus = 'pending' | 'active' | 'completed' | 'cancelled'
export type QAState = 'pending' | 'submitted' | 'approved' | 'rejected'
export type AlertType = 'blocker' | 'issue' | 'info'
export type ItemType = 'tick' | 'photo' | 'measurement' | 'pass_fail'

export interface Company {
  id: string
  name: string
  slug: string
  plan: string
  trial_ends_at: string
  created_at: string
}

export interface User {
  id: string
  company_id: string
  email?: string
  name: string
  initials: string
  role: Role
  is_active: boolean
  created_at: string
}

export interface Job {
  id: string
  company_id: string
  name: string
  address: string
  lat?: number
  lng?: number
  template_id?: string
  status: JobStatus
  contract_value?: number
  created_at: string
  completed_at?: string
}

export interface SignIn {
  id: string
  job_id: string
  user_id: string
  company_id: string
  lat: number
  lng: number
  accuracy_metres?: number
  distance_from_site_metres?: number
  within_range: boolean
  signed_in_at: string
  signed_out_at?: string
}

export interface DiaryEntry {
  id: string
  job_id: string
  user_id: string
  company_id: string
  entry_text: string
  photo_urls?: string[]
  ai_processed: boolean
  created_at: string
}

export interface Alert {
  id: string
  company_id: string
  job_id: string
  diary_entry_id?: string
  triggered_by: string
  alert_type: AlertType
  message: string
  is_read: boolean
  created_at: string
}

export interface QASubmission {
  id: string
  job_id: string
  user_id: string
  company_id: string
  checklist_item_id: string
  state: QAState
  value?: string
  photo_url?: string
  notes?: string
  submitted_at?: string
  reviewed_by?: string
  reviewed_at?: string
  rejection_note?: string
}

export interface PayrollApproval {
  id: string
  company_id: string
  week_start: string
  approved_by: string
  approved_at: string
  notes?: string
}
