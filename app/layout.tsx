import type { Metadata } from "next";
import { Host_Grotesk, EB_Garamond, DM_Sans } from "next/font/google";
import "./globals.css";

const hostGrotesk = Host_Grotesk({
  variable: "--font-host-grotesk",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  display: "swap",
});

const ebGaramond = EB_Garamond({
  variable: "--font-eb-garamond",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
  display: "swap",
});

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "ShipGuard AI — Production-Readiness Scanner for AI Apps",
  description:
    "The one-click production-readiness scanner that turns AI prototypes into $1k+/mo businesses. Scan your GitHub repo for security holes, scalability issues, monetization gaps, and distribution failures.",
  keywords: ["production readiness", "AI apps", "security scanner", "SaaS", "indie hacker"],
  openGraph: {
    title: "ShipGuard AI",
    description: "Production-readiness scanner for AI-built indie apps",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${hostGrotesk.variable} ${ebGaramond.variable} ${dmSans.variable} antialiased`}
        style={{ fontFamily: "var(--font-host-grotesk), system-ui, sans-serif" }}
      >
        {children}
      </body>
    </html>
  );
}
