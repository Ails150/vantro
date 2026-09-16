import Link from "next/link"

/**
 * The public security page.
 *
 * Two audiences, and they want opposite things. A subcontractor deciding
 * whether to trust us with their workers' location wants plain sentences and no
 * jargon. A main contractor's IT department, or the security questionnaire they
 * will send, wants specifics they can check.
 *
 * So it is written for the first and answers the second, and every claim on it
 * is one that can be pointed at something in the repository. NOTHING HERE IS
 * ASPIRATIONAL. A security page that describes intentions is how a company ends
 * up having published a false statement about a control it never built, which
 * is a worse position than having said nothing.
 *
 * The one thing a security page must have and most do not is a way to report a
 * problem, with a promise about what happens next. That is section "Found a
 * problem?", and it is the reason the page exists at all.
 */

export const metadata = {
  title: "Security | Vantro",
  description: "How Vantro protects site records, worker location and evidence.",
}

function Item({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-gray-200 rounded-xl p-4">
      <h3 className="font-semibold text-gray-900 mb-1.5 text-sm">{title}</h3>
      <div className="text-sm text-gray-700 leading-relaxed space-y-2">{children}</div>
    </div>
  )
}

export default function SecurityPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      <h1 className="text-2xl font-bold mb-2">Security at Vantro</h1>
      <p className="text-sm text-gray-500 mb-8">Last reviewed 16 September 2026</p>

      <p className="text-sm text-gray-700 leading-relaxed mb-8">
        Vantro holds the times your people worked, where they were when they
        signed in, photographs of your sites and the evidence packs you send to
        your clients. That is a serious amount of trust for software that costs
        less than a day&rsquo;s labour, so this page sets out exactly what
        protects it — and what does not.
      </p>

      <div className="space-y-3">
        <h2 className="text-lg font-semibold mt-8 mb-3">Keeping companies apart</h2>

        <Item title="Isolation is enforced by the database, not by the app">
          <p>
            Every table carrying company data is protected by row-level security
            in PostgreSQL. A query that asks for another company&rsquo;s records
            does not return them — not because the application filtered them
            out, but because the database refuses.
          </p>
          <p>
            This matters because application-level filtering fails silently the
            first time somebody forgets a <code>where</code> clause. Database
            enforcement does not have a forgetting mode.
          </p>
        </Item>

        <Item title="And it is tested, continuously">
          <p>
            A suite of security tests runs on every change: it walks every API
            route the codebase contains, signs in as a real user of one company,
            and tries to read and write another&rsquo;s data through each one. A
            route that answered would fail the build.
          </p>
        </Item>

        <h2 className="text-lg font-semibold mt-8 mb-3">Evidence that cannot be quietly changed</h2>

        <Item title="Records are append-only">
          <p>
            Sign-ins, safety checks, quality records and incident reports cannot
            be edited or deleted by anyone signed in to the product —
            administrator or not. Correcting one creates a new record that
            supersedes the old, and both survive.
          </p>
        </Item>

        <Item title="Every record is hashed into a ledger">
          <p>
            Each record&rsquo;s contents produce a fingerprint, and those
            fingerprints are combined into a single value for each evidence pack.
            Change one photograph, one timestamp or one signature and the value
            no longer matches.
          </p>
          <p>
            The ledger itself is append-only at the database level. Anyone you
            give a pack to can check it against{" "}
            <Link href="/verify" className="text-teal-700 underline">the public verifier</Link>{" "}
            without an account.
          </p>
        </Item>

        <h2 className="text-lg font-semibold mt-8 mb-3">Accounts and devices</h2>

        <Item title="Nothing is stored in a form we could read back">
          <p>
            Administrator passwords and installer PINs are hashed. We cannot tell
            you what yours is, and neither could anyone who obtained the
            database.
          </p>
        </Item>

        <Item title="Two-factor authentication">
          <p>
            Available on any administrator account, with ten single-use recovery
            codes issued at enrolment. It is mandatory on our own staff accounts,
            not optional.
          </p>
        </Item>

        <Item title="The phone in someone's pocket is part of the system">
          <p>
            The mobile app keeps its credentials in the phone&rsquo;s hardware
            secure storage — the Android keystore or the iOS keychain — never in
            ordinary app storage, which is readable on a rooted device.
          </p>
          <p>
            It refuses to run on a rooted or jailbroken phone, and it pins the
            certificate of the server it talks to, so a network that intercepts
            traffic gets refused rather than trusted.
          </p>
        </Item>

        <Item title="Removing someone removes their access immediately">
          <p>
            Deactivating a worker invalidates their session on the next request.
            There is no window in which a departed employee&rsquo;s phone still
            works.
          </p>
        </Item>

        <h2 className="text-lg font-semibold mt-8 mb-3">Where the data is</h2>

        <Item title="The database, the application and the files are in the EU">
          <p>
            Some things necessarily leave: email delivery, address lookup, push
            notifications, billing, and the AI features that summarise diary
            entries. Every third party we use, what it processes and which
            country it is in, is listed in full rather than summarised — it is
            published with the{" "}
            <a href="/legal/Vantro_Data_Processing_Agreement.pdf" className="text-teal-700 underline" target="_blank" rel="noopener noreferrer">
              Data Processing Agreement
            </a>.
          </p>
        </Item>

        <Item title="Error reports are scrubbed before they are sent">
          <p>
            When something crashes we collect the diagnostics. Before anything
            leaves the device or the server, session tokens, PINs and coordinates
            are stripped out, and screen recordings have all text and images
            masked. A crash on the PIN screen does not send us the PIN.
          </p>
        </Item>

        <Item title="You decide how long records are kept">
          <p>
            For ever, three years or six years. Changing the setting does not
            destroy anything for thirty days, with a warning of exactly what will
            go and when. Location traces recorded during a shift are capped at
            ninety days regardless.
          </p>
        </Item>

        <h2 className="text-lg font-semibold mt-8 mb-3">What we do not claim</h2>

        <Item title="Plainly, so nobody has to guess">
          <ul className="list-disc pl-5 space-y-1.5">
            <li>
              <strong>We are not ISO 27001 or SOC 2 certified.</strong> If a
              tender requires it, we do not meet it today.
            </li>
            <li>
              <strong>There is no contractual uptime guarantee</strong> at these
              prices.
            </li>
            <li>
              <strong>Erasure is not total.</strong> Evidence packs already
              issued keep the name in them, and health and safety records are
              kept with the name removed, as UK GDPR Article 17(3) allows. The
              product says so at the moment an administrator erases somebody.
            </li>
            <li>
              <strong>Root detection can be defeated</strong> by someone
              determined. It is there for the far more common case of a phone
              rooted years ago for something unrelated.
            </li>
          </ul>
        </Item>

        <h2 className="text-lg font-semibold mt-8 mb-3">Found a problem?</h2>

        <Item title="Tell us, and here is what happens">
          <p>
            Email <strong>security@getvantro.com</strong>. Include enough for us
            to reproduce it. If you would rather not use email, use{" "}
            <Link href="/support" className="text-teal-700 underline">support</Link>{" "}
            and say it is a security issue.
          </p>
          <p>What we commit to:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>We acknowledge within <strong>2 working days</strong>.</li>
            <li>We tell you our assessment within <strong>10 working days</strong>.</li>
            <li>We tell you when it is fixed, and we will credit you if you want to be credited.</li>
          </ul>
          <p>
            <strong>We will not take legal action against you</strong> for
            research done in good faith under the rules below.
          </p>
          <p className="text-gray-600">
            Please: test only against your own account or a trial account, do not
            access anyone else&rsquo;s data, do not run denial-of-service or
            automated scanning that degrades the service for others, and give us
            a reasonable chance to fix it before publishing. Do not use social
            engineering against our staff or our customers.
          </p>
        </Item>
      </div>

      <div className="mt-10 pt-6 border-t border-gray-200 text-sm text-gray-500">
        <Link href="/privacy" className="text-teal-700 underline">Privacy policy</Link>
        {" · "}
        <Link href="/legal/terms" className="text-teal-700 underline">Terms of Service</Link>
        {" · "}
        <a href="/.well-known/security.txt" className="text-teal-700 underline">security.txt</a>
      </div>
    </div>
  )
}
