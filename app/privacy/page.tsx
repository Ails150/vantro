export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-white px-6 py-12 max-w-3xl mx-auto">
      <h1 className="text-3xl font-bold mb-2">Privacy Policy</h1>
      <p className="text-gray-500 mb-8">Last updated: April 2026</p>

      <h2 className="text-xl font-semibold mb-2">1. Who we are</h2>
      <p className="text-gray-700 mb-6">Vantro is a field operations platform built by CNNCTD Ltd (NI695071), Northern Ireland. We help construction and trades businesses manage their teams, jobs and compliance. Contact: hello@getvantro.com</p>

      <h2 className="text-xl font-semibold mb-2">2. What data we collect</h2>
      <p className="text-gray-700 mb-6">We collect name, email address, GPS location (on sign-in and sign-out only), device push notification token, job site diary entries, QA checklist submissions, and defect reports. We do not sell your data to any third party.</p>

      <h2 className="text-xl font-semibold mb-2">3. Why we collect it</h2>
      <p className="text-gray-700 mb-6">Location data is used solely to verify that an installer is within 150 metres of a job site when signing in. It is not tracked continuously. Diary entries and checklist data are used to provide compliance reporting for your employer.</p>

      <h2 className="text-xl font-semibold mb-2">4. How we store it</h2>
      <p className="text-gray-700 mb-6">All data is stored securely on Supabase (EU region). We use industry-standard encryption in transit and at rest. Push notification tokens are stored only to deliver job-related alerts.</p>

      <h2 className="text-xl font-semibold mb-2">5. Camera access</h2>
      <p className="text-gray-700 mb-6">The app requests camera access to allow installers to photograph defects and QA checklist items. Photos are uploaded to secure cloud storage and are only accessible to your employer.</p>

      <h2 className="text-xl font-semibold mb-2">6. Your rights</h2>
      <p className="text-gray-700 mb-6">You have the right to access, correct or delete your personal data at any time. To make a request, contact hello@getvantro.com. We will respond within 30 days.</p>

      <h2 className="text-xl font-semibold mb-2">7. Data retention</h2>
      <p className="text-gray-700 mb-6">We retain your data for as long as your employer's account is active. When an account is closed, all associated data is deleted within 30 days.</p>

      <h2 className="text-xl font-semibold mb-2">8. Third party services</h2>
      <p className="text-gray-700 mb-6">We use Supabase (database), Vercel (hosting), Resend (email), Expo (mobile push notifications) and Stripe (payments). Each of these services has their own privacy policy.</p>

      <h2 className="text-xl font-semibold mb-2">9. Contact</h2>
      <p className="text-gray-700">For any privacy questions contact hello@getvantro.com</p>
    </div>
  )
}
