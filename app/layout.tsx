import type { Metadata } from "next";
import { Geist, Geist_Mono, Fraunces } from "next/font/google"
import Script from "next/script";
import "./globals.css";

// Body face. Geist across the whole product, at 400/500/600.
// Loaded variable rather than as three static cuts: the variable file covers
// the full range in one request, and every weight the UI uses sits inside it.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * Display face, for page titles and hero numerals only.
 *
 * next/font/google self-hosts at build time -- the files are emitted into the
 * app bundle and served same-origin from /_next/static/media, so the
 * `font-src 'self'` in vercel.json already covers them. That CSP only rules out
 * a third-party CDN such as Fontshare; it does not force self-hosting by hand.
 *
 * Variable, with the optical-size axis requested so titles and large numerals
 * can be tuned independently. Weight 600 comes from the variable wght axis via
 * .font-display / .font-display-num in globals.css.
 */
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["opsz"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Vantro",
  description: "Field operations app for installers",
  icons: {
    icon: "/icon-32x32.png",
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Vantro",
  },
};
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} h-full antialiased`}
    >
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"/>
        <meta name="mobile-web-app-capable" content="yes"/>
        <meta name="apple-mobile-web-app-capable" content="yes"/>
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"/>
        <meta name="apple-mobile-web-app-title" content="Vantro"/>
        <meta name="theme-color" content="#00d4a0"/>
      </head>
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        {children}
        <Script id="sw-unregister" strategy="afterInteractive">
          {`if('serviceWorker' in navigator){navigator.serviceWorker.getRegistrations().then(function(regs){regs.forEach(function(r){r.unregister();});})}`}
        </Script>
      </body>
    </html>
  );
}
