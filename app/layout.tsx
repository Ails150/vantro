import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google"
import Script from "next/script";
import "./globals.css";

// The product has ONE face: Geist, at 400/500/600.
//
// There used to be a Fraunces display serif for page titles and hero numerals.
// It has been removed outright -- weight and size carry the hierarchy instead,
// which is how Linear and Vercel do it, and it saves a second font request.
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
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
