export default function PrivacyPolicy() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      <h1 className="text-2xl font-bold mb-6">Vantro Privacy Policy</h1>
      <p className="text-sm text-gray-500 mb-8">Last updated: April 2026 | Version 1.0</p>

      <div className="prose prose-gray max-w-none space-y-6 text-sm leading-relaxed">
        <section>
          <h2 className="text-lg font-semibold mt-6 mb-3">1. Who we are</h2>
          <p>Vantro is a product of CNNCTD Ltd (NI695071), operating as Scale 8 Digital. We provide workforce management software for construction and trades businesses. This policy explains how we collect, use, and protect personal data processed through the Vantro platform.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold mt-6 mb-3">2. What data we collect</h2>
          <p>We collect the following categories of personal data:</p>
          <p><strong>Account data:</strong> Name, email address, company name, role.</p>
          <p><strong>Authentication data:</strong> Hashed PIN (we never store PINs in plain text).</p>
          <p><strong>Location data:</strong> GPS coordinates at sign-in, sign-out, and periodic breadcrumb logs while signed in to a job site. Location tracking only occurs during active work sessions.</p>
          <p><strong>Work activity data:</strong> Sign-in/sign-out times, hours worked, diary entries, QA checklist submissions, defect reports, and associated photographs.</p>
          <p><strong>Device data:</strong> Push notification tokens for work-related alerts.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold mt-6 mb-3">3. Lawful basis for processing</h2>
          <p>We process personal data under the following lawful bases as defined by UK GDPR:</p>
          <p><strong>Legitimate interest (Article 6(1)(f)):</strong> GPS location tracking during work hours for the purposes of accurate payroll calculation, attendance verification, health and safety compliance, and prevention of time theft. We have conducted a Legitimate Interest Assessment confirming this processing is necessary, proportionate, and does not override the fundamental rights of data subjects.</p>
          <p><strong>Contract performance (Article 6(1)(b)):</strong> Processing necessary to fulfil the service contract between Vantro and the employer company.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold mt-6 mb-3">4. GPS location tracking</h2>
          <p>Vantro collects GPS location data under the following conditions:</p>
          <p>- Location tracking begins only when an installer signs in to a job site</p>
          <p>- Location tracking stops immediately when the installer signs out</p>
          <p>- GPS breadcrumb logs are recorded approximately every 30 minutes during active sessions</p>
          <p>- Location data is used solely for attendance verification and payroll accuracy</p>
          <p>- No tracking occurs outside of work sessions</p>
          <p>- Installers are informed of tracking through an in-app acknowledgment screen before their first sign-in</p>
          <p>- Location data is automatically deleted after the retention period set by the employer (default: 90 days)</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold mt-6 mb-3">5. Data retention</h2>
          <p>We retain personal data only as long as necessary:</p>
          <p><strong>GPS breadcrumb data:</strong> Automatically deleted after the employer-configured retention period (default 90 days).</p>
          <p><strong>Sign-in/sign-out records:</strong> Retained for the duration of the employment relationship plus 6 years for payroll and legal compliance purposes.</p>
          <p><strong>Account data:</strong> Retained until the account is deactivated or deleted.</p>
          <p><strong>Photographs:</strong> Retained for the duration of the employer-configured retention period.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold mt-6 mb-3">6. Your rights</h2>
          <p>Under UK GDPR, you have the following rights:</p>
          <p><strong>Right of access:</strong> You can request a copy of all personal data we hold about you. Use the "My Data" section in the Vantro app or contact your employer.</p>
          <p><strong>Right to rectification:</strong> You can request correction of inaccurate data.</p>
          <p><strong>Right to erasure:</strong> You can request deletion of your data, subject to legal retention requirements.</p>
          <p><strong>Right to restrict processing:</strong> You can request that we limit how we use your data.</p>
          <p><strong>Right to data portability:</strong> You can request your data in a machine-readable format.</p>
          <p><strong>Right to object:</strong> You can object to processing based on legitimate interest.</p>
          <p>To exercise any of these rights, contact your employer or email privacy@getvantro.com.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold mt-6 mb-3">7. Data security</h2>
          <p>We implement appropriate technical and organisational measures to protect personal data:</p>
          <p>- All data is encrypted in transit (TLS/SSL) and at rest</p>
          <p>- Authentication uses cryptographically signed tokens (JWT)</p>
          <p>- PINs are hashed using bcrypt and never stored in plain text</p>
          <p>- Row-level security ensures companies can only access their own data</p>
          <p>- API access is authenticated and authorised on every request</p>
          <p>- Admin actions are recorded in an audit log</p>
          <p>- Regular automated cleanup of expired data</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold mt-6 mb-3">8. Data processors</h2>
          <p>We use the following third-party processors:</p>
          <p><strong>Supabase (AWS eu-west):</strong> Database hosting and authentication</p>
          <p><strong>Vercel:</strong> Application hosting and serverless functions</p>
          <p><strong>Expo/Google:</strong> Push notification delivery</p>
          <p><strong>Stripe:</strong> Payment processing (no access to location or work data)</p>
          <p>All processors are GDPR-compliant and process data within the UK/EEA or under appropriate safeguards.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold mt-6 mb-3">9. Data controller</h2>
          <p>The data controller for employee data processed through Vantro is the employer company that has subscribed to the Vantro service. CNNCTD Ltd acts as the data processor on behalf of the employer.</p>
          <p>For questions about this policy or to exercise your data rights, contact:</p>
          <p>CNNCTD Ltd, privacy@getvantro.com</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold mt-6 mb-3">10. Changes to this policy</h2>
          <p>We may update this policy from time to time. Changes will be communicated through the Vantro app and on this page. Continued use of the service after changes constitutes acceptance of the updated policy.</p>
        </section>
      </div>
    </div>
  )
}