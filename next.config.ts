import type { NextConfig } from "next";

// Allow Polar sandbox API in connect-src when running in sandbox mode
const polarConnectSrc =
  process.env.POLAR_IS_SANDBOX === "true"
    ? "https://api.polar.sh https://sandbox-api.polar.sh"
    : "https://api.polar.sh";

// Restrict API routes to same-origin requests only.
// APP_URL is used for the CORS origin; falls back to allowing same-origin when not set.
const appOrigin = process.env.NEXT_PUBLIC_APP_URL || "";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "*.googleusercontent.com" },
    ],
  },
  async headers() {
    return [
      // ── Security headers for all routes ──────────────────────────────────────
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' https://us.i.posthog.com",
              `connect-src 'self' https://api.github.com https://us.i.posthog.com https://app.posthog.com https://*.supabase.co ${polarConnectSrc}`,
              "img-src 'self' data: https:",
              "style-src 'self' 'unsafe-inline'",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
        ],
      },
      // ── CORS: restrict API routes to the application's own origin ────────────
      // Preflight OPTIONS responses
      ...(appOrigin
        ? [
            {
              source: "/api/(.*)",
              headers: [
                {
                  key: "Access-Control-Allow-Origin",
                  value: appOrigin,
                },
                {
                  key: "Access-Control-Allow-Methods",
                  value: "GET,POST,PATCH,DELETE,OPTIONS",
                },
                {
                  key: "Access-Control-Allow-Headers",
                  value: "Content-Type,Authorization",
                },
                // No credentials are sent cross-origin from outside our domain
                {
                  key: "Access-Control-Allow-Credentials",
                  value: "true",
                },
              ],
            },
          ]
        : []),
    ];
  },
};

export default nextConfig;
