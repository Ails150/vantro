import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google"
import localFont from "next/font/local"
import Script from "next/script";
import "./globals.css";

// Body face. Inter across the whole product.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * Display face for headings.
 *
 * Self-hosted rather than pulled from Fontshare: the CSP in vercel.json allows
 * fonts from 'self' and fonts.gstatic.com only, so a CDN link would be blocked
 * at runtime with nothing in the console to explain the fallback. Files live in
 * public/fonts and are served same-origin.
 *
 * Three static weights, no variable axis - so anything asking for 600 lands on
 * 500 or 700 rather than being synthesised.
 */
const cabinet = localFont({
  variable: "--font-cabinet",
  display: "swap",
  src: [
    { path: "../public/fonts/CabinetGrotesk-Medium.woff2", weight: "500", style: "normal" },
    { path: "../public/fonts/CabinetGrotesk-Bold.woff2", weight: "700", style: "normal" },
    { path: "../public/fonts/CabinetGrotesk-Extrabold.woff2", weight: "800", style: "normal" },
  ],
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
      className={`${inter.variable} ${geistMono.variable} ${cabinet.variable} h-full antialiased`}
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
