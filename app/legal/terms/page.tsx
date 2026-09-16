import Link from "next/link"
import { TERMS_VERSION } from "@/lib/legal"

/**
 * The Terms of Service, published.
 *
 * WHY THIS EXISTS AND WHY IT IS THIS VERSION.
 *
 * The signup checkbox has to link to something, and until this page there was
 * no Terms of Service published anywhere. A checkbox that says "I accept the
 * Terms of Service" next to a link to nothing is worse than no checkbox: it
 * produces a record of somebody agreeing to a document that does not exist.
 *
 * The full drafting, with the open questions written out, is in
 * docs/legal/terms.md. THIS PAGE HAS NOT BEEN THROUGH A SOLICITOR. It is
 * published because no terms at all is the worse of the two positions, not
 * because it is finished. Two things in it are business decisions rather than
 * drafting, and both are noted in that file: the liability cap, which is set
 * here at the fees paid in the preceding twelve months with no floor, and
 * whether a data breach we caused sits outside it.
 *
 * The DPA is NOT published from this repo. The signup checkbox links to the PDF
 * already in force -- see lib/legal.ts.
 */

export const metadata = {
  title: "Terms of Service | Vantro",
  description: "The terms on which companies use Vantro.",
}

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold mt-8 mb-3">{n}. {title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

