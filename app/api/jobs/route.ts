import { verifyInstallerToken } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { GET as installerJobsGET } from '@/app/api/installer/jobs/route'

export async function GET(request: Request) {
  return installerJobsGET(request)
}
