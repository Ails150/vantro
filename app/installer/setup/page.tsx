import { redirect } from 'next/navigation'

export default function InstallerSetupPage({ searchParams }: { searchParams: { email?: string } }) {
  const email = searchParams.email || ''
  const deepLink = `vantro://login?email=${encodeURIComponent(email)}`

  return (
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <title>Open Vantro</title>
        <script dangerouslySetInnerHTML={{ __html: `
          setTimeout(function() {
            window.location.href = '${deepLink}';
          }, 500);
        `}} />
        <style>{`
          body { margin: 0; background: #0f1923; font-family: sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
          .card { background: #1a2635; border-radius: 20px; padding: 40px 32px; max-width: 340px; width: 90%; text-align: center; }
          .logo { width: 56px; height: 56px; background: #00C896; border-radius: 14px; display: flex; align-items: center; justify-content: center; margin: 0 auto 24px; font-weight: 800; font-size: 22px; color: #07100D; }
          h1 { color: #e8f5f0; font-size: 22px; margin: 0 0 10px; }
          p { color: #6b8f7e; font-size: 14px; line-height: 1.6; margin: 0 0 28px; }
          a { display: block; background: #00C896; color: #07100D; padding: 15px; border-radius: 12px; text-decoration: none; font-weight: 700; font-size: 15px; margin-bottom: 12px; }
          .sub { color: #4d6478; font-size: 12px; }
        `}</style>
      </head>
      <body>
        <div className="card">
          <div className="logo">V</div>
          <h1>Open Vantro</h1>
          <p>Your account is ready. Tap below to open the Vantro app and set your PIN.</p>
          <a href={deepLink}>Open Vantro App →</a>
          <p className="sub">Make sure you have the Vantro app installed first.</p>
        </div>
      </body>
    </html>
  )
}