export default function TermsPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      <h1 className="text-2xl font-bold mb-2">Vantro Terms of Service</h1>
      <p className="text-sm text-gray-500 mb-8">
        Version {TERMS_VERSION} · 16 September 2026
      </p>

      <div className="prose prose-gray max-w-none text-sm leading-relaxed text-gray-800">
        <p>
          These terms are between <strong>CNNCTD Ltd</strong>, a company registered in
          Northern Ireland under company number <strong>NI695071</strong>, trading as
          <strong>Vantro</strong> (&ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;Vantro&rdquo;),
          and the company that subscribes to the service (&ldquo;you&rdquo;, &ldquo;your company&rdquo;).
        </p>
        <p>
          They do not apply to your workers. A worker who signs in on the mobile app is using the
          service on your behalf, under your instructions. What we do with their data is governed by
          the{" "}
          <a href="/legal/Vantro_Data_Processing_Agreement.pdf" className="text-teal-700 underline" target="_blank" rel="noopener noreferrer">
            Data Processing Agreement
          </a>.
        </p>

        <Section n={1} title="What the service is">
          <p>
            Vantro records where and when your workers start and finish work, and keeps the evidence
            of it. Depending on your plan it also prices those hours for payroll, holds site safety
            and quality records, and produces compliance packs.
          </p>
          <p>
            It is a record-keeping tool. <strong>It is not legal, payroll, tax or health and safety
            advice</strong>, and the presence of a feature is not a statement that using it makes you
            compliant with anything. Section 9 says more about this, and it is the part of these
            terms most likely to matter to you.
          </p>
        </Section>

        <Section n={2} title="The plans, and what each costs">
          <table className="w-full text-sm my-3 border border-gray-200 rounded-lg overflow-hidden">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left p-2 font-semibold">Plan</th>
                <th className="text-left p-2 font-semibold">Price</th>
                <th className="text-left p-2 font-semibold">Billed</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-gray-200"><td className="p-2">Free</td><td className="p-2">£0</td><td className="p-2">Never</td></tr>
              <tr className="border-t border-gray-200"><td className="p-2">Payroll</td><td className="p-2">£39.99 per month</td><td className="p-2">Monthly, in advance</td></tr>
              <tr className="border-t border-gray-200"><td className="p-2">Suite</td><td className="p-2">£99 per month</td><td className="p-2">Monthly, in advance</td></tr>
            </tbody>
          </table>
          <p>Prices exclude VAT, which is added at the prevailing UK rate.</p>
          <p>
            The price is per company, not per worker. Adding installers does not change what you pay.
          </p>
          <p>
            <strong>Free is free indefinitely</strong>, not a trial. It is limited: shift records on
            Free are kept for <strong>5 days</strong> and then removed. If you need the history you
            need a paid plan, and you need it before those five days run out, because we cannot
            recover what has already been deleted.
          </p>
          <p>
            Paid plans include a <strong>30-day trial</strong>. A card is required to start it,
            nothing is charged during it, and if you cancel before it ends you are not charged at all.
          </p>
        </Section>

        <Section n={3} title="Cancelling">
          <p>
            <strong>Monthly rolling. Cancel any time. No notice period. No minimum term.</strong>
          </p>
          <p>
            Cancel from the Billing tab. Your plan continues to the end of the period you have
            already paid for, and then stops. We do not refund part-months, because there are none to
            refund — you have had the month.
          </p>
          <p>
            We do not delete your data when you cancel. The company drops to Free, which means the
            Free limits then apply, including the 5-day shift retention.{" "}
            <strong>If you want your data before that happens, export it before you cancel.</strong>{" "}
            If you want it deleted, ask us; section 8 covers that.
          </p>
        </Section>

        <Section n={4} title="Changing the price">
          <p>
            We may change prices. If we do, we will give you at least <strong>30 days&rsquo; notice
            by email</strong> to your admin address, and the new price applies from your next renewal
            after that notice. You can cancel in that window and never pay it. We will not change the
            price of a period you have already paid for.
          </p>
        </Section>

        <Section n={5} title="What you are responsible for">
          <p>
            <strong>The lawfulness of the tracking.</strong> Vantro records location. You decide to
            use it on your workers; that decision is yours and so is the legal basis for it. Before
            you roll it out you must tell your workers what is being recorded and why, and, where the
            law requires it, consult them or their representatives. We provide the tool. We do not
            provide the lawful basis.
          </p>
          <p>
            <strong>The accuracy of what you put in.</strong> Pay rates, job addresses, geofence
            radii, break rules and schedules are yours. The pay engine is arithmetic on the numbers
            you give it.
          </p>
          <p>
            <strong>Your users&rsquo; accounts.</strong> Keeping admin credentials safe, removing
            people who have left, and not sharing installer PINs. Deactivating a worker immediately
            invalidates their mobile session.
          </p>
          <p>
            <strong>Not misusing the service.</strong> No attempting to reach another company&rsquo;s
            data, no automated scraping, no load testing without asking, no reselling access, and
            nothing illegal.
          </p>
        </Section>

        <Section n={6} title="What we are responsible for">
          <p><strong>Providing the service with reasonable skill and care.</strong></p>
          <p>
            <strong>Security.</strong> Company data is isolated at the database level and that
            isolation is tested. Evidence records are append-only and hash-chained, so tampering is
            detectable. Passwords and PINs are never stored in plain text.
          </p>
          <p>
            <strong>Availability.</strong> We aim for high availability but do not offer a
            contractual uptime guarantee or service credits at these prices. If you need a service
            level agreement, talk to us.
          </p>
          <p>
            <strong>Telling you about a breach.</strong> If there is a personal data breach affecting
            your data we will tell you without undue delay. The DPA sets out the timing and what we
            will include.
          </p>
        </Section>

        <Section n={7} title="Your data is yours">
          <p>
            You own the records your company creates in Vantro. We do not sell them, rent them, or
            use them to train AI models for anyone else&rsquo;s benefit.
          </p>
          <p>
            Some features send text to AI services to classify or summarise it — diary entries and
            walkthrough transcripts. Those services are contractually bound not to train on it. The
            full list of the services we use, and where each one is, is published with the DPA.
          </p>
          <p>You can export at any time from within the product.</p>
        </Section>

        <Section n={8} title="Deleting your company">
          <p>
            Ask us and we will delete your company: the database records, the photographs, the audio
            and video, and the audit packs, from every system that holds them.
          </p>
          <p>Three things survive, and you should know before you ask:</p>
          <ol className="list-decimal pl-6 space-y-1">
            <li><strong>Records we are legally required to keep</strong>, for as long as we are required to keep them — chiefly billing records for HMRC.</li>
            <li><strong>The hash ledger</strong>, which holds no personal data: a list of hashes proving that records which once existed have not been altered.</li>
            <li><strong>Backups</strong>, which roll off on their own schedule rather than being rewritten in place.</li>
          </ol>
          <p>Deletion is not reversible. We will confirm when it is done.</p>
        </Section>

        <Section n={9} title="Limits on our liability">
          <p>
            Nothing here limits liability for death or personal injury caused by negligence, for
            fraud, or for anything else that cannot lawfully be limited. Subject to that:
          </p>
          <p>
            <strong>We are not liable for how you use the records.</strong> If you pay someone the
            wrong amount, dismiss someone, defend a claim, or fail an inspection, and Vantro&rsquo;s
            records were involved, that is your decision made on your data. We provide arithmetic and
            storage. <strong>Check the numbers before you pay anybody.</strong>
          </p>
          <p>
            <strong>We are not liable for indirect or consequential loss</strong>, lost profit, lost
            business, lost goodwill, or loss arising from a claim someone else makes against you.
          </p>
          <p>
            <strong>Our total liability in any 12-month period is capped at the fees you paid us in
            that period.</strong> You should consider whether that is enough for how you intend to
            use the service, and insure accordingly.
          </p>
        </Section>

        <Section n={10} title="Suspending or ending your access">
          <p>
            We may suspend the service if payment fails and remains unpaid after we have told you, or
            if what you are doing threatens the service or other customers. We will tell you why and,
            where the problem can be fixed, what would fix it.
          </p>
          <p>
            We may end this agreement on <strong>30 days&rsquo; written notice</strong>. If we do, we
            refund the unused part of anything you have paid in advance and give you at least that 30
            days to export.
          </p>
        </Section>

        <Section n={11} title="Changing these terms">
          <p>
            We may change these terms. Material changes get at least{" "}
            <strong>30 days&rsquo; notice by email</strong> to your admin address, and you can cancel
            before they take effect. Changes required by law may take effect sooner if the law
            requires it.
          </p>
        </Section>

        <Section n={12} title="The rest">
          <p>
            <strong>Whole agreement.</strong> These terms, the DPA, and the plan you selected are the
            whole agreement.
          </p>
          <p>
            <strong>No third party rights.</strong> Nobody outside this agreement can enforce it
            under the Contracts (Rights of Third Parties) Act 1999.
          </p>
          <p>
            <strong>Assignment.</strong> You may not assign without our consent. We may assign on a
            sale of the business, and will tell you.
          </p>
          <p>
            <strong>Governing law.</strong> England and Wales, and the exclusive jurisdiction of the
            English courts.
          </p>
          <p>
            <strong>Contact.</strong> privacy@getvantro.com for anything about data protection.
          </p>
        </Section>
      </div>

      <div className="mt-10 pt-6 border-t border-gray-200 text-sm text-gray-500">
        <Link href="/privacy" className="text-teal-700 underline">Privacy policy</Link>
        {" · "}
        <a href="/legal/Vantro_Data_Processing_Agreement.pdf" className="text-teal-700 underline" target="_blank" rel="noopener noreferrer">
          Data Processing Agreement
        </a>
      </div>
    </div>
  )
}
