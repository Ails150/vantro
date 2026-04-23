import type { NextConfig } from "next";

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://maps.googleapis.com https://cdnjs.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://*.supabase.co https://maps.googleapis.com https://maps.gstatic.com https://*.googleapis.com https://*.ggpht.com https://*.r2.dev https://*.r2.cloudflarestorage.com",
  "connect-src 'self' data: https://*.supabase.co wss://*.supabase.co https://maps.googleapis.com https://www.gstatic.com https://exp.host https://api.anthropic.com https://*.r2.dev",
  "frame-src 'self' https://customer-*.cloudflarestream.com https://iframe.videodelivery.net",
  "media-src 'self' https://*.r2.dev https://*.cloudflarestream.com",
  "worker-src 'self' blob:",
  "frame-ancestors 'self'"
].join("; ");

const nextConfig: NextConfig = {
  reactCompiler: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: CSP },
        ],
      },
    ];
  },
};

export default nextConfig;
